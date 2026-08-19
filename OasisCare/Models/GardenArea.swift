import Foundation
import SwiftData

/// Spec Phase 6C — "une zone est un polygone éditable": a typed,
/// colored region (pelouse, massif, zone interdite...), edited with the
/// exact same point/handle/snap/undo mechanics GardenMapEngine already
/// applies to GardenBoundary — the only difference is which points
/// array is being edited. Unlike GardenBoundary, a garden has many of
/// these, so it's independently user-deletable (see
/// DeletionService.EntityType.gardenArea).
@Model
final class GardenArea: Syncable {
    var id: UUID
    var garden: Garden?
    var areaType: GardenAreaType
    var name: String
    var points: [GardenCoordinate]
    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: SyncStatus?

    init(garden: Garden?, areaType: GardenAreaType, name: String = "", points: [GardenCoordinate] = []) {
        self.id = UUID()
        self.garden = garden
        self.areaType = areaType
        self.name = name
        self.points = points
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }
}
