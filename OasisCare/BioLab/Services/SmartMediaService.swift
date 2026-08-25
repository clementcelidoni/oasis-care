import Foundation

/// Enhancement Phase 7O — calls the `recommend-medium` Edge Function.
/// Same "one path in per feature, never call the backend directly"
/// shape as every other AI service in this app (`BioLabAIService`,
/// `PlantAIService`...).
///
/// §7 "NE PAS INVENTER DE RÉFÉRENCE" and §5 "PROVENANCE... CRITIQUE"
/// are enforced server-side (the Edge Function's own system prompt
/// forbids fabricating a `ProtocolSource`), not re-validated here — this
/// service only shapes the request and decodes whatever the function
/// actually returns.
enum SmartMediaService {
    /// §4 "PLUSIEURS PROPOSITIONS" — up to a few `MediaRecommendation`s,
    /// never silently narrowed to one; the user picks (§4: "l'utilisateur
    /// choisit").
    static func recommendMedium(for request: MediaRecommendationRequest) async throws -> [MediaRecommendation] {
        struct ResponseBody: Decodable {
            var recommendations: [MediaRecommendation]
        }
        let response: ResponseBody = try await AIBackend.invoke("recommend-medium", body: request)
        return response.recommendations
    }

    /// Builds the request context from real, local data only — batches
    /// are summarized as short text (species/stage/outcome), never
    /// forwarded as a raw model dump, matching
    /// `BioLabInspectionAIContext`'s own "context, not an export" shape.
    static func buildRequest(
        speciesName: String, cultivar: String?, explantType: String?, cultureStage: CultureStage, cultureSystem: CultureSystem?,
        priorVersions: [MediumRecipeVersion], priorExperiments: [BioLabExperiment], priorBatches: [CultureBatch]
    ) -> MediaRecommendationRequest {
        let protocolSummaries = priorVersions.compactMap { version -> String? in
            guard let recipeName = version.recipe?.name else { return nil }
            return "\(recipeName) V\(version.versionNumber) — pH cible \(version.targetPH)"
        }
        let experimentSummaries = priorExperiments.map { "\($0.code) — \($0.question)" }
        let batchSummaries = priorBatches.map { batch -> String in
            let ratio = batch.initialExplantCount > 0 ? Double(batch.currentCount) / Double(batch.initialExplantCount) : nil
            let ratioText = ratio.map { "x\(String(format: "%.1f", $0))" } ?? "ratio inconnu"
            return "\(batch.batchCode) — \(batch.cultureStage.label), multiplication \(ratioText)"
        }
        return MediaRecommendationRequest(
            speciesName: speciesName, cultivar: cultivar, explantType: explantType, cultureStage: cultureStage.label,
            cultureSystem: cultureSystem?.label, previousProtocolSummaries: protocolSummaries,
            previousExperimentSummaries: experimentSummaries, previousBatchResultSummaries: batchSummaries
        )
    }
}
