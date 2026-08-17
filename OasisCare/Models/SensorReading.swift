import Foundation
import SwiftData

/// Spec §13 — prepared alongside Sensor in Phase 4, filled in for real
/// in Phase 5B. Append-only (a reading is a historical fact, same
/// pattern as CareEvent) — never updated after creation, only ever
/// inserted, and (per spec §93's data-volume warning) eventually pruned
/// by GraphAggregationService rather than kept forever at full
/// resolution — see Phase 5H.
@Model
final class SensorReading {
    var id: UUID
    var timestamp: Date
    var value: Double
    var unit: String
    var quality: SensorReadingQuality
    var source: SensorSource
    var sensor: Sensor?
    var syncStatus: SyncStatus?

    init(
        sensor: Sensor?, timestamp: Date = .now, value: Double, unit: String,
        quality: SensorReadingQuality = .good, source: SensorSource = .manual
    ) {
        self.id = UUID()
        self.sensor = sensor
        self.timestamp = timestamp
        self.value = value
        self.unit = unit
        self.quality = quality
        self.source = source
        self.syncStatus = .pendingCreate
    }
}
