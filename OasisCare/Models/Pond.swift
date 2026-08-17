import Foundation
import SwiftData

/// Spec §49-56. Auto-refill is deliberately not built (§55: "ne jamais
/// déclencher automatiquement un remplissage sans règle explicite +
/// limite stricte" — §56 frames it as future work with its own
/// mandatory safety fields) — lowWaterAlert only ever informs, nothing
/// here can open a fill valve.
@Model
final class Pond: Syncable {
    var id: UUID
    var name: String
    var volumeLiters: Double?
    var targetTemperatureMin: Double?
    var targetTemperatureMax: Double?
    var targetWaterLevelPercent: Double?

    var garden: Garden?

    var waterTemperatureSensor: Sensor?
    var waterLevelSensor: Sensor?
    var flowSensor: Sensor?
    var phSensor: Sensor?
    var conductivitySensor: Sensor?

    var pumpDevice: ConnectedDevice?
    var filtrationDevice: ConnectedDevice?
    var uvDevice: ConnectedDevice?

    var lastFiltrationCleanedAt: Date?
    /// Spec §54's "rappel remplacement lampe selon nombre d'heures" —
    /// simplified to wall-clock time since the last noted install
    /// rather than true accumulated runtime (which would need
    /// continuous background tracking this phase doesn't have): a
    /// reminder computed from "time since installedAt" assuming
    /// roughly continuous operation, not a precise hour-meter.
    var uvLampInstalledAt: Date?
    var uvLampReminderAfterDays: Int?

    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: SyncStatus?

    init(name: String, garden: Garden? = nil) {
        self.id = UUID()
        self.name = name
        self.garden = garden
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }

    var lowWaterAlert: Bool {
        guard let target = targetWaterLevelPercent, let current = waterLevelSensor?.latestReading?.value else { return false }
        return current < target * 0.8
    }

    var uvLampDue: Bool {
        guard let installedAt = uvLampInstalledAt, let reminderDays = uvLampReminderAfterDays else { return false }
        return Date.now.timeIntervalSince(installedAt) / 86400 > Double(reminderDays)
    }
}
