import Foundation

/// Shared polygon math for OasisPlan — point-in-polygon today (Phase
/// 6D's vegetation-in-zone lookup), and the natural place for the
/// route planner (6I) and site-suitability assistant (6H) to reuse the
/// same test rather than each growing their own.
enum GardenGeometry {
    /// Standard ray-casting / crossing-number test (the PNPOLY
    /// algorithm): counts how many times a ray cast from `point` in the
    /// +X direction crosses the polygon's edges: odd = inside.
    static func contains(_ point: GardenCoordinate, polygon: [GardenCoordinate]) -> Bool {
        guard polygon.count >= 3 else { return false }
        var isInside = false
        var j = polygon.count - 1
        for i in 0..<polygon.count {
            let vertexI = polygon[i]
            let vertexJ = polygon[j]
            if (vertexI.yMeters > point.yMeters) != (vertexJ.yMeters > point.yMeters) {
                let intersectionX = (vertexJ.xMeters - vertexI.xMeters) * (point.yMeters - vertexI.yMeters)
                    / (vertexJ.yMeters - vertexI.yMeters) + vertexI.xMeters
                if point.xMeters < intersectionX {
                    isInside.toggle()
                }
            }
            j = i
        }
        return isInside
    }

    /// Shoelace formula.
    static func areaSquareMeters(of polygon: [GardenCoordinate]) -> Double {
        guard polygon.count >= 3 else { return 0 }
        var sum = 0.0
        for i in 0..<polygon.count {
            let current = polygon[i]
            let next = polygon[(i + 1) % polygon.count]
            sum += current.xMeters * next.yMeters - next.xMeters * current.yMeters
        }
        return abs(sum) / 2
    }

    static func boundingSize(of polygon: [GardenCoordinate]) -> (widthMeters: Double, heightMeters: Double) {
        guard !polygon.isEmpty else { return (0, 0) }
        let xValues = polygon.map(\.xMeters)
        let yValues = polygon.map(\.yMeters)
        return ((xValues.max() ?? 0) - (xValues.min() ?? 0), (yValues.max() ?? 0) - (yValues.min() ?? 0))
    }

    static func centroid(of polygon: [GardenCoordinate]) -> GardenCoordinate {
        guard !polygon.isEmpty else { return .zero }
        let sumX = polygon.reduce(0) { $0 + $1.xMeters }
        let sumY = polygon.reduce(0) { $0 + $1.yMeters }
        return GardenCoordinate(xMeters: sumX / Double(polygon.count), yMeters: sumY / Double(polygon.count))
    }

    /// Standard point-to-segment distance: project `point` onto the
    /// infinite line through start/end via the dot-product formula,
    /// then clamp the projection parameter to [0, 1] so the result is
    /// distance to the segment, not the infinite line. Used by
    /// SunExposureService to test whether a point falls inside a
    /// shadow, which is itself drawn as a line segment.
    static func distanceFromPoint(_ point: GardenCoordinate, toSegmentFrom start: GardenCoordinate, to end: GardenCoordinate) -> Double {
        let segment = end - start
        let segmentLengthSquared = segment.xMeters * segment.xMeters + segment.yMeters * segment.yMeters
        guard segmentLengthSquared > 0.0001 else { return point.distance(to: start) }
        let toPoint = point - start
        let t = max(0, min(1, (toPoint.xMeters * segment.xMeters + toPoint.yMeters * segment.yMeters) / segmentLengthSquared))
        let projection = GardenCoordinate(xMeters: start.xMeters + t * segment.xMeters, yMeters: start.yMeters + t * segment.yMeters)
        return point.distance(to: projection)
    }
}
