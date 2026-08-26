import XCTest
@testable import OasisCare

/// Phase 12 §"RÈGLE ABSOLUE" — this service only ever gates CREATING
/// more, never hides what already exists, so the boundary condition
/// (current == max) matters: at exactly the limit, one more must be
/// refused, but the existing ones stay fully visible elsewhere (not
/// this service's concern — see FeatureGate/UsageLimitService's own
/// doc comment).
final class UsageLimitServiceTests: XCTestCase {
    func testNilMaxIsAlwaysWithinLimit() {
        let check = UsageLimitService.check(current: 10_000, max: nil)
        XCTAssertTrue(check.isWithinLimit)
    }

    func testBelowLimitIsWithinLimit() {
        let check = UsageLimitService.check(current: 4, max: 5)
        XCTAssertTrue(check.isWithinLimit)
    }

    func testAtLimitIsNotWithinLimit() {
        let check = UsageLimitService.check(current: 5, max: 5)
        XCTAssertFalse(check.isWithinLimit)
    }

    func testAboveLimitIsNotWithinLimit() {
        let check = UsageLimitService.check(current: 6, max: 5)
        XCTAssertFalse(check.isWithinLimit)
    }

    func testCanAddPlantUsesMaxPlantsFromLimits() {
        let limits = UsageLimits(maxPlants: 5, maxGardens: 1, maxPhotosPerPlant: 3, aiRequestsPerMonth: 10)
        XCTAssertTrue(UsageLimitService.canAddPlant(currentCount: 4, limits: limits).isWithinLimit)
        XCTAssertFalse(UsageLimitService.canAddPlant(currentCount: 5, limits: limits).isWithinLimit)
    }

    func testCanAddGardenUsesMaxGardensFromLimits() {
        let limits = UsageLimits(maxPlants: 5, maxGardens: 1, maxPhotosPerPlant: 3, aiRequestsPerMonth: 10)
        XCTAssertFalse(UsageLimitService.canAddGarden(currentCount: 1, limits: limits).isWithinLimit)
    }

    func testCanAddPhotoUsesMaxPhotosPerPlantFromLimits() {
        let limits = UsageLimits(maxPlants: 5, maxGardens: 1, maxPhotosPerPlant: 3, aiRequestsPerMonth: 10)
        XCTAssertTrue(UsageLimitService.canAddPhoto(currentCountForPlant: 2, limits: limits).isWithinLimit)
        XCTAssertFalse(UsageLimitService.canAddPhoto(currentCountForPlant: 3, limits: limits).isWithinLimit)
    }

    func testUnlimitedUsageLimitsAlwaysAllow() {
        XCTAssertTrue(UsageLimitService.canAddPlant(currentCount: 999, limits: .unlimited).isWithinLimit)
        XCTAssertTrue(UsageLimitService.canAddGarden(currentCount: 999, limits: .unlimited).isWithinLimit)
        XCTAssertTrue(UsageLimitService.canAddPhoto(currentCountForPlant: 999, limits: .unlimited).isWithinLimit)
    }
}
