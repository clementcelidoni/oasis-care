import Combine
import Foundation

/// L'ENDROIT UNIQUE OÙ L'APPLICATION SAIT DANS QUEL ESPACE ELLE TRAVAILLE.
///
/// Même forme, même famille et même discipline qu'`EntitlementService` :
/// un singleton `ObservableObject`, un état publié, un seul « setter »
/// explicite, un cache `UserDefaults` qui n'est qu'un confort hors ligne,
/// et surtout — la règle qui compte — il n'invente JAMAIS un droit. Là où
/// `EntitlementService` retombe sur `.free` tant qu'aucun instantané
/// vérifié n'est arrivé, celui-ci retombe sur l'ESPACE PERSONNEL tant que
/// l'utilisateur n'a pas dit autre chose.
///
/// ──────────────────────────────────────────────────────────────────
/// CE QUE CE LOT FAIT, ET CE QU'IL NE FAIT PAS. À LIRE AVANT DE TOUCHER
/// À `writeWorkspaceID`.
/// ──────────────────────────────────────────────────────────────────
///
/// IL FAIT : le compte sait enfin à quels espaces il appartient, le
/// choix d'un contexte de travail est possible, explicite, visible à
/// l'écran, retenu d'un lancement à l'autre, lié au compte qui l'a fait,
/// et effacé à la déconnexion.
///
/// IL NE FAIT PAS : basculer les écritures. `writeWorkspaceID` rend
/// TOUJOURS l'espace personnel, exactement comme
/// `SyncEngine.fetchWorkspaceID()` le faisait avant ce lot. Un compte
/// sans entreprise ne voit donc strictement aucune différence, et aucune
/// donnée ne bouge d'un octet.
///
/// POURQUOI PAS, PUISQUE C'EST LE DÉFAUT À CORRIGER. Parce que faire
/// rendre à cette propriété l'espace choisi déplacerait des données
/// existantes sans le dire, et dans le mauvais sens. Trois faits, tous
/// vérifiables dans ce dépôt :
///
///  1. 41 des 42 envois de `SyncEngine` estampillent la ligne avec
///     l'espace qu'on leur passe, sans condition — `pushPlants` fait
///     `workspaceId: workspaceID`. Le seul qui sache faire autrement est
///     `pushGardens`, parce que `Garden` porte `remoteWorkspaceID` et
///     qu'il écrit `$0.remoteWorkspaceID ?? workspaceID` : le jardin
///     retourne dans l'espace d'où il vient, et seul un jardin né ici
///     reçoit l'espace du téléphone.
///
///  2. Sans cet équivalent de `remoteWorkspaceID` sur les 41 autres
///     types, changer de contexte puis MODIFIER une culture BioLab déjà
///     synchronisée la ferait basculer de l'espace privé vers celui de
///     l'entreprise — donc lisible par tout salarié. C'est mot pour mot
///     la fuite décrite dans le commentaire de `fetchWorkspaceID`, et
///     elle serait silencieuse et partielle : la moitié des cultures
///     d'un côté, la moitié de l'autre.
///
///  3. On ne peut pas non plus s'en tirer en vidant le local à chaque
///     bascule, comme le fait la déconnexion : la synchronisation est
///     essentiellement montante. Hors du Digital Twin
///     (`pullDigitalTwin`) et du tout premier démarrage
///     (`restoreFromCloudIfNeeded`), RIEN ne redescend. Un contexte
///     vidé ne se remplirait jamais, et l'utilisateur aurait perdu
///     l'accès à ses propres données depuis son téléphone.
///
/// CE QU'IL FAUT DONC AVANT DE CHANGER `writeWorkspaceID`, et rien de
/// moins : l'équivalent de `Garden.remoteWorkspaceID` sur les types
/// `@Model` qui portent aujourd'hui un `workspaceId` à l'envoi — chacun
/// avec sa VALEUR PAR DÉFAUT EN LIGNE, sans quoi la migration SwiftData
/// échoue chez l'utilisateur sans que l'intégration continue le voie —
/// puis, dans chaque envoi correspondant, le même
/// `record.remoteWorkspaceID ?? workspaceID` que `pushGardens`.
///
/// CE QUE LA BASE FAIT DÉJÀ À NOTRE PLACE, et qui explique que le pire
/// cas soit déjà couvert : depuis la migration 0086, le déclencheur
/// `enforce_garden_child_workspace` recale sur l'espace de leur jardin
/// les enfants de jardin envoyés par le téléphone (plantes, capteurs,
/// équipements, zones d'arrosage, serres, bassins, scènes, bilans, plus
/// les sept tables du plan). Une plante ajoutée depuis l'iPhone dans un
/// jardin livré arrive donc au bon endroit sans une ligne de Swift. Ce
/// qui reste sans filet, ce sont les entités qui n'ont PAS de jardin
/// pour dire où elles vont — la famille BioLab au premier chef, celle
/// que le dirigeant cite en exemple.
@MainActor
final class WorkspaceContextService: ObservableObject {
    static let shared = WorkspaceContextService()

    /// Les espaces auxquels le compte connecté appartient, tels que RLS
    /// les a rendus. Vide tant qu'aucune lecture n'a abouti — jamais
    /// peuplé par déduction.
    @Published private(set) var available: [WorkspaceContext] = []

    /// Le choix explicite de l'utilisateur, s'il en a fait un ET s'il
    /// désigne encore un espace accessible. Nul veut dire « aucun choix
    /// exprimé » et se lit comme « l'espace personnel ».
    @Published private(set) var preferredID: UUID?

    @Published private(set) var isRefreshing = false

    /// Renseignée uniquement par le chemin d'écran (`refresh()`), qui ne
    /// doit jamais lever. Le chemin de la synchronisation, lui, propage
    /// l'erreur pour que `SyncEngine` la montre comme avant.
    @Published private(set) var lastRefreshError: String?

    private let directory: WorkspaceDirectory
    private let storage: WorkspaceContextStorage

    /// Le compte auquel `available` et `preferredID` se rapportent.
    /// C'est la garde contre le cache d'un ancien contexte : tant que
    /// cette valeur ne correspond pas au compte courant, ce qui est en
    /// mémoire n'est pas à lui et n'a pas le droit de servir.
    private(set) var loadedAccountID: UUID?

    init(
        directory: WorkspaceDirectory = SupabaseWorkspaceDirectory(),
        storage: WorkspaceContextStorage = UserDefaultsWorkspaceContextStorage()
    ) {
        self.directory = directory
        self.storage = storage
    }

    // MARK: - Les règles, isolées et sans réseau

    /// L'ESPACE PERSONNEL, DE FAÇON REPRODUCTIBLE.
    ///
    /// Reproduit exactement ce que faisait la requête d'origine
    /// (`is_personal = true`, tri sur `created_at` croissant, un seul),
    /// et ajoute le départage par identifiant : deux espaces créés dans
    /// la même milliseconde rendraient sinon l'un ou l'autre selon
    /// l'ordre physique des lignes — le défaut même que le tri était
    /// venu corriger.
    static func personalWorkspace(in contexts: [WorkspaceContext]) -> WorkspaceContext? {
        contexts
            .filter { $0.isPersonal }
            .min { left, right in
                if left.createdAt != right.createdAt { return left.createdAt < right.createdAt }
                return left.id.uuidString < right.id.uuidString
            }
    }

    /// LE CONTEXTE ACTIF : le choix de l'utilisateur s'il désigne un
    /// espace auquel il appartient TOUJOURS, l'espace personnel sinon.
    ///
    /// La seconde condition n'est pas de la prudence de façade : un
    /// salarié retiré de son entreprise garde sa préférence sur le
    /// téléphone alors que RLS ne lui rend plus cet espace. Sans cette
    /// vérification, l'écran afficherait un contexte qui n'existe plus.
    static func resolveActive(in contexts: [WorkspaceContext], preferredID: UUID?) -> WorkspaceContext? {
        if let preferredID, let chosen = contexts.first(where: { $0.id == preferredID }) {
            return chosen
        }
        return personalWorkspace(in: contexts)
    }

    // MARK: - État dérivé

    var personal: WorkspaceContext? { Self.personalWorkspace(in: available) }

    var active: WorkspaceContext? { Self.resolveActive(in: available, preferredID: preferredID) }

    /// L'ESPACE DANS LEQUEL LE TÉLÉPHONE ÉCRIT. Toujours le personnel —
    /// voir le grand commentaire en tête de classe. C'est la seule ligne
    /// à changer le jour où l'estampille par enregistrement sera posée,
    /// et il ne faut pas la changer avant.
    var writeWorkspaceID: UUID? { personal?.id }

    /// Vrai quand le contexte affiché est aussi celui où l'on écrit —
    /// donc faux dès que l'utilisateur a choisi une entreprise. L'écran
    /// s'en sert pour le dire franchement au lieu de laisser croire.
    var activeContextReceivesWrites: Bool {
        guard let activeID = active?.id, let writeID = writeWorkspaceID else { return false }
        return activeID == writeID
    }

    var hasProfessionalContext: Bool { available.contains { $0.isProfessional } }

    // MARK: - Lecture

    /// Le chemin de la SYNCHRONISATION. Il propage l'erreur, parce que
    /// `SyncEngine` a toujours interrompu la synchronisation quand
    /// l'espace ne pouvait pas être lu, et qu'un envoi lancé sans savoir
    /// où il va serait pire qu'une synchronisation reportée.
    ///
    /// Rend `nil` — sans lever — dans le seul cas où la lecture a
    /// abouti mais ne contient aucun espace personnel : ce n'est pas une
    /// panne de réseau, et l'appelant doit pouvoir distinguer les deux.
    ///
    /// RELIT QUAND IL LE FAUT, ET SEULEMENT ALORS : dès que le compte a
    /// changé, et tant qu'aucun espace d'écriture n'a été trouvé.
    /// L'espace personnel d'un compte ne change jamais, donc il n'y a
    /// rien à rafraîchir entre deux synchronisations du même compte ;
    /// en revanche, servir la liste d'un AUTRE compte serait exactement
    /// la fuite d'un monde vers l'autre.
    ///
    /// La seconde condition porte sur `writeWorkspaceID` et non sur
    /// `available.isEmpty` : une liste non vide qui ne contiendrait
    /// aucun espace personnel resterait sinon figée pour toute la durée
    /// de la session, alors que l'ancienne requête, elle, réessayait à
    /// chaque synchronisation.
    func resolveWriteWorkspaceID() async throws -> UUID? {
        guard let accountID = currentAccountID else { return nil }
        if loadedAccountID != accountID || writeWorkspaceID == nil {
            try await load(accountID: accountID)
        }
        return writeWorkspaceID
    }

    /// Le chemin de l'ÉCRAN. Il ne lève jamais : une liste d'espaces
    /// qu'on n'a pas pu relire n'est pas une raison de faire échouer un
    /// affichage.
    func refresh() async {
        guard let accountID = currentAccountID else {
            forgetLoadedAccount()
            return
        }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            try await load(accountID: accountID)
            lastRefreshError = nil
        } catch {
            lastRefreshError = error.localizedDescription
            OasisLog.sync.error("Contexte de travail : lecture des espaces impossible.")
        }
    }

    /// La lecture proprement dite. Interne et non privée pour que les
    /// tests puissent la déclencher avec un compte donné, sans session
    /// Supabase.
    func load(accountID: UUID) async throws {
        // Avant toute chose : si ce qui est en mémoire appartient à un
        // AUTRE compte, on l'oublie. Sinon, le temps de la requête,
        // l'écran montrerait les espaces du compte précédent.
        if loadedAccountID != accountID { forgetLoadedAccount() }

        let contexts = try await directory.fetchContexts()
        available = contexts
        loadedAccountID = accountID

        let stored = storage.loadPreference()
        if let stored, stored.accountID == accountID,
           contexts.contains(where: { $0.id == stored.workspaceID }) {
            preferredID = stored.workspaceID
        } else {
            // Effacée, pas seulement ignorée : une préférence qui ne
            // vaut plus rien — posée par un autre compte, ou désignant
            // un espace dont l'utilisateur a été retiré — finirait par
            // ressusciter au prochain lancement si on la laissait là.
            preferredID = nil
            if stored != nil { storage.clearPreference() }
        }
    }

    // MARK: - Choix

    /// LE SEUL POINT D'ENTRÉE DU CHOIX, et il exige que l'espace fasse
    /// partie de ceux que RLS a rendus. Un identifiant venu d'ailleurs
    /// n'ouvrirait rien côté serveur, mais il ferait mentir l'écran, et
    /// c'est déjà trop.
    @discardableResult
    func select(_ context: WorkspaceContext) -> Bool {
        guard let accountID = currentAccountID else { return false }
        return select(context, accountID: accountID)
    }

    /// La même chose, le compte donné explicitement. Interne et non
    /// privée pour la même raison que `load(accountID:)` : c'est ce que
    /// les tests peuvent appeler sans session Supabase. L'écran passe
    /// toujours par la version au-dessus.
    @discardableResult
    func select(_ context: WorkspaceContext, accountID: UUID) -> Bool {
        guard accountID == loadedAccountID,
              available.contains(where: { $0.id == context.id })
        else { return false }

        preferredID = context.id
        storage.savePreference(
            WorkspaceContextPreference(accountID: accountID, workspaceID: context.id)
        )
        return true
    }

    // MARK: - Oubli

    /// LA DÉCONNEXION. Mémoire ET disque : un appareil déconnecté ne doit
    /// rien garder du compte précédent, pas même le contexte dans lequel
    /// il travaillait. C'est la règle que `signOutClearingLocalData`
    /// applique déjà aux jardins et aux végétaux.
    func clear() {
        forgetLoadedAccount()
        storage.clearPreference()
    }

    /// L'oubli de la mémoire SEULE — quand le compte change ou qu'aucune
    /// session n'est ouverte. La préférence sur disque survit exprès :
    /// elle porte son compte, et `load(accountID:)` la revalidera. La
    /// jeter ici ferait perdre son choix à l'utilisateur à chaque
    /// lancement.
    func forgetLoadedAccount() {
        available = []
        preferredID = nil
        loadedAccountID = nil
        lastRefreshError = nil
    }

    private var currentAccountID: UUID? {
        guard case .authenticated = AuthState.shared.status else { return nil }
        return AuthState.shared.session?.user.id
    }
}
