import Foundation

/// Spec Phase 6L — map-aware Oasis AI: "Où puis-je planter un bananier
/// ?", "Quelle zone est la plus sèche ?", and Mode Design ("Imaginer un
/// aménagement"). Separate from GardenAIService (dashboard-scoped
/// questions) because the context shape is genuinely different — this
/// one is zone/geometry-based, that one is counts-and-events-based —
/// matching this app's existing one-function-per-capability pattern
/// (plant-ai-assistant vs garden-ai-assistant vs diagnose-plant-problem
/// are already three separate Edge Functions, not one do-everything
/// endpoint).
enum GardenMapAIService {
    /// "RÉPONSE VISUELLE... RecommendedArea { polygon, score, reasons,
    /// warnings }." The AI never invents polygon coordinates — it
    /// references a real zoneId from the context it was given, and the
    /// client looks up that zone's actual, already-drawn polygon to
    /// highlight. That is what makes a "score" or "warning" trustworthy
    /// here: it is always attached to a shape the user drew, never one
    /// the model made up.
    struct RecommendedArea: Decodable, Identifiable {
        var zoneId: String
        var score: Int
        var reasons: [String]
        var warnings: [String]
        var id: String { zoneId }
    }

    struct QueryResult: Decodable {
        var answer: String
        var recommendedAreas: [RecommendedArea]
    }

    static func ask(_ question: String, context: GardenDigitalTwinAIContext) async throws -> QueryResult {
        struct RequestBody: Encodable {
            var mode = "query"
            var question: String
            var context: GardenDigitalTwinAIContext
        }
        return try await AIBackend.invoke("garden-map-ai-assistant", body: RequestBody(question: question, context: context))
    }

    /// "MODE DESIGN DU JARDIN... Imaginer un aménagement." Returns a
    /// species list + qualitative notes only — never coordinates. Spec's
    /// own "NE PAS LAISSER L'IA MODIFIER DIRECTEMENT LE PLAN" is easiest
    /// to guarantee by construction: if the model can't emit a
    /// position, the client's own deterministic layout (see
    /// GardenMapEngine.proposedPositions(for:inArea:)) is the only thing
    /// that ever proposes coordinates, and even that only ever previews
    /// — creating real objects still needs an explicit confirmation.
    struct DesignProposal: Decodable {
        var speciesNames: [String]
        var notes: String
    }

    static func imagineDesign(prompt: String, zoneId: String, context: GardenDigitalTwinAIContext) async throws -> DesignProposal {
        struct RequestBody: Encodable {
            var mode = "design"
            var question: String
            var zoneId: String
            var context: GardenDigitalTwinAIContext
        }
        struct ResponseBody: Decodable {
            var designProposal: DesignProposal?
        }
        let response: ResponseBody = try await AIBackend.invoke(
            "garden-map-ai-assistant",
            body: RequestBody(question: prompt, zoneId: zoneId, context: context)
        )
        guard let proposal = response.designProposal else {
            throw AIServiceError.invalidResponse
        }
        return proposal
    }
}
