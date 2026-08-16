import SwiftUI

/// Top-level router driven by AuthState. `hasSeenWelcome` is a separate,
/// simpler flag from AuthState.status: an existing Phase 1/2 user (or
/// anyone who already tapped "Continuer sans compte" once) must never be
/// routed back through Welcome just because they're signed out — per the
/// spec, an accountless user keeps full access to local functionality.
struct RootContainerView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase

    @ObservedObject private var authState = AuthState.shared
    @ObservedObject private var syncEngine = SyncEngine.shared
    @AppStorage("hasSeenWelcome") private var hasSeenWelcome = false

    var body: some View {
        Group {
            switch authState.status {
            case .loading:
                ProgressView()
            case .authenticated:
                RootTabView()
            case .guest:
                if hasSeenWelcome {
                    RootTabView()
                } else {
                    WelcomeView {
                        hasSeenWelcome = true
                    }
                }
            }
        }
        .task {
            authState.start()
        }
        .onChange(of: authState.status) { _, newStatus in
            guard case .authenticated = newStatus else { return }
            Task { await syncEngine.syncIfPossible(context: modelContext) }
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task { await syncEngine.syncIfPossible(context: modelContext) }
        }
    }
}
