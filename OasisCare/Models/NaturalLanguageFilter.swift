import Foundation

/// Decoded response from the natural-language-search Edge Function
/// (spec §70): the AI's job is only to translate a French sentence
/// into this constrained shape — every field maps directly to a raw
/// enum value or a plain comparison NaturalLanguageSearchService
/// already knows how to apply locally. The AI never sees or produces
/// SQL (spec's own explicit instruction: "Ne jamais laisser l'IA
/// exécuter du SQL arbitraire").
struct NaturalLanguageFilter: Codable {
    var plantType: String?
    var isIndoor: Bool?
    var healthStatus: String?
    var zoneName: String?
    var careEventType: String?
    var careEventDaysThreshold: Int?
    /// "moreThan" or "lessThan" — how careEventDaysThreshold compares
    /// against days since the plant's last event of careEventType.
    var careEventComparison: String?
    /// Plain-language restatement of the filter actually applied,
    /// shown to the user so they can tell the search understood them
    /// correctly rather than trusting an opaque result list.
    var summary: String
}

/// What the AI is given to choose valid raw values from — never a raw
/// data dump, just the vocabulary it's allowed to use (spec §69's same
/// "ne jamais envoyer toute la base" spirit applied to search).
struct NaturalLanguageSearchContext: Encodable {
    var availablePlantTypes: [String]
    var availableCareEventTypes: [String]
    var availableHealthStatuses: [String]
    var availableZoneNames: [String]

    static func build(plants: [Plant]) -> NaturalLanguageSearchContext {
        NaturalLanguageSearchContext(
            availablePlantTypes: PlantType.allCases.map(\.rawValue),
            availableCareEventTypes: CareEventType.allCases.map(\.rawValue),
            availableHealthStatuses: HealthStatus.allCases.map(\.rawValue),
            availableZoneNames: Array(Set(plants.compactMap { $0.zone?.name })).sorted()
        )
    }
}
