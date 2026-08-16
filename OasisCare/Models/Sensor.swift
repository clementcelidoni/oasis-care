import Foundation
import SwiftData

/// Spec §71 — "Préparer seulement." A sensor optionally scopes to one
/// plant (a soil probe) or a whole garden (a rain gauge); nothing in
/// this phase creates one, connects to real hardware, or reads from
/// it — this exists purely so the schema (local and Supabase) is
/// ready for a future phase to fill in.
@Model
final class Sensor: Syncable {
    var id: UUID
    var name: String
    var type: SensorType
    var isActive: Bool
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var plant: Plant?
    var garden: Garden?

    @Relationship(deleteRule: .cascade, inverse: \SensorReading.sensor)
    var readings: [SensorReading] = []

    init(name: String, type: SensorType, isActive: Bool = true, plant: Plant? = nil, garden: Garden? = nil) {
        self.id = UUID()
        self.name = name
        self.type = type
        self.isActive = isActive
        self.createdAt = .now
        self.plant = plant
        self.garden = garden
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
