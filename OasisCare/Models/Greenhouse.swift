import Foundation
import SwiftData

/// Spec §41 — target ranges plus the sensors/actuators
/// GreenhouseClimateService reads and controls. Every sensor/device
/// link is optional: a greenhouse can be tracked for monitoring alone
/// (Phase 5H graphs) with no automatic control at all.
@Model
final class Greenhouse: Syncable {
    var id: UUID
    var name: String
    var targetTemperatureMin: Double?
    var targetTemperatureMax: Double?
    var targetHumidityMin: Double?
    var targetHumidityMax: Double?
    var targetLightMin: Double?
    var targetLightMax: Double?
    /// Master opt-in switch (spec's automation philosophy: automatic
    /// mode is always opt-in) — GreenhouseClimateService.evaluate does
    /// nothing at all while this is false, even if targets are set.
    var climateControlEnabled: Bool

    var garden: Garden?
    var zone: GardenZone?

    var temperatureSensor: Sensor?
    var humiditySensor: Sensor?
    var lightSensor: Sensor?
    var soilSensor: Sensor?

    var heaterDevice: ConnectedDevice?
    var fanDevice: ConnectedDevice?
    var misterDevice: ConnectedDevice?
    var lightDevice: ConnectedDevice?
    var valveDevice: ConnectedDevice?

    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: SyncStatus?

    init(name: String, garden: Garden? = nil, zone: GardenZone? = nil) {
        self.id = UUID()
        self.name = name
        self.climateControlEnabled = false
        self.garden = garden
        self.zone = zone
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }
}
