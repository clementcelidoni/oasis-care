import Foundation

/// Enhancement §4 "PLUSIEURS PROPOSITIONS" + §8 "FICHE DE PROPOSITION" —
/// one AI-generated medium proposal (the response shape for
/// `SmartMediaService.recommend`). Decode-only (never sent back as
/// JSON anywhere in this app) — same "never persisted as-is" pattern as
/// BioLabComparisonResult/BioLabInspectionAnalysis: once the user acts
/// on it (§9 "Utiliser cette recette"), it becomes a real
/// MediumRecipe/MediumRecipeVersion instead.
struct MediaRecommendation: Decodable, Identifiable, Hashable {
    var id: UUID = UUID()
    /// "Proposition A" / "Proposition B"...
    var label: String
    var basalMediumName: String
    var ingredients: [RecommendedIngredient]
    var targetPH: Double?
    var cultureSystem: CultureSystem?
    var evidence: RecommendationEvidence

    /// `id` omitted on purpose — see `ProtocolSource.CodingKeys` for why.
    enum CodingKeys: String, CodingKey {
        case label, basalMediumName, ingredients, targetPH, cultureSystem, evidence
    }
}

/// One ingredient line as the AI actually returns it — deliberately its
/// own type rather than reusing `MediumComponentAmount` directly: that
/// type's `id` has no `CodingKeys` override (it's relied on as-is by
/// the existing, already-shipped recipe-version sync round-trip, where
/// the JSON always has an id because Swift's own encoding put it
/// there), so decoding it straight from AI JSON that never sets one
/// would fail. `toMediumComponentAmount()` converts one of these into
/// the real, persisted type once the user actually adopts a proposal,
/// assigning a fresh id at that point.
struct RecommendedIngredient: Decodable, Hashable {
    var type: MediumComponentType
    var name: String
    var amount: Double
    var unit: ConcentrationUnit
    var pgrCategory: PlantGrowthRegulatorCategory?
    var sourceType: DataProvenance?

    func toMediumComponentAmount() -> MediumComponentAmount {
        MediumComponentAmount(type: type, name: name, amount: amount, unit: unit, pgrCategory: pgrCategory, sourceType: sourceType)
    }
}

/// Enhancement §2 "INFORMATIONS À UTILISER" — everything the
/// recommendation engine is allowed to key off, built once per request
/// so `SmartMediaService`/the Edge Function never need direct SwiftData
/// access. `previousProtocolSummaries`/`previousExperimentSummaries`/
/// `previousBatchResultSummaries` are short, pre-aggregated text (not
/// raw model dumps) — same "context, not a data export" shape as
/// `BioLabInspectionAIContext`.
struct MediaRecommendationRequest: Encodable {
    var speciesName: String
    var cultivar: String?
    var explantType: String?
    var cultureStage: String
    var cultureSystem: String?
    var previousProtocolSummaries: [String]
    var previousExperimentSummaries: [String]
    var previousBatchResultSummaries: [String]
}
