import Foundation

/// Spec Phase 7B. Separate from CultureStage: stage tracks *biological*
/// progress (multiplication, rooting...), status tracks whether this
/// batch record is still the active unit of work. A split batch keeps
/// its original stage/count as a true historical fact (spec's own
/// traceability emphasis — never zero out real history) but stops
/// being "active": its children carry the work forward.
enum CultureBatchStatus: String, Codable, CaseIterable, Identifiable {
    case active
    case paused
    case split
    case completed
    case discarded

    var id: String { rawValue }

    var label: String {
        switch self {
        case .active: return "Actif"
        case .paused: return "En pause"
        case .split: return "Divisé"
        case .completed: return "Terminé"
        case .discarded: return "Écarté"
        }
    }
}
