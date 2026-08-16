import Foundation

/// What the assistant/diagnosis Edge Functions know about a specific
/// plant (spec §42) — built fresh from local data each call, never
/// persisted. Dates are pre-formatted strings rather than raw `Date`
/// values so the server always receives something readable regardless
/// of the Functions client's date-encoding behavior.
struct PlantAIContext: Encodable {
    var scientificName: String?
    var commonName: String?
    var plantType: String?
    var isIndoor: Bool?
    var notes: String?
    var recentCareEvents: [CareEventContext]?
    var careSchedules: [CareScheduleContext]?
    var environment: Environment?

    struct CareEventContext: Encodable {
        var type: String
        var date: String
        var notes: String?
        var quantity: Double?
        var unit: String?
    }

    struct CareScheduleContext: Encodable {
        var type: String
        var frequencyDays: Int
        var lastCompletedDate: String?
    }

    struct Environment: Encodable {
        var temperatureCelsius: Double?
        var humidityPercent: Double?
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        formatter.locale = Locale(identifier: "fr_FR")
        return formatter
    }()

    /// Limits to recent history rather than the whole plant record
    /// (spec §41-42: "ne transmet pas automatiquement toute la base
    /// utilisateur" / "limiter intelligemment la quantité de données
    /// envoyées"). `environment` stays nil — Oasis Care has no sensor
    /// input yet (explicitly out of scope for Phase 3).
    static func build(for plant: Plant) -> PlantAIContext {
        let events = plant.sortedCareEvents.prefix(15).map { event in
            CareEventContext(
                type: event.type.displayName,
                date: dateFormatter.string(from: event.date),
                notes: event.notes.isEmpty ? nil : event.notes,
                quantity: event.quantity,
                unit: event.unit
            )
        }
        let schedules = plant.careSchedules.filter { $0.isActive }.map { schedule in
            CareScheduleContext(
                type: schedule.type.displayName,
                frequencyDays: schedule.frequencyDays,
                lastCompletedDate: schedule.lastCompletedDate.map(dateFormatter.string(from:))
            )
        }
        return PlantAIContext(
            scientificName: plant.scientificName,
            commonName: plant.commonName,
            plantType: plant.type.displayName,
            isIndoor: plant.isIndoor,
            notes: plant.notes.isEmpty ? nil : plant.notes,
            recentCareEvents: Array(events),
            careSchedules: schedules,
            environment: nil
        )
    }
}
