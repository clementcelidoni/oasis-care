import Foundation
import SwiftData

/// §15, §50 — l'ouverture d'un lien d'étiquette, et sa remise à
/// `RootTabView`.
///
/// Accepte les deux formes que `SmartTagConfig.token(from:)` connaît :
/// un lien universel `https://<hôte>/x/<jeton>` (ou l'ancien `/p/`, celui
/// des cinq étiquettes déjà collées) et le schéma personnalisé
/// `com.oasisrarecare.app://x/<jeton>`.
///
/// ══════════════════════════════════════════════════════════════════
/// CE QUI ÉTAIT CASSÉ ICI, ET C'ÉTAIT LE PLUS SOURNOIS
/// ══════════════════════════════════════════════════════════════════
///
/// Le repli réseau s'écrivait `if let plantID = try? await …` : l'erreur
/// était AVALÉE, `pendingPlantID` restait nul, et l'écran ne bougeait
/// pas. L'utilisateur voyait un lien qui ne faisait rien — pas un
/// message, pas un échec, rien. Et comme l'appel ne demandait que
/// `plant_id`, tout ce qui n'était pas une plante rendait NULL : sur les
/// cinq étiquettes de production, trois tombaient dans ce silence.
///
/// Désormais tout passe par `SmartTagService.resoudre`, et les quatre
/// issues sont publiées. Aucune n'est muette.
///
/// Séparé de `NotificationRouter` bien que les deux finissent sur la
/// même feuille : ce sont deux événements de nature différente, et les
/// confondre par le nom se lirait mal au point d'appel.
@MainActor
final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()

    /// Le chemin historique, conservé tel quel : `RootTabView` et
    /// `NotificationRouter` s'en servent déjà tous les deux, et une
    /// plante reste la destination la plus fréquente.
    @Published var pendingPlantID: UUID?

    /// Un objet local qui n'est pas une plante — un lot de culture, un
    /// incubateur, un rack.
    @Published var pendingScan: SmartTagScanResult?

    /// Ce que le serveur a répondu quand cet appareil n'a pas l'objet :
    /// une fiche publiée, une étiquette vierge, un refus, ou une
    /// reconnaissance sans fiche locale.
    @Published var pendingEtiquette: EtiquetteResolue?

    /// Posé uniquement quand un jeton n'a pas pu être résolu faute de
    /// connexion, et rejoué après l'ouverture de session (§ 50 :
    /// « connexion nécessaire → conserver destination »).
    private var pendingToken: String?

    private init() {}

    func handle(url: URL, context: ModelContext) {
        guard let token = SmartTagConfig.token(from: url) else { return }
        resolve(token: token, context: context)
    }

    func retryPendingTokenIfNeeded(context: ModelContext) {
        guard let token = pendingToken else { return }
        resolve(token: token, context: context)
    }

    private func resolve(token: String, context: ModelContext) {
        // LE RACCOURCI LOCAL D'ABORD, EN SYNCHRONE. Il évite d'ouvrir une
        // tâche et de faire clignoter l'écran pour la donnée qu'on a déjà
        // sous la main — c'est le cas normal, et le seul qui marche hors
        // ligne. On lit la cible COMPLÈTE, comme le font les scanners :
        // l'ancienne version n'acceptait ici que `tag.plant`, si bien
        // qu'un lien vers un lot de culture ou un rack tombait dans la
        // branche suivante et finissait au mieux en attente de connexion.
        if let tag = SmartTagService.existingTag(forToken: token, in: context),
           let resultat = SmartTagService.scanResult(for: tag) {
            pendingToken = nil
            SmartTagService.markScanned(tag)
            if case .plant(let plant) = resultat {
                pendingPlantID = plant.id
            } else {
                pendingScan = resultat
            }
            return
        }

        // PAS DE SESSION : ON GARDE LE JETON POUR APRÈS LA CONNEXION.
        //
        // On pourrait interroger le serveur en anonyme — il rendrait la
        // fiche publiée s'il y en a une. On ne le fait PAS : arriver sur
        // l'application par un lien alors qu'on n'est pas connecté veut
        // presque toujours dire « je viens de m'installer », et montrer
        // une fiche botanique de trois lignes à quelqu'un qui allait
        // ouvrir SA plante serait une régression. Le jeton est rejoué
        // dès l'ouverture de session.
        guard case .authenticated = AuthState.shared.status else {
            pendingToken = token
            return
        }

        pendingToken = nil
        Task {
            switch await SmartTagService.resoudre(jeton: token, in: context) {
            case .locale(.plant(let plant)):
                pendingPlantID = plant.id
            case .locale(let resultat):
                pendingScan = resultat
            case .distante(let etiquette):
                pendingEtiquette = etiquette
            case .refusee(let phrase):
                // PLUS DE SILENCE. Un refus se présente comme le serveur
                // l'a formulé, dans la même feuille que les autres
                // réponses distantes.
                pendingEtiquette = EtiquetteResolue(ok: false, message: phrase)
            case .injoignable:
                pendingEtiquette = EtiquetteResolue(
                    ok: false,
                    message: SmartTagService.phraseInjoignable
                )
            }
        }
    }
}
