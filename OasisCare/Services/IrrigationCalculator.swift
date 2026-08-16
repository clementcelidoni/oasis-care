import Foundation

/// Spec §35-36. Pure arithmetic, kept in one place and unit-tested
/// (spec §83's own example: 8 L/h × 4 × 0.75h = 24L) since a wrong
/// water-usage number is the kind of bug that's easy to ship silently.
enum IrrigationCalculator {
    /// Per-plant estimate from its emitters (spec §34-35).
    static func litersUsed(emitterCount: Int, emitterFlowRateLitersPerHour: Double, durationMinutes: Int) -> Double {
        Double(emitterCount) * emitterFlowRateLitersPerHour * hours(durationMinutes)
    }

    /// Zone-level estimate from its combined flow rate (spec §36).
    static func zoneLitersUsed(flowRateLitersPerHour: Double, durationMinutes: Int) -> Double {
        flowRateLitersPerHour * hours(durationMinutes)
    }

    private static func hours(_ minutes: Int) -> Double {
        Double(minutes) / 60.0
    }
}
