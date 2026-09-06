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

    /// Signs out and wipes local synced data — a signed-out device must
    /// never keep showing the previous account's plants/gardens/photos to
    /// whoever uses the app next, per the spec's shared-device concern.
    /// Callers are responsible for warning the user first if
    /// SyncEngine.pendingCount is non-zero, since anything unsynced is
    /// lost here, not just hidden.
    func signOutClearingLocalData(context: ModelContext) async {
        try? await AuthService.signOut()
        // Mémoire ET disque, à la différence du changement de compte
        // ci-dessus : un appareil déconnecté ne garde rien du compte
        // précédent, pas même le contexte dans lequel il travaillait.
        // Même règle que les jardins et les végétaux juste en dessous.
        WorkspaceContextService.shared.clear()
        Self.clearLocalData(context: context)
    }

    private static func clearLocalData(context: ModelContext) {
        do {
            try context.delete(model: CareEvent.self)
            try context.delete(model: CareSchedule.self)
            try context.delete(model: PlantPhoto.self)
            try context.delete(model: Plant.self)
            try context.delete(model: GardenZone.self)
            try context.delete(model: Garden.self)
            try context.delete(model: PendingDeletion.self)
            try context.save()
        } catch {
            // Best-effort: if this fails there's nothing more useful to do
            // than leave local data as-is until the next attempt.
        }
    }
}
