import Foundation

enum CareEventType: String, Codable, CaseIterable, Identifiable {
    case watering
    case fertilizing
    case pruning
    case trimming
    case repotting
    case treatment
    case inspection
    case planting
    case misting
    case cleaning
    case rotating
    case pestObservation
    case diseaseObservation
    case photoUpdate
    case custom

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .watering: return "Arrosage"
        case .fertilizing: return "Engrais"
        case .pruning: return "Taille"
        case .trimming: return "Élagage"
        case .repotting: return "Rempotage"
        case .treatment: return "Traitement"
        case .inspection: return "Inspection"
        case .planting: return "Plantation"
        case .misting: return "Brumisation"
        case .cleaning: return "Nettoyage"
        case .rotating: return "Rotation du pot"
        case .pestObservation: return "Observation de nuisibles"
        case .diseaseObservation: return "Observation de maladie"
        case .photoUpdate: return "Photo"
        case .custom: return "Autre"
        }
    }

    var icon: String {
        switch self {
        case .watering: return "drop.fill"
        case .fertilizing: return "sparkles"
        case .pruning: return "scissors"
        case .trimming: return "scissors"
        case .repotting: return "arrow.triangle.2.circlepath"
        case .treatment: return "cross.vial.fill"
        case .inspection: return "magnifyingglass"
        case .planting: return "leaf.fill"
        case .misting: return "cloud.drizzle.fill"
        case .cleaning: return "sparkles"
        case .rotating: return "arrow.triangle.2.circlepath"
        case .pestObservation: return "ladybug.fill"
        case .diseaseObservation: return "exclamationmark.triangle.fill"
        case .photoUpdate: return "camera.fill"
        case .custom: return "ellipsis.circle.fill"
        }
    }

    /// Types Phase 1 tracks on a recurring schedule (quick-action buttons + due-date logic).
    static var schedulable: [CareEventType] { [.watering, .fertilizing] }
}
