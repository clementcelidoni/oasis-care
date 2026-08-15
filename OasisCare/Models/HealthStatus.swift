import SwiftUI

enum HealthStatus: String, Codable, CaseIterable, Identifiable {
    case healthy
    case monitor
    case attention
    case urgent

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .healthy: return "En bonne santé"
        case .monitor: return "À surveiller"
        case .attention: return "Attention"
        case .urgent: return "Urgent"
        }
    }

    var color: Color {
        switch self {
        case .healthy: return .green
        case .monitor: return .yellow
        case .attention: return .orange
        case .urgent: return .red
        }
    }
}
