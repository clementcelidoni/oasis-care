import Foundation
import SwiftData

/// Spec §72 — prepared alongside Sensor. Append-only by nature (a
/// reading is a historical fact), same pattern as CareEvent.
@Model
final class SensorReading {
    var id: UUID
    var timestamp: Date
    var value: Double
    var unit: String
    var sensor: Sensor?
    var syncStatus: SyncStatus?

    init(sensor: Sensor?, timestamp: Date = .now, value: Double, unit: String) {
        self.id = UUID()
        self.sensor = sensor
        self.timestamp = timestamp
        self.value = value
        self.unit = unit
        self.syncStatus = .pendingCreate
    }
}
