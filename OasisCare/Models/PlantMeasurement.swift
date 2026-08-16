import Foundation
import SwiftData

/// Spec §54-55 — dimensions for trees/palms, one record per measurement
/// session (a single visit can capture several dimensions at once, per
/// the spec's own example: one date, height + circumference + canopy
/// together). Append-only like CareEvent/IrrigationEvent — spec §55 is
/// explicit: "Ne jamais écraser les anciennes mesures." No updatedAt,
/// not Syncable-conforming, and — matching CareEvent, which has no
/// DeletionService entry either — not individually deletable, only
/// ever removed by cascade when its plant is deleted.
@Model
final class PlantMeasurement {
    var id: UUID
    var date: Date
    var height: Double?
    var trunkCircumference: Double?
    var trunkDiameter: Double?
    var canopyDiameter: Double?
    var estimatedAge: Int?
    var notes: String
    var plant: Plant?
    var syncStatus: SyncStatus?

    init(
        plant: Plant?,
        date: Date = .now,
        height: Double? = nil,
        trunkCircumference: Double? = nil,
        trunkDiameter: Double? = nil,
        canopyDiameter: Double? = nil,
        estimatedAge: Int? = nil,
        notes: String = ""
    ) {
        self.id = UUID()
        self.plant = plant
        self.date = date
        self.height = height
        self.trunkCircumference = trunkCircumference
        self.trunkDiameter = trunkDiameter
        self.canopyDiameter = canopyDiameter
        self.estimatedAge = estimatedAge
        self.notes = notes
        self.syncStatus = .pendingCreate
    }
}
