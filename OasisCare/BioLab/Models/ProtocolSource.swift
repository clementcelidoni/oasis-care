import Foundation

/// Enhancement §7 "SOURCES" — a literature citation backing a
/// recommendation. Every field but `sourceType` is optional because a
/// real citation is often partial (a DOI without a title, a journal
/// without a year) — §7's own rule is stricter than any missing field:
/// if the AI has no real source at all, it must say so explicitly
/// (`SmartMediaService` never fabricates a `ProtocolSource` to fill this
/// gap — see that type's own doc comment).
struct ProtocolSource: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var title: String?
    var authors: String?
    var year: Int?
    var journal: String?
    var doi: String?
    var url: String?
    var notes: String?
    var sourceType: EvidenceType

    /// `id` is deliberately absent here: this decodes AI-generated JSON
    /// (the `recommend-medium` Edge Function's response) that has no
    /// reason to invent a client-side identifier. Omitting it from
    /// `CodingKeys` makes both `Encodable`/`Decodable` skip it entirely
    /// rather than requiring the key to be present.
    enum CodingKeys: String, CodingKey {
        case title, authors, year, journal, doi, url, notes, sourceType
    }
}

/// Enhancement §5 "PROVENANCE DE LA RECOMMANDATION — CRITIQUE" +
/// §26 "NOMBRE D'OBSERVATIONS." Attached to every AI-generated
/// suggestion so the UI can always show why it exists, never just the
/// suggestion itself.
struct RecommendationEvidence: Codable, Hashable {
    var evidenceType: EvidenceType
    var confidence: ConfidenceLevel
    /// §8 "Pourquoi cette proposition ?" — données disponibles /
    /// similitudes / différences / incertitudes, as free text the AI
    /// writes itself rather than four separate rigid fields, since
    /// which of the four applies varies per case.
    var explanation: String
    /// §26 — "Basé sur N lots." Nil when the evidence isn't grounded in
    /// this workspace's own batch history (e.g. a pure literature or AI
    /// extrapolation source).
    var basedOnBatchCount: Int?
    var sources: [ProtocolSource]
}
