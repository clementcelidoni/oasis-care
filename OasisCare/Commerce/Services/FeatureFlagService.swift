import Foundation

/// Phase 12 §"12O — FEATURE FLAGS." "Les flags ne doivent jamais
/// contourner les protections serveur" — this only toggles UI-level
/// behavior (show/hide a paywall entry point, show/hide a new
/// onboarding), never an entitlement: even with every flag here
/// forced `true`, a feature still only actually works if
/// EntitlementService.has(_:) independently agrees.
enum FeatureFlag: String {
    case biolabPaywallEnabled
    case premiumPaywallEnabled
    case newOnboardingEnabled
    case aiDiagnosisEnabled
}

@MainActor
final class FeatureFlagService: ObservableObject {
    static let shared = FeatureFlagService()

    @Published private(set) var flags: [String: Bool] = [
        FeatureFlag.biolabPaywallEnabled.rawValue: true,
        FeatureFlag.premiumPaywallEnabled.rawValue: true,
        FeatureFlag.newOnboardingEnabled.rawValue: true,
        FeatureFlag.aiDiagnosisEnabled.rawValue: true,
    ]

    private init() {}

    func isEnabled(_ flag: FeatureFlag) -> Bool {
        flags[flag.rawValue] ?? false
    }

    /// Called by CommercialConfigService once it has fetched
    /// `feature_flags` from Supabase — until then (offline, first
    /// launch before any fetch completes), the safe defaults above
    /// apply, matching this app's "never block on a server round-trip
    /// for something that can have a sane local default" pattern.
    func applyRemote(_ remoteFlags: [String: Bool]) {
        flags.merge(remoteFlags) { _, remote in remote }
    }
}
