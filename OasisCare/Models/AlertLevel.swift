import Foundation

/// Spec §64.
enum AlertLevel: Int, Comparable {
    case info, warning, important, critical

    static func < (lhs: AlertLevel, rhs: AlertLevel) -> Bool { lhs.rawValue < rhs.rawValue }

    var displayName: String {
        switch self {
        case .info: return "Info"
        case .warning: return "Avertissement"
        case .important: return "Important"
        case .critical: return "Critique"
        }
    }

    var icon: String {
        switch self {
        case .info: return "info.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .important: return "exclamationmark.circle.fill"
        case .critical: return "exclamationmark.octagon.fill"
        }
    }
}
