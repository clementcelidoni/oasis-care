import Foundation

/// Phase 12 §"RÈGLE ABSOLUE" — "Un utilisateur qui dépasse une future
/// limite Free doit pouvoir continuer à consulter ses données. Les
/// limitations peuvent empêcher de créer davantage... mais JAMAIS
/// supprimer automatiquement." This service only ever answers "can one
/// more be created," never "should existing ones be hidden or
/// removed" — every call site keeps showing 100% of a user's real data
/// regardless of the answer.
///
/// Pure functions over counts the caller already has (a `@Query`
/// count, typically) — no SwiftData access here, matching this app's
/// established "pure, testable service" shape (e.g. BioLabAnalyticsService).
enum UsageLimitService {
    struct Check: Equatable {
        var isWithinLimit: Bool
        var current: Int
        var max: Int?
    }

    static func check(current: Int, max: Int?) -> Check {
        guard let max else { return Check(isWithinLimit: true, current: current, max: nil) }
        return Check(isWithinLimit: current < max, current: current, max: max)
    }

    static func canAddPlant(currentCount: Int, limits: UsageLimits) -> Check {
        check(current: currentCount, max: limits.maxPlants)
    }

    static func canAddGarden(currentCount: Int, limits: UsageLimits) -> Check {
        check(current: currentCount, max: limits.maxGardens)
    }

    static func canAddPhoto(currentCountForPlant: Int, limits: UsageLimits) -> Check {
        check(current: currentCountForPlant, max: limits.maxPhotosPerPlant)
    }
}
