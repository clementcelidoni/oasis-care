import Foundation

/// Decoded response from the analyze-biolab-inspection Edge Function —
/// spec Phase 7I's own six axes ("l'IA peut détecter visuellement des
/// éléments compatibles avec : croissance, coloration, brunissement,
/// nécrose, hyperhydricité potentielle, contamination visible
/// potentielle"). Fields optional/lenient for the same reason as
/// TreeInspectionAnalysis: an AI response CI can't exercise should
/// degrade gracefully, never fail the whole decode. "Potentielle" in the
/// spec's own field names is doing real work — see the Edge Function's
/// system prompt for why contamination in particular is never returned
/// as a certainty.
struct BioLabInspectionAnalysis: Codable {
    var growthObservation: String?
    var colorationObservation: String?
    var browningObservation: String?
    var necrosisObservation: String?
    var hyperhydricityObservation: String?
    var contaminationObservation: String?
    var confidence: String?
    var provider: String?
    var model: String?

    var confidenceLevel: AIConfidence {
        AIConfidence(rawValue: confidence ?? "") ?? .unknown
    }
}
