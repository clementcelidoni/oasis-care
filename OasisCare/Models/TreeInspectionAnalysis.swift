import Foundation

/// Decoded response from the analyze-tree-inspection Edge Function
/// (spec §59). Fields optional/lenient for the same reason as
/// PlantDiagnosis: an AI response CI can't exercise should degrade
/// gracefully, never fail the whole decode.
struct TreeInspectionAnalysis: Codable {
    var observations: [String]?
    var pointsToCheck: [String]?
    var confidence: String?
    var provider: String?
    var model: String?

    var confidenceLevel: AIConfidence {
        AIConfidence(rawValue: confidence ?? "") ?? .unknown
    }
}
