import Foundation

/// Decoded response from the diagnose-plant-problem Edge Function.
/// Fields are optional/lenient on purpose: this is decoded from a
/// server AI response that can't be exercised by CI, so a missing or
/// unexpected field should degrade gracefully rather than fail the
/// whole decode.
struct PlantDiagnosis: Codable {
    var summary: String?
    var possibleCause: String?
    /// Raw string from the server, not decoded straight into
    /// AIConfidence — an unrecognized value here shouldn't take down
    /// the whole decode. Use `confidenceLevel` for display.
    var confidence: String?
    var reasoning: [String]?
    var checksToPerform: [String]?
    var recommendedActions: [String]?
    var provider: String?
    var model: String?

    var confidenceLevel: AIConfidence {
        AIConfidence(rawValue: confidence ?? "") ?? .unknown
    }
}
