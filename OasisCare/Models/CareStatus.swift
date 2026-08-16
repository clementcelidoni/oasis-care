import SwiftUI

enum CareStatus {
    case upcoming
    case dueToday
    case overdue
    case done

    var label: String {
        switch self {
        case .upcoming: return "À venir"
        case .dueToday: return "Aujourd'hui"
        case .overdue: return "En retard"
        case .done: return "Réalisée"
        }
    }

    var icon: String {
        switch self {
        case .upcoming: return "calendar"
        case .dueToday: return "sun.max.fill"
        case .overdue: return "exclamationmark.triangle.fill"
        case .done: return "checkmark.circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .upcoming: return .secondary
        case .dueToday: return .blue
        case .overdue: return .red
        case .done: return .green
        }
    }
}
