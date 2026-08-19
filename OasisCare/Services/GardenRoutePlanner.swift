import Foundation

/// Spec Phase 6I — "GardenRoutePlanner... Oasis connaît la position des
/// végétaux. Générer un parcours raisonnable." Nearest-neighbor
/// ordering — a standard, well-known heuristic for exactly this "visit
/// every point roughly efficiently" problem. Spec's own wording asks
/// for "raisonnable" (reasonable), not optimal, so the simplicity here
/// is a deliberate match to what's actually asked for, not a shortcut.
enum GardenRoutePlanner {
    struct Stop {
        var objectId: UUID
        var position: GardenCoordinate
        var label: String
    }

    /// Builds an ordered visiting sequence starting from `from` (the
    /// user's current position when known, otherwise the garden
    /// origin), always picking the nearest not-yet-visited stop next.
    static func planRoute(from start: GardenCoordinate, stops: [Stop]) -> [Stop] {
        var remaining = stops
        var route: [Stop] = []
        var currentPosition = start

        while !remaining.isEmpty {
            guard let nearestIndex = remaining.indices.min(by: { remaining[$0].position.distance(to: currentPosition) < remaining[$1].position.distance(to: currentPosition) }) else {
                break
            }
            let nearest = remaining.remove(at: nearestIndex)
            currentPosition = nearest.position
            route.append(nearest)
        }
        return route
    }
}
