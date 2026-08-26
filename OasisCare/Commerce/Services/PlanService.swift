import Foundation

/// Phase 12 §"Architecture commerciale." Holds the active
/// `PlanConfiguration` set — `PlanConfigurationStore.defaults` unless
/// `CommercialConfigService` has fetched a remote override (§12O). Pure
/// configuration lookup; never decides what the CURRENT user has (that
/// is EntitlementService's job) — this only answers "what does the
/// Premium plan include," not "does this user have Premium."
@MainActor
final class PlanService: ObservableObject {
    static let shared = PlanService()

    @Published private(set) var configurations: [OasisPlan: PlanConfiguration]

    private init() {
        configurations = PlanConfigurationStore.defaults
    }

    func configuration(for plan: OasisPlan) -> PlanConfiguration {
        configurations[plan] ?? PlanConfigurationStore.defaults[plan] ?? PlanConfigurationStore.defaults[.free]!
    }

    var availablePlans: [PlanConfiguration] {
        configurations.values.filter(\.isAvailable).sorted { $0.sortOrder < $1.sortOrder }
    }

    /// §12O "Créer remote commercial config pour quotas, limites Free,
    /// textes optionnels et flags." Only ever narrows/adjusts NUMBERS
    /// (usage limits) — never lets a remote source add an entitlement a
    /// real purchase didn't grant (§12O "Ne jamais permettre de
    /// modifier les entitlements payants depuis une config non
    /// sécurisée"): entitlement sets always come from
    /// `PlanConfigurationStore.defaults`, only `usageLimits` is
    /// overridable.
    func applyRemoteUsageLimits(_ limitsByPlan: [OasisPlan: UsageLimits]) {
        var updated = configurations
        for (plan, limits) in limitsByPlan {
            guard var configuration = updated[plan] else { continue }
            configuration.usageLimits = limits
            updated[plan] = configuration
        }
        configurations = updated
    }
}
