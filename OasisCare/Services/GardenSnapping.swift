import Foundation

/// Spec Phase 6B — optional snapping while editing boundary/object
/// points. The spec lists six aids (aligner horizontalement, aligner
/// verticalement, angle 45°, angle 90°, accrocher à un autre point,
/// accrocher à une bordure). The first four are all special cases of
/// "round the angle from the previous point to the nearest 45°" — 0°/
/// 90°/180°/270° ARE horizontal/vertical, and 45°/90° increments both
/// fall out of the same rounding — so one angle step implements all
/// four instead of four separate checks. Snap-to-edge needs another
/// object's edge to snap to, which doesn't exist until Phase 6C; left
/// as a natural extension of this same `snap` entry point then, rather
/// than guessed at now.
enum GardenSnapping {
    static let angleStepDegrees: Double = 45
    static let pointToleranceMeters: Double = 0.3

    /// Point-snap first (exact coincidence beats angle correction so two
    /// deliberately-touching points actually meet), then angle-snap
    /// relative to `previous` when one exists.
    static func snap(
        _ candidate: GardenCoordinate,
        previous: GardenCoordinate?,
        existingPoints: [GardenCoordinate],
        enabled: Bool
    ) -> GardenCoordinate {
        guard enabled else { return candidate }

        if let existingMatch = existingPoints.first(where: { $0.distance(to: candidate) <= pointToleranceMeters }) {
            return existingMatch
        }

        guard let previous else { return candidate }
        let delta = candidate - previous
        guard delta.length > 0.01 else { return candidate }

        let angleRadians = atan2(delta.yMeters, delta.xMeters)
        let stepRadians = angleStepDegrees * .pi / 180
        let snappedAngle = (angleRadians / stepRadians).rounded() * stepRadians
        return GardenCoordinate(
            xMeters: previous.xMeters + delta.length * cos(snappedAngle),
            yMeters: previous.yMeters + delta.length * sin(snappedAngle)
        )
    }
}
