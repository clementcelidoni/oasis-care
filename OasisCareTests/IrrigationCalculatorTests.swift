import XCTest
@testable import OasisCare

/// Spec §83's own worked example (8 L/h × 4 emitters × 0.75h = 24L) is the
/// mandatory case here — water-usage numbers are shown directly to the
/// user, so a silent arithmetic bug would misreport real consumption.
final class IrrigationCalculatorTests: XCTestCase {
    func testPerPlantLitersMatchesSpecWorkedExample() {
        let liters = IrrigationCalculator.litersUsed(
            emitterCount: 4,
            emitterFlowRateLitersPerHour: 8,
            durationMinutes: 45
        )
        XCTAssertEqual(liters, 24, accuracy: 0.0001)
    }

    func testZoneLitersForOneHourEqualsFlowRate() {
        let liters = IrrigationCalculator.zoneLitersUsed(flowRateLitersPerHour: 240, durationMinutes: 60)
        XCTAssertEqual(liters, 240, accuracy: 0.0001)
    }

    func testZoneLitersHalfHourIsHalfFlowRate() {
        let liters = IrrigationCalculator.zoneLitersUsed(flowRateLitersPerHour: 240, durationMinutes: 30)
        XCTAssertEqual(liters, 120, accuracy: 0.0001)
    }

    func testZeroDurationUsesNoWater() {
        let liters = IrrigationCalculator.litersUsed(emitterCount: 4, emitterFlowRateLitersPerHour: 8, durationMinutes: 0)
        XCTAssertEqual(liters, 0, accuracy: 0.0001)
    }

    func testZeroEmittersUsesNoWaterRegardlessOfDuration() {
        let liters = IrrigationCalculator.litersUsed(emitterCount: 0, emitterFlowRateLitersPerHour: 8, durationMinutes: 90)
        XCTAssertEqual(liters, 0, accuracy: 0.0001)
    }
}
