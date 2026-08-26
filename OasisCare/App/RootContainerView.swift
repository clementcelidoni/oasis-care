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
    @ObservedObject private var deepLinkRouter = DeepLinkRouter.shared
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
            // Independent of auth status: a guest's Apple ID can still
            // hold a real subscription (StoreKit doesn't require this
            // app's own account), consistent with guest mode otherwise
            // keeping full local functionality.
            StoreKitService.shared.start()
        }
        .onChange(of: authState.status) { _, newStatus in
            guard case .authenticated = newStatus else { return }
            Task { await syncEngine.syncIfPossible(context: modelContext) }
            deepLinkRouter.retryPendingTokenIfNeeded(context: modelContext)
            Task { await CommercialConfigService.refresh() }
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task { await syncEngine.syncIfPossible(context: modelContext) }
        }
        .onOpenURL { url in
            deepLinkRouter.handle(url: url, context: modelContext)
        }
    }
}
