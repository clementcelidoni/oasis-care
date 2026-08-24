import Foundation
import SwiftData

/// Spec Phase 7D — "MAINTENANCE... créer un journal." Append-only, same
/// convention as CareEvent: a maintenance record is a historical fact,
/// never edited after creation — only ever created.
enum MaintenanceEventType: String, Codable, CaseIterable, Identifiable {
    case sealReplaced
    case filterReplaced
    case tubeChanged
    case cleaning
    case calibration
    case pumpReplaced
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .sealReplaced: return "Joint remplacé"
        case .filterReplaced: return "Filtre remplacé"
        case .tubeChanged: return "Tube changé"
        case .cleaning: return "Nettoyage"
        case .calibration: return "Calibration"
        case .pumpReplaced: return "Pompe remplacée"
        case .other: return "Autre"
        }
    }
}

@Model
final class BioreactorMaintenanceEvent: Syncable {
    var id: UUID
    var date: Date
    var eventType: MaintenanceEventType
    var notes: String
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var bioreactor: Bioreactor?

    init(bioreactor: Bioreactor?, eventType: MaintenanceEventType, notes: String = "") {
        self.id = UUID()
        self.bioreactor = bioreactor
        self.date = .now
        self.eventType = eventType
        self.notes = notes
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
