import Foundation
import SwiftData

/// Resolves a `/p/<token>` link (Universal Link or the app's own
/// `com.oasisrarecare.app://` custom scheme — both accepted, see
/// `SmartTagConfig.token(from:)`) to a plant and hands it to RootTabView
/// the same way NotificationRouter hands off a tapped notification
/// (spec §50).
/// Kept separate from NotificationRouter since this is a different kind
/// of event with different semantics (a link opens the plant's fiche
/// directly; a notification tap does too, so they end up sharing
/// RootTabView's sheet — but conflating the two routers by name would
/// read oddly at the call site).
@MainActor
final class DeepLinkRouter: ObservableObject {
    static let shared = DeepLinkRouter()

    @Published var pendingPlantID: UUID?

    /// Set only when a token couldn't be resolved because no one is
    /// signed in yet — retried after sign-in completes (spec §50:
    /// "connexion nécessaire → conserver destination").
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
        if let tag = SmartTagService.existingTag(forToken: token, in: context), let plant = tag.plant {
            pendingToken = nil
            SmartTagService.markScanned(tag)
            pendingPlantID = plant.id
            return
        }

        guard case .authenticated = AuthState.shared.status else {
            pendingToken = token
            return
        }

        pendingToken = nil
        Task {
            if let plantID = try? await SmartTagService.resolveRemotely(token: token) {
                pendingPlantID = plantID
            }
        }
    }
}
