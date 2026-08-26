import XCTest
@testable import OasisCare

/// Phase 12 §"RÈGLE ABSOLUE" — a downgrade must be announced (so a
/// feature doesn't just silently vanish) but must never over-report: a
/// Premium→Free transition should name only what Premium added on top
/// of Free, never Free's own baseline (plantManagement, cloudSync...),
/// which the user still has. This directly guards the bug once found in
/// EntitlementSnapshot.free (it used to be an empty set, which would
/// have made every downgrade notice falsely claim the user lost their
/// free-tier features too).
final class DowngradePolicyTests: XCTestCase {
    private func snapshot(plan: OasisPlan) -> EntitlementSnapshot {
        EntitlementSnapshot(
            plan: plan,
            activeEntitlements: PlanConfigurationStore.defaults[plan]!.entitlements,
            expirationDate: nil,
            subscriptionStatus: plan == .free ? .none : .subscribed,
            lastVerifiedAt: .now,
            source: plan == .free ? .free : .storeKit
        )
    }

    func testNoChangeIsNotADowngrade() {
        let snap = snapshot(plan: .premium)
        XCTAssertFalse(DowngradePolicy.isDowngrade(previous: snap, current: snap))
    }

    func testUpgradeIsNotADowngrade() {
        let free = snapshot(plan: .free)
        let premium = snapshot(plan: .premium)
        XCTAssertFalse(DowngradePolicy.isDowngrade(previous: free, current: premium))
        XCTAssertTrue(DowngradePolicy.lostEntitlements(previous: free, current: premium).isEmpty)
    }

    func testPremiumToFreeDowngradeLosesOnlyThePremiumAdditions() {
        let premium = snapshot(plan: .premium)
        let free = snapshot(plan: .free)
        let lost = DowngradePolicy.lostEntitlements(previous: premium, current: free)

        XCTAssertTrue(lost.contains(.digitalTwin))
        XCTAssertTrue(lost.contains(.multipleGardens))
        // Free's own baseline must NOT appear as "lost" — regression
        // guard for the EntitlementSnapshot.free-was-empty bug.
        XCTAssertFalse(lost.contains(.plantManagement))
        XCTAssertFalse(lost.contains(.cloudSync))
        XCTAssertFalse(lost.contains(.aiIdentification))
        XCTAssertFalse(lost.contains(.dataExport))
    }

    func testBioLabToPremiumDowngradeLosesOnlyBioLabAdditions() {
        let biolab = snapshot(plan: .biolab)
        let premium = snapshot(plan: .premium)
        let lost = DowngradePolicy.lostEntitlements(previous: biolab, current: premium)

        XCTAssertTrue(lost.contains(.biolab))
        XCTAssertTrue(lost.contains(.bioreactors))
        XCTAssertFalse(lost.contains(.digitalTwin), "Premium still grants this")
    }

    func testNoticeIsNilWhenNothingWasLost() {
        XCTAssertNil(DowngradePolicy.notice(for: []))
    }

    func testNoticeNamesLostFeaturesInFrench() {
        let notice = DowngradePolicy.notice(for: [.digitalTwin])
        XCTAssertNotNil(notice)
        XCTAssertTrue(notice!.contains("Digital Twin"))
    }
}
