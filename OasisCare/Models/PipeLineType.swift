import SwiftUI

/// Spec Phase 6D — "différencier : alimentation principale / secondaire
/// / goutte-à-goutte."
enum PipeLineType: String, Codable, CaseIterable, Identifiable {
    case mainSupply, secondary, dripLine

    var id: String { rawValue }

    var label: String {
        switch self {
        case .mainSupply: return "Alimentation principale"
        case .secondary: return "Secondaire"
        case .dripLine: return "Goutte-à-goutte"
        }
    }

    var color: Color {
        switch self {
        case .mainSupply: return .blue
        case .secondary: return .cyan
        case .dripLine: return .teal
        }
    }

    var lineWidth: CGFloat {
        switch self {
        case .mainSupply: return 3
        case .secondary: return 2
        case .dripLine: return 1.5
        }
    }

    /// Non-color signal alongside the tint above, same reasoning as the
    /// no-go zone hatching — a solid/dashed/dotted line reads even
    /// without color.
    var dashPattern: [CGFloat] {
        switch self {
        case .mainSupply: return []
        case .secondary: return [6, 3]
        case .dripLine: return [1, 3]
        }
    }
}
