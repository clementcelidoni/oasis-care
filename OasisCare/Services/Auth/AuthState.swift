import Combine
import Foundation
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

    func signOut() async {
        try? await AuthService.signOut()
    }
}
