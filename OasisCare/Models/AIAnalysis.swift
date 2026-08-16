import Foundation
import SwiftData

/// A record of one AI interaction for a plant — an at-add-time profile
/// completion, an assistant answer, or a problem diagnosis (spec §46:
/// "historique des analyses"). Immutable history, same as CareEvent:
/// never edited after creation, only ever appended to.
@Model
final class AIAnalysis {
    var id: UUID
    var type: AIAnalysisType
    var date: Date
    var summary: String
    /// Raw JSON text of the full structured result (reasoning, checks,
    /// suggested program, etc., shape depends on `type`) — kept as text
    /// rather than modeled field-by-field since each analysis type has
    /// a different shape and this is only ever redisplayed, never
    /// queried locally. Decode on demand with `decodedDiagnosis()`.
    var structuredDataJSON: String?
    var provider: String
    var model: String?
    var confidence: AIConfidence?
    var plant: Plant?
    var syncStatus: SyncStatus?

    init(
        plant: Plant?,
        type: AIAnalysisType,
        date: Date = .now,
        summary: String,
        structuredDataJSON: String? = nil,
        provider: String,
        model: String? = nil,
        confidence: AIConfidence? = nil
    ) {
        self.id = UUID()
        self.plant = plant
        self.type = type
        self.date = date
        self.summary = summary
        self.structuredDataJSON = structuredDataJSON
        self.provider = provider
        self.model = model
        self.confidence = confidence
        self.syncStatus = .pendingCreate
    }

    func decodedDiagnosis() -> PlantDiagnosis? {
        guard let json = structuredDataJSON?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(PlantDiagnosis.self, from: json)
    }

    func decodedTreeInspectionAnalysis() -> TreeInspectionAnalysis? {
        guard let json = structuredDataJSON?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(TreeInspectionAnalysis.self, from: json)
    }

    func decodedTreePhotoComparison() -> TreePhotoComparison? {
        guard let json = structuredDataJSON?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(TreePhotoComparison.self, from: json)
    }
}
