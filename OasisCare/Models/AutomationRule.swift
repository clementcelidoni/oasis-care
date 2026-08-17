import Foundation
import SwiftData

/// Spec §25/§30 — a rule is scoped to at most one of garden/zone/plant
/// (whichever the user picked in the builder); conditions read from
/// sensors within that scope when no specific sensor is set on the
/// condition itself.
@Model
final class AutomationRule: Syncable {
    var id: UUID
    var name: String
    var enabled: Bool
    var mode: AutomationMode
    var scopeGarden: Garden?
    var scopeZone: GardenZone?
    var scopePlant: Plant?

    /// Spec §30 — every field optional (no limit set = no cap on that
    /// dimension), but maxDuration on an openValve action is still
    /// clamped a second time by DeviceCommandService regardless.
    var maxDurationSeconds: Double?
    var maxVolumeLiters: Double?
    var maxRunsPerDay: Int?
    var minimumDelayBetweenRunsMinutes: Int?

    var createdAt: Date
    var updatedAt: Date?
    var lastTriggeredAt: Date?
    var syncStatus: SyncStatus?

    @Relationship(deleteRule: .cascade, inverse: \AutomationCondition.rule)
    var conditions: [AutomationCondition] = []
    @Relationship(deleteRule: .cascade, inverse: \AutomationAction.rule)
    var actions: [AutomationAction] = []
    @Relationship(deleteRule: .cascade, inverse: \AutomationExecution.rule)
    var executions: [AutomationExecution] = []

    init(name: String, mode: AutomationMode = .manual, scopeGarden: Garden? = nil, scopeZone: GardenZone? = nil, scopePlant: Plant? = nil) {
        self.id = UUID()
        self.name = name
        self.enabled = false
        self.mode = mode
        self.scopeGarden = scopeGarden
        self.scopeZone = scopeZone
        self.scopePlant = scopePlant
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }

    /// Spec §30's maxRunsPerDay — counted from AutomationExecution rows
    /// that actually decided true, today.
    func runsToday(calendar: Calendar = .current) -> Int {
        executions.filter { $0.decision && calendar.isDateInToday($0.date) }.count
    }

    var canRunNow: Bool {
        if let maxRunsPerDay, runsToday() >= maxRunsPerDay { return false }
        if let minimumDelayBetweenRunsMinutes, let lastTriggeredAt {
            let elapsedMinutes = Date.now.timeIntervalSince(lastTriggeredAt) / 60
            if elapsedMinutes < Double(minimumDelayBetweenRunsMinutes) { return false }
        }
        return true
    }
}
