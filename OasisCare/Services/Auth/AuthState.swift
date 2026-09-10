import Combine
import Foundation
import SwiftData
import Supabase

/// Global auth status — loading while the initial session is read from
/// storage, guest when there's no session, authenticated once one exists.
/// RootContainerView drives navigation off this; it does not by itself
/// decide whether to show the Welcome screen (see hasSeenWelcome there) —
/// a signed-out guest who has already been through Welcome once should
/// never be forced back through it.
@MainActor
final class AuthState: ObservableObject {
    enum Status: Equatable {
        case loading
        case guest
        case authenticated
    }

    static let shared = AuthState()

    @Published private(set) var status: Status = .loading
    @Published private(set) var session: Session?

    private var listenerTask: Task<Void, Never>?

    private init() {}

    func start() {
        guard listenerTask == nil else { return }
        listenerTask = Task {
            for await (_, session) in await AuthService.authStateChanges {
                let previousUserID = self.session?.user.id
                self.session = session
                self.status = session == nil ? .guest : .authenticated

                // Le contexte de travail appartient au compte, jamais à
                // l'appareil. Dès que le compte change — y compris une
                // connexion directe sous un autre compte, sans
                // déconnexion préalable — la liste d'espaces gardée en
                // mémoire n'est plus la sienne. La laisser en place
                // ferait afficher les espaces du compte précédent le
                // temps de la relecture : une fuite d'un monde vers
                // l'autre, exactement ce que ce mécanisme existe pour
                // empêcher.
                //
                // Mémoire seulement : la préférence sur disque porte le
                // compte qui l'a posée et sera revalidée. L'effacer ici
                // ferait perdre son choix à l'utilisateur à CHAQUE
                // lancement, puisque le premier événement du flux est la
                // restauration de la session.
                if session?.user.id != previousUserID {
                    WorkspaceContextService.shared.forgetLoadedAccount()
                }
            }
        }
    }

    /// LA DÉCONNEXION. Un appareil déconnecté ne doit rien garder du
    /// compte précédent : c'est la règle de l'appareil partagé, et elle
    /// vaut pour les cinquante-sept modèles, pas pour sept.
    ///
    /// Rend le résultat de l'effacement au lieu de l'avaler. L'ancienne
    /// version se taisait quoi qu'il arrive — « rien de plus utile à
    /// faire » —, si bien qu'un nettoyage qui échoue et un nettoyage qui
    /// réussit se ressemblaient exactement. C'est ce silence qui a permis
    /// au défaut de vivre : l'écran annonçait « vos données seront
    /// retirées de cet appareil » et elles restaient.
    ///
    /// L'appelant doit avoir prévenu si `SyncEngine.pendingCount` n'est
    /// pas nul : ce qui n'est pas synchronisé est perdu ici, pas caché.
    @discardableResult
    func signOutClearingLocalData(context: ModelContext) async -> NettoyageLocal.Resultat {
        try? await AuthService.signOut()
        // Mémoire ET disque, à la différence du changement de compte
        // ci-dessus : un appareil déconnecté ne garde rien du compte
        // précédent, pas même le contexte dans lequel il travaillait.
        WorkspaceContextService.shared.clear()
        let resultat = NettoyageLocal.toutEffacer(dans: context)
        // Le propriétaire ne s'oublie QUE si la copie locale est
        // réellement partie. Sinon l'appareil afficherait les données de
        // quelqu'un tout en prétendant n'appartenir à personne — et la
        // prochaine connexion les adopterait sans rien effacer.
        if resultat.estComplet { IdentiteLocale.oublier() }
        return resultat
    }

    /// LE CHANGEMENT DE COMPTE, qui n'est pas une déconnexion.
    ///
    /// Se connecter sous un autre compte sans passer par « Se
    /// déconnecter » ne nettoyait rien : seule la liste d'espaces gardée
    /// en mémoire était oubliée. Les végétaux du compte précédent
    /// restaient à l'écran — c'est exactement ce qui a été constaté.
    ///
    /// Appelé depuis la vue plutôt que depuis le flux d'authentification
    /// : l'effacement a besoin d'un `ModelContext`, et celui de la vue
    /// est celui que `@Query` observe. En fabriquer un autre effacerait
    /// bien le disque, mais l'écran continuerait d'afficher ce qu'il
    /// tient déjà en mémoire.
    @discardableResult
    func adopterOuNettoyer(context: ModelContext) -> NettoyageLocal.Resultat? {
        guard let compte = session?.user.id else { return nil }

        switch IdentiteLocale.comparer(a: compte) {
        case .memeCompte:
            return nil

        case .adoption:
            // Premier lancement, ou première ouverture après la mise à
            // jour qui introduit ce mécanisme. On ne sait pas à qui la
            // copie locale appartient, et « on ne sait pas » n'autorise
            // pas à effacer le travail de quelqu'un.
            IdentiteLocale.inscrire(compte)
            return nil

        case .changementDeCompte:
            WorkspaceContextService.shared.forgetLoadedAccount()
            let resultat = NettoyageLocal.toutEffacer(dans: context)
            // Même prudence qu'à la déconnexion : on n'inscrit le nouveau
            // propriétaire que si l'ancienne copie est bien partie.
            if resultat.estComplet { IdentiteLocale.inscrire(compte) }
            return resultat
        }
    }
}

/// L'EFFACEMENT DE LA COPIE LOCALE, ET LA PREUVE QU'IL A EU LIEU.
enum NettoyageLocal {

    struct Resultat: Equatable {
        /// Combien d'objets ont été supprimés.
        let supprimes: Int
        /// Combien restent, une fois l'effacement terminé. Zéro attendu.
        let restants: Int
        /// La description de la première erreur rencontrée, s'il y en a
        /// eu une. Du texte, pas une `Error` : ça traverse `Equatable`,
        /// ça s'écrit dans un journal et ça s'affiche.
        let erreur: String?

        var estComplet: Bool { restants == 0 && erreur == nil }
    }

    /// Efface TOUT ce que le conteneur connaît, puis vérifie.
    ///
    /// DEUX CHOIX DE MISE EN ŒUVRE, ET AUCUN N'EST GRATUIT.
    ///
    /// On supprime OBJET PAR OBJET plutôt que par `delete(model:)`. La
    /// suppression en masse passe à côté du contexte en mémoire : les
    /// objets déjà chargés — ceux, précisément, que les écrans
    /// affichent — y survivent, et l'enregistrement qui suit peut les
    /// réinscrire. Supprimer les instances coûte une lecture par type ;
    /// en échange, ce que l'écran montre disparaît vraiment.
    ///
    /// On RELIT ENSUITE pour compter ce qui reste. Un nettoyage qu'on ne
    /// vérifie pas est une intention, pas une garantie — et c'est
    /// littéralement le défaut qu'on corrige ici.
    static func toutEffacer(dans contexte: ModelContext) -> Resultat {
        var supprimes = 0
        var premiereErreur: String?

        for type in SharedModelContainer.modeles {
            do {
                supprimes += try effacerInstances(de: type, dans: contexte)
            } catch {
                if premiereErreur == nil {
                    premiereErreur = "\(type) : \(error.localizedDescription)"
                }
            }
        }

        do {
            try contexte.save()
        } catch {
            if premiereErreur == nil {
                premiereErreur = "enregistrement : \(error.localizedDescription)"
            }
        }

        var restants = 0
        for type in SharedModelContainer.modeles {
            restants += (try? compter(type, dans: contexte)) ?? 0
        }

        return Resultat(supprimes: supprimes, restants: restants, erreur: premiereErreur)
    }

    // Ces deux fonctions génériques existent pour une raison de langage :
    // `fetch` et `fetchCount` réclament un type concret, alors que la
    // liste du conteneur est faite de types existentiels. Les passer en
    // paramètre générique laisse le compilateur ouvrir l'existentiel, et
    // c'est ce qui permet d'avoir UNE liste au lieu de deux.

    private static func effacerInstances<T: PersistentModel>(
        de type: T.Type, dans contexte: ModelContext
    ) throws -> Int {
        let objets = try contexte.fetch(FetchDescriptor<T>())
        for objet in objets { contexte.delete(objet) }
        return objets.count
    }

    private static func compter<T: PersistentModel>(
        _ type: T.Type, dans contexte: ModelContext
    ) throws -> Int {
        try contexte.fetchCount(FetchDescriptor<T>())
    }
}
