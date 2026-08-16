import Foundation
import SwiftData

/// Spec §31-33. flowRate is the zone's combined output (used for
/// zone-level estimates, spec §36); per-plant emitter fields live on
/// Plant instead (spec §34 — "par végétal").
@Model
final class IrrigationZone: Syncable {
    var id: UUID
    var name: String
    var type: IrrigationType
    var flowRate: Double?
    var flowRateUnit: String
    var durationMinutes: Int?
    var active: Bool
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var garden: Garden?

    @Relationship(deleteRule: .nullify, inverse: \Plant.irrigationZone)
    var plants: [Plant] = []

    @Relationship(deleteRule: .cascade, inverse: \IrrigationEvent.zone)
    var events: [IrrigationEvent] = []

    init(
        name: String,
        type: IrrigationType = .drip,
        flowRate: Double? = nil,
        flowRateUnit: String = "L/h",
        durationMinutes: Int? = nil,
        active: Bool = true,
        notes: String = "",
        garden: Garden? = nil
    ) {
        self.id = UUID()
        self.name = name
        self.type = type
        self.flowRate = flowRate
        self.flowRateUnit = flowRateUnit
        self.durationMinutes = durationMinutes
        self.active = active
        self.notes = notes
        self.createdAt = .now
        self.garden = garden
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
