import Foundation

/// Calls the biolab-ai-assistant, compare-biolab-performance, and
/// analyze-biolab-inspection Edge Functions — spec Phase 7I "Oasis AI
/// BioLab." Same "one path in per feature, never call the backend
/// directly" shape as every other AI service in this app.
enum BioLabAIService {
    static let maxImages = 4

    static func ask(_ question: String, context: BioLabAIContext) async throws -> String {
        struct RequestBody: Encodable {
            var question: String
            var context: BioLabAIContext
        }
        struct ResponseBody: Decodable {
            var answer: String
        }
        let response: ResponseBody = try await AIBackend.invoke(
            "biolab-ai-assistant",
            body: RequestBody(question: question, context: context)
        )
        return response.answer
    }

    static func compare(_ subjectA: BioLabComparisonSubject, _ subjectB: BioLabComparisonSubject) async throws -> BioLabComparisonResult {
        struct RequestBody: Encodable {
            var subjectA: BioLabComparisonSubject
            var subjectB: BioLabComparisonSubject
        }
        return try await AIBackend.invoke(
            "compare-biolab-performance",
            body: RequestBody(subjectA: subjectA, subjectB: subjectB)
        )
    }

    /// `images` are raw JPEG bytes, as produced by CameraCaptureView or
    /// a photo library selection.
    static func analyzeInspectionPhotos(images: [Data], context: BioLabInspectionAIContext) async throws -> BioLabInspectionAnalysis {
        let encoded = encode(images, limit: maxImages)
        guard !encoded.isEmpty else { throw AIServiceError.noUsablePhoto }

        struct RequestBody: Encodable {
            var images: [String]
            var context: BioLabInspectionAIContext
        }
        return try await AIBackend.invoke(
            "analyze-biolab-inspection",
            body: RequestBody(images: encoded, context: context)
        )
    }

    private static func encode(_ images: [Data], limit: Int) -> [String] {
        var encoded: [String] = []
        for imageData in images.prefix(limit) {
            guard let processed = ImageProcessing.prepareForStorage(imageData) else { continue }
            encoded.append(processed.detailData.base64EncodedString())
        }
        return encoded
    }
}

/// Spec Phase 7I: "L'IA peut utiliser : espèce, cultivar, stade,
/// recette... inspections." What the analyze-biolab-inspection function
/// knows about the batch/inspection being photographed — never the
/// batch's full history, matching TreeInspectionAIContext's own scoping.
struct BioLabInspectionAIContext: Encodable {
    var speciesName: String?
    var cultureStage: String?
    var recipeVersion: Int?
    var existingContaminationStatus: String?
    var existingHyperhydricityStatus: String?

    /// Takes loose values rather than a BioreactorInspection so the
    /// form can call this before a new inspection has ever been
    /// constructed (or saved) — same reasoning as building a fresh
    /// TreeInspectionAIContext from a Plant rather than the inspection
    /// object being edited.
    static func build(
        batch: CultureBatch?, contaminationStatus: ContaminationStatus, hyperhydricityStatus: ObservedSeverity
    ) -> BioLabInspectionAIContext {
        BioLabInspectionAIContext(
            speciesName: batch?.speciesName, cultureStage: batch?.cultureStage.label,
            recipeVersion: batch?.mediumRecipeVersion?.versionNumber,
            existingContaminationStatus: contaminationStatus.label,
            existingHyperhydricityStatus: hyperhydricityStatus.label
        )
    }
}
