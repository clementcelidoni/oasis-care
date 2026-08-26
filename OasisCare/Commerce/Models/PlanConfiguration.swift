import Foundation

/// Phase 12 §"Configuration des plans" — "Les limites doivent être
/// configurables et non dispersées dans le code." `nil` means
/// unlimited. Every number here is a reasonable, adjustable starting
/// point for launch, not a researched business decision — see
/// PlanConfigurationStore's own doc comment and the Phase 12 report's
/// pricing section for why these specific numbers were picked and how
/// to change them later without touching feature code.
struct UsageLimits: Codable, Equatable {
    var maxPlants: Int?
    var maxGardens: Int?
    var maxPhotosPerPlant: Int?
    var aiRequestsPerMonth: Int?

    static let unlimited = UsageLimits(maxPlants: nil, maxGardens: nil, maxPhotosPerPlant: nil, aiRequestsPerMonth: nil)
}

/// Phase 12 §"Configuration des plans."
struct PlanConfiguration: Codable, Identifiable, Equatable {
    var planId: OasisPlan
    var id: OasisPlan { planId }
    var displayName: String
    var entitlements: Set<Entitlement>
    var usageLimits: UsageLimits
    var isAvailable: Bool
    var sortOrder: Int
}
