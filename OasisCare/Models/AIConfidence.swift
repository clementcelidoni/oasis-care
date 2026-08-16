import Foundation

/// How sure the AI is about a piece of information it generated — spec
/// §38: "L'IA doit pouvoir indiquer high/medium/low/unknown... si une
/// donnée n'est pas connue, ne pas inventer."
enum AIConfidence: String, Codable, CaseIterable, Identifiable {
    case high
    case medium
    case low
    case unknown

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .high: return "Confiance élevée"
        case .medium: return "Confiance moyenne"
        case .low: return "Confiance faible"
        case .unknown: return "Confiance inconnue"
        }
    }
}
