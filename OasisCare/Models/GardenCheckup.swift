import Foundation
import SwiftData

/// Spec §61-65 — one walk-through session. The filter is captured at
/// start time and never re-derived, so resuming an interrupted session
/// (spec §64) always walks the same scope it started with, even if
/// "À surveiller" would otherwise return a different set of plants by
/// the time the user comes back.
@Model
final class GardenCheckup: Syncable {
    var id: UUID
    var startedAt: Date
    var completedAt: Date?
    var filterCategory: GardenCheckupFilter
    var filterZoneID: UUID?
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var garden: Garden?

    @Relationship(deleteRule: .cascade, inverse: \GardenCheckupEntry.checkup)
    var entries: [GardenCheckupEntry] = []

    init(garden: Garden?, filterCategory: GardenCheckupFilter, filterZoneID: UUID? = nil) {
        self.id = UUID()
        self.garden = garden
        self.startedAt = .now
        self.filterCategory = filterCategory
        self.filterZoneID = filterZoneID
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var isComplete: Bool { completedAt != nil }
}
