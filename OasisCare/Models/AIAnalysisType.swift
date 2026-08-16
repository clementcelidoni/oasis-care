import Foundation

enum AIAnalysisType: String, Codable, CaseIterable, Identifiable {
    case profileCompletion
    case assistantQuestion
    case diagnosis
    case treeInspectionAnalysis
    case treePhotoComparison

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .profileCompletion: return "Fiche complétée par l'IA"
        case .assistantQuestion: return "Question à l'assistant"
        case .diagnosis: return "Analyse d'un problème"
        case .treeInspectionAnalysis: return "Analyse d'inspection arboricole"
        case .treePhotoComparison: return "Comparaison de photos"
        }
    }

    var icon: String {
        switch self {
        case .profileCompletion: return "sparkles"
        case .assistantQuestion: return "bubble.left.and.bubble.right"
        case .diagnosis: return "stethoscope"
        case .treeInspectionAnalysis: return "tree.fill"
        case .treePhotoComparison: return "photo.on.rectangle.angled"
        }
    }
}
