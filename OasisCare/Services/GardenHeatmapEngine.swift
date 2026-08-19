import Foundation

/// Spec Phase 6E — "GardenHeatmapEngine... interpolation entre capteurs
/// seulement si suffisamment de données existent. Ne pas donner une
/// fausse précision. Afficher Mesuré/Estimé distinctement."
///
/// Inverse-distance weighting (IDW, power 2) — the standard, simple
/// spatial interpolation method for exactly this "a handful of sensor
/// points, estimate the area between them" problem. Deliberately not a
/// more sophisticated method (kriging etc.): this app has no basis to
/// claim more precision than a small number of real sensors supports,
/// and IDW's own simplicity is easy to explain honestly to a user
/// ("closer sensors count more") in a way a fancier model wouldn't be.
enum GardenHeatmapEngine {
    struct Sample {
        var position: GardenCoordinate
        var value: Double
    }

    struct CellResult {
        var value: Double
        /// true when the cell is close enough to a real sensor to call
        /// its value measured rather than interpolated.
        var isMeasured: Bool
    }

    /// Spec's own "seulement si suffisamment de données" — two real
    /// points is the minimum for interpolation to mean anything at all
    /// spatially; below that, only cells right at a sensor itself
    /// (isMeasured) are shown, nothing else is estimated.
    static let minimumSamplesForInterpolation = 2
    static let measuredRadiusMeters = 1.0

    static func estimate(at point: GardenCoordinate, samples: [Sample]) -> CellResult? {
        guard !samples.isEmpty else { return nil }

        if let exact = samples.first(where: { $0.position.distance(to: point) <= measuredRadiusMeters }) {
            return CellResult(value: exact.value, isMeasured: true)
        }
        guard samples.count >= minimumSamplesForInterpolation else { return nil }

        var weightedSum = 0.0
        var weightSum = 0.0
        for sample in samples {
            let distance = max(sample.position.distance(to: point), 0.1)
            let weight = 1 / (distance * distance)
            weightedSum += sample.value * weight
            weightSum += weight
        }
        guard weightSum > 0 else { return nil }
        return CellResult(value: weightedSum / weightSum, isMeasured: false)
    }
}
