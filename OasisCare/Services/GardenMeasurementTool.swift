import Foundation

/// Spec Phase 6K — "GardenMeasurementTool." Pure geometry over whatever
/// points the user has tapped on the plan; area itself is delegated to
/// GardenGeometry.areaSquareMeters (already built in 6D/6F for zones)
/// rather than a second area formula, so every polygon in the app —
/// zones, sun-exposure shapes, and now ad-hoc measurements — agrees by
/// construction.
enum GardenMeasurementTool {
    /// "Mesure manuelle" — straight-line distance between two points.
    static func distanceMeters(_ a: GardenCoordinate, _ b: GardenCoordinate) -> Double {
        a.distance(to: b)
    }

    /// Sum of consecutive segment lengths. `closed: false` is an open
    /// path (a run of manual measurement taps, or a pipe's own
    /// length); `closed: true` additionally wraps the last point back
    /// to the first — "Périmètre."
    static func pathLengthMeters(_ points: [GardenCoordinate], closed: Bool) -> Double {
        guard points.count >= 2 else { return 0 }
        var total = 0.0
        for index in 1..<points.count {
            total += points[index - 1].distance(to: points[index])
        }
        if closed, points.count >= 3 {
            total += points[points.count - 1].distance(to: points[0])
        }
        return total
    }

    /// "Mesure de surface" — thin passthrough to GardenGeometry so this
    /// service is the one coherent place every measurement in spec's
    /// "MESURES ET SCAN" section reads from.
    static func areaSquareMeters(_ points: [GardenCoordinate]) -> Double {
        GardenGeometry.areaSquareMeters(of: points)
    }

    /// "Longueurs irrigation... calcul automatique" — total real pipe
    /// length across the whole garden, summing each IrrigationPipe's
    /// own totalLengthMeters (Phase 6D) rather than recomputing it.
    static func totalIrrigationLengthMeters(_ pipes: [IrrigationPipe]) -> Double {
        pipes.reduce(0) { $0 + $1.totalLengthMeters }
    }
}
