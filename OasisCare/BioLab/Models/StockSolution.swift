import Foundation
import SwiftData

/// Enhancement "SOLUTIONS STOCK" — a pre-mixed concentrate (e.g. "BAP
/// 1 mg/mL") that `MediaRecipeCalculator` can draw a computed volume
/// from instead of weighing out raw powder every time a recipe is
/// prepared. `remainingVolume` is decremented only on explicit
/// confirmation when a `MediumBatch` is validated as prepared (spec:
/// "ne pas déduire avant confirmation") — never inferred automatically
/// from a calculation alone.
@Model
final class StockSolution: Syncable {
    var id: UUID
    var name: String
    var concentration: Double
    var concentrationUnit: ConcentrationUnit
    var preparedVolumeLiters: Double
    var remainingVolumeLiters: Double
    var preparedAt: Date
    var expiresAt: Date?
    var storageLocation: String
    var lotNumber: String?
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var compound: LabCompound?

    init(
        compound: LabCompound?, name: String, concentration: Double, concentrationUnit: ConcentrationUnit,
        preparedVolumeLiters: Double, storageLocation: String = "", expiresAt: Date? = nil, lotNumber: String? = nil, notes: String = ""
    ) {
        self.id = UUID()
        self.compound = compound
        self.name = name
        self.concentration = concentration
        self.concentrationUnit = concentrationUnit
        self.preparedVolumeLiters = preparedVolumeLiters
        self.remainingVolumeLiters = preparedVolumeLiters
        self.preparedAt = .now
        self.expiresAt = expiresAt
        self.storageLocation = storageLocation
        self.lotNumber = lotNumber
        self.notes = notes
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var isExpired: Bool {
        guard let expiresAt else { return false }
        return expiresAt < .now
    }
}
