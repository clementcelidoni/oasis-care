import Foundation

/// Decoded response from the compare-tree-photos Edge Function (spec
/// §60) — the five axes the spec names explicitly, plus a summary.
struct TreePhotoComparison: Codable {
    var summary: String?
    var foliageChange: String?
    var densityChange: String?
    var growthObserved: String?
    var yellowingObserved: String?
    var declineObserved: String?
    var confidence: String?
    var provider: String?
    var model: String?

    var confidenceLevel: AIConfidence {
        AIConfidence(rawValue: confidence ?? "") ?? .unknown
    }
}
