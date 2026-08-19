import Foundation
import CoreGraphics

/// Spec Phase 6A — pan/zoom/rotation state for OasisPlanView's canvas,
/// and the screen↔local half of the four transform functions the spec
/// asks for (local↔geographic lives in GardenCoordinateSystem).
/// `basePointsPerMeter` is the rendering density at scale 1.0; `scale`
/// is the live pinch-to-zoom multiplier on top of that.
struct GardenMapCamera: Equatable {
    var centerMeters: GardenCoordinate = .zero
    var scale: Double = 1.0
    var rotationRadians: Double = 0

    static let basePointsPerMeter: Double = 20
    static let minScale: Double = 0.1
    static let maxScale: Double = 12

    var pointsPerMeter: Double { Self.basePointsPerMeter * scale }

    /// Screen space: origin top-left, Y grows downward (SwiftUI/UIKit
    /// convention) — the sign flip on Y is what makes "north = up" on
    /// screen match "yMeters increases north" in local coordinates.
    func screenPoint(for local: GardenCoordinate, viewSize: CGSize) -> CGPoint {
        let dx = (local.xMeters - centerMeters.xMeters) * pointsPerMeter
        let dy = -(local.yMeters - centerMeters.yMeters) * pointsPerMeter
        let cosR = cos(rotationRadians)
        let sinR = sin(rotationRadians)
        return CGPoint(
            x: viewSize.width / 2 + dx * cosR - dy * sinR,
            y: viewSize.height / 2 + dx * sinR + dy * cosR
        )
    }

    func localPoint(for screen: CGPoint, viewSize: CGSize) -> GardenCoordinate {
        let dx = screen.x - viewSize.width / 2
        let dy = screen.y - viewSize.height / 2
        let cosR = cos(-rotationRadians)
        let sinR = sin(-rotationRadians)
        let unrotatedX = dx * cosR - dy * sinR
        let unrotatedY = dx * sinR + dy * cosR
        return GardenCoordinate(
            xMeters: centerMeters.xMeters + unrotatedX / pointsPerMeter,
            yMeters: centerMeters.yMeters - unrotatedY / pointsPerMeter
        )
    }

    /// A length in meters (not tied to one point) — for grid spacing,
    /// hit-test radii, etc.
    func points(forMeters meters: Double) -> Double {
        meters * pointsPerMeter
    }
}
