import Foundation
import SwiftData

/// Spec §91's audit requirement ("qui, quoi, quand, pourquoi, résultat")
/// for every command DeviceCommandService actually issues — manual taps
/// today, automation-rule triggers once Phase 5D calls through the same
/// service. Append-only, matching CareEvent/IrrigationEvent's pattern:
/// a command that already happened is a historical fact, never edited.
///
/// trigger/triggerRuleID are two plain fields rather than a single
/// enum-with-associated-value — SwiftData's support for storing a
/// non-primitive Codable enum directly is untested in this codebase, so
/// this stays deliberately simple rather than risk a repeat of this
/// phase's earlier HomeKit API compile surprises.
@Model
final class DeviceCommandLog {
    var id: UUID
    var device: ConnectedDevice?
    var command: DeviceCommandKind
    var trigger: DeviceCommandTriggerKind
    var triggerRuleID: UUID?
    var requestedAt: Date
    var succeeded: Bool
    var errorMessage: String?
    var requestedDurationSeconds: Double?
    var syncStatus: SyncStatus?

    init(
        device: ConnectedDevice?, command: DeviceCommandKind, trigger: DeviceCommandTriggerKind,
        triggerRuleID: UUID? = nil, succeeded: Bool, errorMessage: String? = nil,
        requestedDurationSeconds: Double? = nil
    ) {
        self.id = UUID()
        self.device = device
        self.command = command
        self.trigger = trigger
        self.triggerRuleID = triggerRuleID
        self.requestedAt = .now
        self.succeeded = succeeded
        self.errorMessage = errorMessage
        self.requestedDurationSeconds = requestedDurationSeconds
        self.syncStatus = .pendingCreate
    }
}

enum DeviceCommandKind: String, Codable {
    case turnOn
    case turnOff
    case openValve
    case closeValve
    case setLevel
    case emergencyStop
}

/// "Pourquoi" — who/what asked for this command. `.automation` pairs
/// with `DeviceCommandLog.triggerRuleID` so AutomationExecution
/// (Phase 5D) can cross-reference which rule fired it.
enum DeviceCommandTriggerKind: String, Codable {
    case manual
    case automation
    case emergencyStop

    var displayName: String {
        switch self {
        case .manual: return "Manuel"
        case .automation: return "Automatisation"
        case .emergencyStop: return "Arrêt d'urgence"
        }
    }
}
