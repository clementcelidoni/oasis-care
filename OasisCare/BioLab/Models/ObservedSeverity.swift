import SwiftUI

/// Spec Phase 7H — "HYPERHYDRICITÉ: none/mild/moderate/severe/unknown."
/// Shared by hyperhydricityStatus, necrosisStatus, and browningStatus on
/// BioreactorInspection: spec gives this exact scale only for
/// hyperhydricity, but necrosis/browning are the same kind of assessment
/// (severity of a visually observed tissue defect) and spec names them
/// with the same "...Status" shape — reusing one real, spec-given scale
/// across all three avoids inventing two more scientific classifications
/// spec never specifies. growthStatus is deliberately NOT this type: it
/// assesses a good thing, not a defect, so "severe growth" would read
/// backwards — it's free text instead (see BioreactorInspection).
enum ObservedSeverity: String, Codable, CaseIterable, Identifiable {
    case none
    case mild
    case moderate
    case severe
    case unknown

    var id: String { rawValue }

    var label: String {
        switch self {
        case .none: return "Aucune"
        case .mild: return "Légère"
        case .moderate: return "Modérée"
        case .severe: return "Sévère"
        case .unknown: return "Inconnue"
        }
    }

    var color: Color {
        switch self {
        case .none: return .green
        case .mild: return .yellow
        case .moderate: return .orange
        case .severe: return .red
        case .unknown: return .secondary
        }
    }
}
