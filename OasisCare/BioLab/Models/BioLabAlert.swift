import Foundation
import SwiftData

/// Spec's "ALERTES" section (cross-cutting, not tied to one sub-phase)
/// — the full case list is defined now since it's simple to state, but
/// most detectors only get built in their own sub-phase
/// (BioLabAlertService.detectCycleAlerts here in 7E; sensor/inspection/
/// contamination detectors come with 7F/7H). A case existing here is
/// not a claim that it's already being detected.
enum BioLabAlertType: String, Codable, CaseIterable, Identifiable {
    case missedCycle
    case cycleTooLong
    case unresponsivePump
    case abnormalPressure
    case abnormalFlow
    case abnormalMediumLevel
    case sensorOffline
    case temperatureOutOfRange
    case lateInspection
    case mediumChangeDue
    case suspectedContamination

    var id: String { rawValue }

    var label: String {
        switch self {
        case .missedCycle: return "Cycle manqué"
        case .cycleTooLong: return "Cycle trop long"
        case .unresponsivePump: return "Pompe non répondante"
        case .abnormalPressure: return "Pression anormale"
        case .abnormalFlow: return "Débit anormal"
        case .abnormalMediumLevel: return "Niveau de milieu anormal"
        case .sensorOffline: return "Capteur hors ligne"
        case .temperatureOutOfRange: return "Température hors seuil"
        case .lateInspection: return "Inspection en retard"
        case .mediumChangeDue: return "Changement de milieu prévu"
        case .suspectedContamination: return "Contamination suspectée"
        }
    }
}

enum BioLabAlertPriority: String, Codable, CaseIterable, Identifiable, Comparable {
    case info
    case warning
    case important
    case critical

    var id: String { rawValue }

    var label: String {
        switch self {
        case .info: return "Information"
        case .warning: return "Avertissement"
        case .important: return "Important"
        case .critical: return "Critique"
        }
    }

    private var sortOrder: Int {
        switch self {
        case .info: return 0
        case .warning: return 1
        case .important: return 2
        case .critical: return 3
        }
    }

    static func < (lhs: BioLabAlertPriority, rhs: BioLabAlertPriority) -> Bool { lhs.sortOrder < rhs.sortOrder }
}

/// "DÉDUPLICATION... ne pas envoyer 30 fois la même alerte." Enforced
/// by BioLabAlertService checking for an existing, unresolved alert of
/// the same (type, bioreactor) pair before creating a new one — see
/// that service.
@Model
final class BioLabAlert: Syncable {
    var id: UUID
    var alertType: BioLabAlertType
    var priority: BioLabAlertPriority
    var message: String
    var createdAt: Date
    var resolvedAt: Date?
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var bioreactor: Bioreactor?
    var cultureBatch: CultureBatch?

    init(alertType: BioLabAlertType, priority: BioLabAlertPriority, message: String, bioreactor: Bioreactor? = nil, cultureBatch: CultureBatch? = nil) {
        self.id = UUID()
        self.alertType = alertType
        self.priority = priority
        self.message = message
        self.createdAt = .now
        self.bioreactor = bioreactor
        self.cultureBatch = cultureBatch
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var isActive: Bool { resolvedAt == nil }
}
