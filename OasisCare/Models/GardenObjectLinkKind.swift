import Foundation

/// Spec Phase 6C — "chaque élément du plan peut être associé à une
/// vraie entité Oasis... toucher l'objet ouvre la vraie fiche."
/// SwiftData relationships can't point at "any Model," so a
/// GardenMapObject stores a plain `linkedEntityId` plus this
/// discriminator and resolves the real object by lookup rather than a
/// typed relationship — see GardenMapObject's own doc comment.
///
/// Scoped to the two kinds that already have a real, reachable detail
/// view today (PlantDetailView, SensorDetailSheet). ConnectedDevice/
/// Greenhouse/Pond have no dedicated "fiche" of their own yet in this
/// app (they're managed inline in GardenDetailView's lists) — linking
/// to them is a natural extension once one exists, not built here to
/// avoid inventing a detail screen that isn't this phase's job.
enum GardenObjectLinkKind: String, Codable {
    case plant
    case sensor
}
