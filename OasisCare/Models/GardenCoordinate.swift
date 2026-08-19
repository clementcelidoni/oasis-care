import Foundation
import CoreLocation

/// Spec Phase 6A — OasisPlan's local vector coordinate system, expressed
/// in meters from an origin (typically a corner of the property),
/// independent of GPS precision or availability. X = east/west
/// (positive = east), Y = north/south (positive = north) — a real map
/// orientation, not screen orientation (screen Y grows downward;
/// GardenMapCamera is what flips that for rendering).
struct GardenCoordinate: Codable, Hashable {
    var xMeters: Double
    var yMeters: Double

    static let zero = GardenCoordinate(xMeters: 0, yMeters: 0)

    static func + (lhs: GardenCoordinate, rhs: GardenCoordinate) -> GardenCoordinate {
        GardenCoordinate(xMeters: lhs.xMeters + rhs.xMeters, yMeters: lhs.yMeters + rhs.yMeters)
    }

    static func - (lhs: GardenCoordinate, rhs: GardenCoordinate) -> GardenCoordinate {
        GardenCoordinate(xMeters: lhs.xMeters - rhs.xMeters, yMeters: lhs.yMeters - rhs.yMeters)
    }

    func distance(to other: GardenCoordinate) -> Double {
        (self - other).length
    }

    var length: Double {
        (xMeters * xMeters + yMeters * yMeters).squareRoot()
    }
}

/// Converts between OasisPlan's local meter-based coordinates and real
/// GPS coordinates, anchored to one reference point — the garden's own
/// latitude/longitude when set (spec §16, Phase 4B). Uses an
/// equirectangular (flat-plane) approximation: accurate to within
/// centimeters at residential-garden scale (well under a kilometer
/// across), the same simplification any "local tangent plane" system
/// uses at this scale. It would need a proper geodesic projection to
/// stay accurate over kilometers, which a single garden never
/// approaches — spec's own "ne jamais inventer une précision GPS...
/// inexistante" cuts the other way too: don't build precision this
/// application doesn't need.
struct GardenCoordinateSystem: Codable, Equatable {
    var originLatitude: Double
    var originLongitude: Double
    /// Plan rotation relative to true north, in radians — lets the
    /// local X/Y axes align to the property's own boundary instead of
    /// forcing north-up when that's not how the user drew it.
    var rotationRadians: Double = 0

    /// WGS84 mean meters-per-degree-latitude — a standard geodesy
    /// constant, not a guess.
    private static let metersPerDegreeLatitude = 111_320.0

    private var metersPerDegreeLongitude: Double {
        Self.metersPerDegreeLatitude * cos(originLatitude * .pi / 180)
    }

    func local(from coordinate: CLLocationCoordinate2D) -> GardenCoordinate {
        let dx = (coordinate.longitude - originLongitude) * metersPerDegreeLongitude
        let dy = (coordinate.latitude - originLatitude) * Self.metersPerDegreeLatitude
        return rotated(GardenCoordinate(xMeters: dx, yMeters: dy), by: -rotationRadians)
    }

    func geographic(from local: GardenCoordinate) -> CLLocationCoordinate2D {
        let unrotated = rotated(local, by: rotationRadians)
        let longitude = originLongitude + unrotated.xMeters / metersPerDegreeLongitude
        let latitude = originLatitude + unrotated.yMeters / Self.metersPerDegreeLatitude
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    private func rotated(_ point: GardenCoordinate, by radians: Double) -> GardenCoordinate {
        guard radians != 0 else { return point }
        let cosR = cos(radians)
        let sinR = sin(radians)
        return GardenCoordinate(
            xMeters: point.xMeters * cosR - point.yMeters * sinR,
            yMeters: point.xMeters * sinR + point.yMeters * cosR
        )
    }
}
