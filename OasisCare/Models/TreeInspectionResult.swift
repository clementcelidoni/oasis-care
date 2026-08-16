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

    /// Spec §62's garden check-up reuses this same four-level rating
    /// for every plant, tree or not — recording an entry also updates
    /// the plant's actual healthStatus (spec §67's alert priorities and
    /// the dashboard's health score already read from it), so a
    /// check-up finding feeds the rest of the app instead of living in
    /// its own silo. The two enums line up exactly, case for case.
    var healthStatus: HealthStatus {
        switch self {
        case .good: return .healthy
        case .toWatch: return .monitor
        case .intervention: return .attention
        case .urgent: return .urgent
        }
    }
}
