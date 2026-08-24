import Foundation
import SwiftData

enum BioreactorCycleType: String, Codable, CaseIterable, Identifiable {
    case immersion
    case aeration

    var id: String { rawValue }

    var label: String {
        switch self {
        case .immersion: return "Immersion"
        case .aeration: return "Aération"
        }
    }
}

/// Spec Phase 7E — "STATUT."
enum CycleExecutionStatus: String, Codable, CaseIterable, Identifiable {
    case scheduled
    case running
    case completed
    case failed
    case cancelled
    case timeout

    var id: String { rawValue }

    var label: String {
        switch self {
        case .scheduled: return "Planifié"
        case .running: return "En cours"
        case .completed: return "Terminé"
        case .failed: return "Échoué"
        case .cancelled: return "Annulé"
        case .timeout: return "Timeout sécurité"
        }
    }
}

/// Spec Phase 7E — "CYCLE EXECUTION... chaque cycle est journalisé."
/// `sensorSnapshotBefore`/`After` are plain text summaries (no sensors
/// exist yet — that's Phase 7F) rather than a structured type invented
/// ahead of what Phase 7F actually builds.
@Model
final class BioreactorCycleExecution: Syncable {
    var id: UUID
    var cycleType: BioreactorCycleType
    var plannedStart: Date
    var actualStart: Date?
    var actualEnd: Date?
    var expectedDurationSeconds: Int
    var actualDurationSeconds: Int?
    var status: CycleExecutionStatus
    var failureReason: String?
    var sensorSnapshotBefore: String?
    var sensorSnapshotAfter: String?
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var bioreactor: Bioreactor?
    var programVersion: BioreactorProgramVersion?

    init(bioreactor: Bioreactor?, programVersion: BioreactorProgramVersion?, cycleType: BioreactorCycleType, plannedStart: Date, expectedDurationSeconds: Int) {
        self.id = UUID()
        self.bioreactor = bioreactor
        self.programVersion = programVersion
        self.cycleType = cycleType
        self.plannedStart = plannedStart
        self.expectedDurationSeconds = expectedDurationSeconds
        self.status = .scheduled
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
