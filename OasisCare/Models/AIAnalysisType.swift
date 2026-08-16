import Foundation

enum AIAnalysisType: String, Codable, CaseIterable, Identifiable {
    case profileCompletion
    case assistantQuestion
    case diagnosis

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .profileCompletion: return "Fiche complétée par l'IA"
        case .assistantQuestion: return "Question à l'assistant"
        case .diagnosis: return "Analyse d'un problème"
        }
    }

    var icon: String {
        switch self {
        case .profileCompletion: return "sparkles"
        case .assistantQuestion: return "bubble.left.and.bubble.right"
        case .diagnosis: return "stethoscope"
        }
    }
}
