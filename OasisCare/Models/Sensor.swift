import Foundation
import SwiftData

/// Spec §11 — a logical measurement stream, scoped to a garden, zone,
/// and/or plant (any combination, matching the spec's "optional"
/// fields). `device` is the physical ConnectedDevice actually producing
/// readings, when there is one — `source` distinguishes that case from
/// a sensor whose readings are typed in by hand, since HomeKit doesn't
/// cover every type this app cares about (soil moisture, pH, etc. —
/// see HomeKitService's capability-mapping doc comment).
///
/// Nothing here was real before Phase 5 ("préparer seulement" through
/// Phase 4) — freely restructured rather than migrated, isActive
/// renamed to `enabled` to match the spec's own vocabulary.
@Model
final class Sensor: Syncable {
    var id: UUID
    var name: String
    var type: SensorType
    var unit: String
    var enabled: Bool
    var source: SensorSource
    var minimumExpected: Double?
    var maximumExpected: Double?
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var plant: Plant?
    var garden: Garden?
    var zone: GardenZone?
    var device: ConnectedDevice?
    /// Spec Phase 7F — "réutiliser Sensor/SensorReading de Phase 5.
    /// Ajouter les usages BioLab." One more optional scope, same
    /// "any combination" pattern as the others above — plain optional
    /// relationship added to an already-shipped model, safe without a
    /// migration default.
    var bioreactor: Bioreactor?

    @Relationship(deleteRule: .cascade, inverse: \SensorReading.sensor)
    var readings: [SensorReading] = []

    init(
        name: String, type: SensorType, unit: String? = nil, enabled: Bool = true, source: SensorSource = .manual,
        minimumExpected: Double? = nil, maximumExpected: Double? = nil,
        plant: Plant? = nil, garden: Garden? = nil, zone: GardenZone? = nil, device: ConnectedDevice? = nil, bioreactor: Bioreactor? = nil
    ) {
        self.id = UUID()
        self.name = name
        self.type = type
        self.unit = unit ?? type.defaultUnit
        self.enabled = enabled
        self.source = source
        self.minimumExpected = minimumExpected
        self.maximumExpected = maximumExpected
        self.createdAt = .now
        self.plant = plant
        self.garden = garden
        self.zone = zone
        self.device = device
        self.bioreactor = bioreactor
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    /// Spec §17 — "trop ancien" if no reading in the last 6 hours.
    var isStale: Bool {
        guard let latest = readings.map(\.timestamp).max() else { return true }
        return Date.now.timeIntervalSince(latest) > 6 * 3600
    }

    var latestReading: SensorReading? {
        readings.max { $0.timestamp < $1.timestamp }
    }
}
