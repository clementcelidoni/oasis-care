import Foundation
import SwiftData

/// One plant's result within a GardenCheckup (spec §62). Append-only —
/// the walk-through only ever moves forward (spec's own mockup shows
/// no "back" button), so like CareEvent there's no edit path, only
/// create.
@Model
final class GardenCheckupEntry {
    var id: UUID
    var date: Date
    var result: TreeInspectionResult
    var notes: String
    var syncStatus: SyncStatus?

    var checkup: GardenCheckup?
    var plant: Plant?

    @Relationship(deleteRule: .nullify, inverse: \PlantPhoto.checkupEntry)
    var photos: [PlantPhoto] = []

    init(checkup: GardenCheckup?, plant: Plant?, result: TreeInspectionResult, notes: String = "") {
        self.id = UUID()
        self.checkup = checkup
        self.plant = plant
        self.date = .now
        self.result = result
        self.notes = notes
        self.syncStatus = .pendingCreate
    }
}
