import Foundation

/// Phase 12 §12N "ANALYTICS RESPECTUEUX DE LA VIE PRIVÉE." First-party
/// only (no third-party SDK, no advertising identifier, no ATT prompt —
/// this app doesn't do anything ATT would even apply to). `detail` must
/// never carry a plant name, note, photo, or BioLab content — only a
/// short, non-identifying value like a plan name or product id (spec's
/// own rule, restated in `track`'s doc comment since it's easy to
/// violate by accident at a call site).
enum AnalyticsEvent: String {
    case onboardingStarted = "onboarding_started"
    case onboardingCompleted = "onboarding_completed"
    case paywallViewed = "paywall_viewed"
    case purchaseStarted = "purchase_started"
    case purchaseCompleted = "purchase_completed"
    case purchaseFailed = "purchase_failed"
    case restoreStarted = "restore_started"
    case restoreCompleted = "restore_completed"
    case featureLockedViewed = "feature_locked_viewed"
    case plantCreated = "plant_created"
    case gardenCreated = "garden_created"
    case aiFeatureUsed = "ai_feature_used"
    case biolabStarted = "biolab_started"
}

enum PurchaseAnalyticsService {
    /// `detail`: a short, non-identifying value only (a plan/product
    /// id, an entitlement name) — never user-authored text.
    static func track(_ event: AnalyticsEvent, detail: String? = nil) {
        Task.detached(priority: .background) {
            guard case .authenticated = await AuthState.shared.status else { return }
            struct EventRow: Encodable {
                var eventName: String
                var detail: String?

                enum CodingKeys: String, CodingKey {
                    case eventName = "event_name"
                    case detail
                }
            }
            try? await AuthService.client.from("analytics_events")
                .insert(EventRow(eventName: event.rawValue, detail: detail))
                .execute()
        }
    }
}
