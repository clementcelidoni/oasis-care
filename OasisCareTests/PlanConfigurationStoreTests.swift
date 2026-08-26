import XCTest
@testable import OasisCare

/// Phase 12 §"BioLab doit hériter des fonctions Premium" — a checkable
/// property, not just a comment: every entitlement Premium grants must
/// also appear in BioLab's set, and everything Free grants must appear
/// in Premium's. A regression here (e.g. someone editing BioLab's list
/// and forgetting a Premium entitlement) would silently downgrade a
/// paying BioLab subscriber's access to something Premium already had.
final class PlanConfigurationStoreTests: XCTestCase {
    private var defaults: [OasisPlan: PlanConfiguration] { PlanConfigurationStore.defaults }

    func testPremiumIsSupersetOfFree() {
        let free = defaults[.free]!.entitlements
        let premium = defaults[.premium]!.entitlements
        XCTAssertTrue(free.isSubset(of: premium))
    }

    func testBioLabIsSupersetOfPremium() {
        let premium = defaults[.premium]!.entitlements
        let biolab = defaults[.biolab]!.entitlements
        XCTAssertTrue(premium.isSubset(of: biolab))
    }

    func testBioLabAddsAtLeastOneBioLabSpecificEntitlement() {
        let premium = defaults[.premium]!.entitlements
        let biolab = defaults[.biolab]!.entitlements
        XCTAssertFalse(biolab.subtracting(premium).isEmpty)
    }

    func testProPlanIsNotAvailableForSale() {
        XCTAssertFalse(defaults[.pro]!.isAvailable)
    }

    func testFreePlanHasFiniteLimits() {
        let limits = defaults[.free]!.usageLimits
        XCTAssertNotNil(limits.maxPlants)
        XCTAssertNotNil(limits.maxGardens)
        XCTAssertNotNil(limits.maxPhotosPerPlant)
    }

    func testPremiumAndBioLabHaveUnlimitedPlantsAndGardens() {
        for plan: OasisPlan in [.premium, .biolab] {
            let limits = defaults[plan]!.usageLimits
            XCTAssertNil(limits.maxPlants, "\(plan) should not cap plant count")
            XCTAssertNil(limits.maxGardens, "\(plan) should not cap garden count")
        }
    }

    func testEveryPlanHasAConfiguration() {
        for plan in OasisPlan.allCases {
            XCTAssertNotNil(defaults[plan], "missing configuration for \(plan)")
        }
    }
}
