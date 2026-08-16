import Foundation

/// Spec §70 — turns a French sentence into a NaturalLanguageFilter via
/// the Edge Function, then applies it entirely locally. The AI never
/// touches plant data directly; it only chooses which of these already-
/// known fields to filter on.
enum NaturalLanguageSearchService {
    static func search(query: String, plants: [Plant]) async throws -> NaturalLanguageFilter {
        struct RequestBody: Encodable {
            var query: String
            var context: NaturalLanguageSearchContext
        }
        return try await AIBackend.invoke(
            "natural-language-search",
            body: RequestBody(query: query, context: .build(plants: plants))
        )
    }

    static func apply(_ filter: NaturalLanguageFilter, to plants: [Plant]) -> [Plant] {
        plants.filter { plant in
            if let raw = filter.plantType, let type = PlantType(rawValue: raw), plant.type != type {
                return false
            }
            if let isIndoor = filter.isIndoor, plant.isIndoor != isIndoor {
                return false
            }
            if let raw = filter.healthStatus, let status = HealthStatus(rawValue: raw), plant.healthStatus != status {
                return false
            }
            if let zoneName = filter.zoneName, !zoneName.isEmpty {
                guard plant.zone?.name.localizedCaseInsensitiveContains(zoneName) ?? false else { return false }
            }
            if let raw = filter.careEventType, let eventType = CareEventType(rawValue: raw) {
                guard matchesCareEventCondition(plant: plant, type: eventType, filter: filter) else { return false }
            }
            return true
        }
    }

    /// "Never had this event" counts as infinitely overdue for a
    /// "more than N days" query (spec's own example: palms with no
    /// fertilizing in 60+ days includes ones that were never
    /// fertilized at all) — but never matches a "less than N days"
    /// query, since there's no date to be recent.
    private static func matchesCareEventCondition(plant: Plant, type: CareEventType, filter: NaturalLanguageFilter) -> Bool {
        guard let threshold = filter.careEventDaysThreshold else { return true }
        let lastEventDate = plant.careEvents.filter { $0.type == type }.map(\.date).max()
        let days = lastEventDate.map { Calendar.current.dateComponents([.day], from: $0, to: .now).day ?? 0 }

        switch filter.careEventComparison {
        case "lessThan":
            guard let days else { return false }
            return days <= threshold
        default:
            guard let days else { return true }
            return days >= threshold
        }
    }
}
