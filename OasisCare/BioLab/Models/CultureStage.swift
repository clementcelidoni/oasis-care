import Foundation

/// Spec Phase 7B — "CULTURE STAGE... extensible." The biological stage
/// of a culture batch, independent of CultureBatchStatus (whether the
/// batch itself is still an active, distinct unit of work — see that
/// type's own doc comment for why the two are kept separate).
enum CultureStage: String, Codable, CaseIterable, Identifiable {
    case initiation
    case multiplication
    case elongation
    case rooting
    case preAcclimatization
    case acclimatization
    case completed
    case discarded

    var id: String { rawValue }

    var label: String {
        switch self {
        case .initiation: return "Initiation"
        case .multiplication: return "Multiplication"
        case .elongation: return "Élongation"
        case .rooting: return "Enracinement"
        case .preAcclimatization: return "Pré-acclimatation"
        case .acclimatization: return "Acclimatation"
        case .completed: return "Terminé"
        case .discarded: return "Écarté"
        }
    }

    var icon: String {
        switch self {
        case .initiation: return "leaf.circle"
        case .multiplication: return "leaf.arrow.circlepath"
        case .elongation: return "arrow.up.to.line"
        case .rooting: return "arrow.down.to.line"
        case .preAcclimatization: return "sun.min"
        case .acclimatization: return "sun.max.fill"
        case .completed: return "checkmark.circle.fill"
        case .discarded: return "xmark.circle"
        }
    }
}
