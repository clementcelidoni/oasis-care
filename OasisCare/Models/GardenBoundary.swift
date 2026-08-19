import Foundation
import SwiftData

/// Spec Phase 6B — the property/plan outline: one ordered polygon of
/// points in local meters per garden. A garden has at most one
/// (to-one relationship on Garden, cascade-deleted with it) — the
/// spec's editor works on "le contour du jardin" as a single shape,
/// not a collection.
///
/// No standalone delete UI/DeletionService.EntityType case: like
/// DashboardPreferences, this is a singleton child the user edits
/// (add/move/remove points) rather than something they delete outright:
/// clearing it to zero points is "no boundary drawn yet," not a
/// tombstoned row.
@Model
final class GardenBoundary: Syncable {
    var id: UUID
    var garden: Garden?
    var points: [GardenCoordinate]
    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: SyncStatus?

    init(garden: Garden?, points: [GardenCoordinate] = []) {
        self.id = UUID()
        self.garden = garden
        self.points = points
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }
}
