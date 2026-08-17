import Foundation

/// Spec §13. Anomaly detection (Phase 5I) treats anything but `.good`
/// as not-fully-trustworthy without necessarily raising its own alert —
/// a reading can be individually flagged `.uncertain` without the
/// sensor itself being considered offline.
enum SensorReadingQuality: String, Codable, CaseIterable, Identifiable {
    case good
    case uncertain
    case invalid
    case offline

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .good: return "Fiable"
        case .uncertain: return "Incertaine"
        case .invalid: return "Invalide"
        case .offline: return "Hors ligne"
        }
    }
}
