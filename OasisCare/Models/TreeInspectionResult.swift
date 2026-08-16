import SwiftUI

/// Spec §58's four-level overall result.
enum TreeInspectionResult: String, Codable, CaseIterable, Identifiable {
    case good
    case toWatch
    case intervention
    case urgent

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .good: return "Bon"
        case .toWatch: return "À surveiller"
        case .intervention: return "Intervention"
        case .urgent: return "Urgent"
        }
    }

    var color: Color {
        switch self {
        case .good: return .green
        case .toWatch: return .yellow
        case .intervention: return .orange
        case .urgent: return .red
        }
    }

    var icon: String { "circle.fill" }
}
