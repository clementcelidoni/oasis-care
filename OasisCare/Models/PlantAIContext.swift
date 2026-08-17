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
    /// Spec §66 — humidité sol/température sol/température air/humidité
    /// air/lumière, one entry per sensor actually linked to this plant.
    var currentReadings: [SensorReadingContext]?
    /// Spec §66's "données historiques" — a short recent trend per
    /// sensor (last 7 days, capped), not the full history: enough for
    /// the model to see a direction without flooding the prompt, same
    /// "limiter intelligemment la quantité de données envoyées"
    /// reasoning as recentCareEvents' own 15-event cap below.
    var recentReadingHistory: [SensorReadingContext]?
    var lastIrrigation: CareEventContext?
    var weather: WeatherContext?

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

    /// Superseded by `currentReadings` below (real per-sensor-type
    /// values instead of just temperature/humidity) but kept so any
    /// caller still setting it directly doesn't break; build(for:)
    /// itself no longer populates it.
    struct Environment: Encodable {
        var temperatureCelsius: Double?
        var humidityPercent: Double?
    }

    /// Spec §66/§70 — carries its own provenance (source/isStale)
    /// alongside the value, so the Edge Function's prompt can label it
    /// as measured-and-current vs. measured-but-possibly-outdated
    /// itself, rather than the model having to guess that from a bare
    /// number.
    struct SensorReadingContext: Encodable {
        var label: String
        var value: Double
        var unit: String
        var measuredAt: String
        var isStale: Bool
        var source: String
    }

    /// Spec §66's "météo" — sourced from WeatherCache (the same
    /// device-local, non-synced cache the dashboard's own weather card
    /// reads), never a fresh network call from here. `asOf` is
    /// WeatherData's own `fetchedAt` — when that cached snapshot was
    /// actually fetched, not "now" — since presenting a multi-day-old
    /// forecast as current would be exactly the kind of unlabeled
    /// staleness spec §70 warns against.
    struct WeatherContext: Encodable {
        var condition: String?
        var temperatureCelsius: Double?
        var precipitationForecastMm: Double?
        var asOf: String?
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        formatter.locale = Locale(identifier: "fr_FR")
        return formatter
    }()

    /// Includes the time, unlike `dateFormatter` above — freshness (was
    /// this measured an hour ago or three days ago?) matters for sensor
    /// readings and weather in a way it doesn't for a watering date.
    private static let dateTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        formatter.locale = Locale(identifier: "fr_FR")
        return formatter
    }()

    private static let recentReadingHistoryLookback: TimeInterval = 7 * 86400
    private static let recentReadingHistoryCap = 10

    /// Limits to recent history rather than the whole plant record
    /// (spec §41-42: "ne transmet pas automatiquement toute la base
    /// utilisateur" / "limiter intelligemment la quantité de données
    /// envoyées").
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

        let currentReadings: [SensorReadingContext] = plant.sensors.compactMap { sensor in
            guard let reading = sensor.latestReading else { return nil }
            return SensorReadingContext(
                label: sensor.type.displayName, value: reading.value, unit: sensor.unit,
                measuredAt: dateTimeFormatter.string(from: reading.timestamp),
                isStale: sensor.isStale, source: sensor.source.displayName
            )
        }

        let historyCutoff = Date.now.addingTimeInterval(-recentReadingHistoryLookback)
        let recentHistory: [SensorReadingContext] = plant.sensors.flatMap { sensor -> [SensorReadingContext] in
            sensor.readings
                .filter { $0.timestamp >= historyCutoff }
                .sorted { $0.timestamp < $1.timestamp }
                .suffix(recentReadingHistoryCap)
                .map { reading in
                    SensorReadingContext(
                        label: sensor.type.displayName, value: reading.value, unit: sensor.unit,
                        measuredAt: dateTimeFormatter.string(from: reading.timestamp),
                        isStale: false, source: sensor.source.displayName
                    )
                }
        }

        let lastIrrigation: CareEventContext? = {
            if let zoneEvent = plant.irrigationZone?.events.max(by: { $0.date < $1.date }) {
                return CareEventContext(
                    type: "Arrosage (zone connectée)", date: dateTimeFormatter.string(from: zoneEvent.date),
                    notes: nil, quantity: zoneEvent.estimatedLiters, unit: "L"
                )
            }
            if let watering = plant.sortedCareEvents.first(where: { $0.type == .watering }) {
                return CareEventContext(
                    type: "Arrosage", date: dateTimeFormatter.string(from: watering.date),
                    notes: nil, quantity: watering.quantity, unit: watering.unit
                )
            }
            return nil
        }()

        let weather: WeatherContext? = plant.garden.flatMap { garden in
            WeatherCache.load(for: garden.id).map { data in
                WeatherContext(
                    condition: data.conditionDescription,
                    temperatureCelsius: data.temperatureCelsius,
                    precipitationForecastMm: data.dailyForecast.first?.precipitationMm,
                    asOf: dateTimeFormatter.string(from: data.fetchedAt)
                )
            }
        }

        return PlantAIContext(
            scientificName: plant.scientificName,
            commonName: plant.commonName,
            plantType: plant.type.displayName,
            isIndoor: plant.isIndoor,
            notes: plant.notes.isEmpty ? nil : plant.notes,
            recentCareEvents: Array(events),
            careSchedules: schedules,
            environment: nil,
            currentReadings: currentReadings.isEmpty ? nil : currentReadings,
            recentReadingHistory: recentHistory.isEmpty ? nil : recentHistory,
            lastIrrigation: lastIrrigation,
            weather: weather
        )
    }
}
