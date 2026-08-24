import Foundation

/// Spec Phase 7D — "DOUBLE BOCAUX... ajouter composants optionnels...
/// ne pas imposer que chaque système possède tous ces éléments." A set
/// of which of these a given Bioreactor physically has, rather than 11
/// separate boolean fields — simpler to extend and matches "optional,
/// any combination" more directly than a fixed field list would.
enum BioreactorComponentType: String, Codable, CaseIterable, Identifiable {
    case airInlet
    case airFilter
    case pressureLine
    case cultureVessel
    case reservoir
    case transferTube
    case drainLine
    case ventLine
    case solenoidValve
    case airPump
    case liquidPump

    var id: String { rawValue }

    var label: String {
        switch self {
        case .airInlet: return "Entrée d'air"
        case .airFilter: return "Filtre à air"
        case .pressureLine: return "Ligne de pression"
        case .cultureVessel: return "Bocal de culture"
        case .reservoir: return "Réservoir"
        case .transferTube: return "Tube de transfert"
        case .drainLine: return "Ligne de vidange"
        case .ventLine: return "Ligne d'évent"
        case .solenoidValve: return "Électrovanne"
        case .airPump: return "Pompe à air"
        case .liquidPump: return "Pompe à liquide"
        }
    }

    var icon: String {
        switch self {
        case .airInlet: return "arrow.down.circle"
        case .airFilter: return "line.3.horizontal.decrease.circle"
        case .pressureLine: return "gauge.with.dots.needle.33percent"
        case .cultureVessel: return "flask.fill"
        case .reservoir: return "cylinder.fill"
        case .transferTube: return "arrow.left.arrow.right"
        case .drainLine: return "arrow.down.right"
        case .ventLine: return "wind"
        case .solenoidValve: return "circle.grid.cross"
        case .airPump: return "fan.fill"
        case .liquidPump: return "drop.circle.fill"
        }
    }
}
