import Foundation
import SwiftData

/// Spec §57-58 — an arboricultural checklist inspection. Unlike
/// PlantMeasurement, this is editable (Syncable) rather than
/// append-only: a report is more likely to need a correction than a
/// numeric reading is, and the spec only calls out "never overwrite"
/// for measurements specifically (§55), not inspections.
@Model
final class TreeInspection: Syncable {
    var id: UUID
    var date: Date
    var generalCondition: String
    var stability: String
    var deadWood: String
    var cavities: String
    var fungi: String
    var parasites: String
    var trunkDefects: String
    var canopyNotes: String
    var notes: String
    var result: TreeInspectionResult
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var plant: Plant?

    @Relationship(deleteRule: .nullify, inverse: \PlantPhoto.treeInspection)
    var photos: [PlantPhoto] = []

    init(
        plant: Plant?,
        date: Date = .now,
        generalCondition: String = "",
        stability: String = "",
        deadWood: String = "",
        cavities: String = "",
        fungi: String = "",
        parasites: String = "",
        trunkDefects: String = "",
        canopyNotes: String = "",
        notes: String = "",
        result: TreeInspectionResult = .good
    ) {
        self.id = UUID()
        self.plant = plant
        self.date = date
        self.generalCondition = generalCondition
        self.stability = stability
        self.deadWood = deadWood
        self.cavities = cavities
        self.fungi = fungi
        self.parasites = parasites
        self.trunkDefects = trunkDefects
        self.canopyNotes = canopyNotes
        self.notes = notes
        self.result = result
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
