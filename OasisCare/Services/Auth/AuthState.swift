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
                self.session = session
                self.status = session == nil ? .guest : .authenticated
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
