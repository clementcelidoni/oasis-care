import Foundation

/// Spec §19-22. Everything here is a SUGGESTION, never an automatic
/// change — "Ne jamais changer silencieusement le planning." The
/// caller decides whether to show/apply what these functions return.
enum SmartWateringService {
    // MARK: - Rain suggestion (spec §20)

    struct RainSuggestion {
        var plants: [(plant: Plant, schedule: CareSchedule)]
        var rainAmountMm: Double
        var dayLabel: String
    }

    /// Outdoor plants with an active watering schedule due in the next
    /// 2 days, when meaningful rain is forecast for tomorrow — ≥10mm
    /// normally, or a lower `minimumRainMm` when spec §76's Économie
    /// d'eau mode is active ("seuils raisonnables" biased toward
    /// postponing more readily, not a fixed hardcoded number).
    static func rainSuggestion(plants: [Plant], weather: WeatherService.WeatherData, minimumRainMm: Double = 10) -> RainSuggestion? {
        guard let tomorrow = weather.dailyForecast.first, let mm = tomorrow.precipitationMm, mm >= minimumRainMm else { return nil }

        let horizon = Calendar.current.date(byAdding: .day, value: 2, to: .now) ?? .now
        var affected: [(Plant, CareSchedule)] = []
        for plant in plants where !plant.isIndoor {
            guard let schedule = plant.schedule(for: .watering), schedule.isActive else { continue }
            guard let due = schedule.nextDueDate, due <= horizon else { continue }
            affected.append((plant, schedule))
        }
        guard !affected.isEmpty else { return nil }
        return RainSuggestion(plants: affected, rainAmountMm: mm, dayLabel: "demain")
    }

    // MARK: - Heatwave alert (spec §21)

    struct HeatwaveAlert {
        var maxTemperatureCelsius: Double
        var dayCount: Int
        var youngPlants: [Plant]
    }

    private static let heatwaveThresholdCelsius = 34.0
    private static let heatwaveMinConsecutiveDays = 3
    private static let youngPlantMaxAgeDays = 90

    static func heatwaveAlert(plants: [Plant], weather: WeatherService.WeatherData) -> HeatwaveAlert? {
        let hotDays = weather.dailyForecast.prefix(heatwaveMinConsecutiveDays)
        guard hotDays.count == heatwaveMinConsecutiveDays,
              hotDays.allSatisfy({ ($0.maxCelsius ?? 0) >= heatwaveThresholdCelsius })
        else { return nil }

        let maxTemp = hotDays.compactMap(\.maxCelsius).max() ?? heatwaveThresholdCelsius
        let cutoff = Calendar.current.date(byAdding: .day, value: -youngPlantMaxAgeDays, to: .now) ?? .now
        let young = plants.filter { $0.dateAdded >= cutoff }

        return HeatwaveAlert(maxTemperatureCelsius: maxTemp, dayCount: heatwaveMinConsecutiveDays, youngPlants: young)
    }

    // MARK: - Frost alert (spec §74)

    struct FrostAlert {
        var minTemperatureCelsius: Double
        var dayLabel: String
    }

    /// "Température proche du seuil" — warns a couple degrees before
    /// actual freezing, not only once the forecast already reads
    /// sub-zero, so there's still time to act (spec §74's own
    /// possibilities: alert, greenhouse heating, protecting zones).
    private static let frostThresholdCelsius = 2.0

    static func frostAlert(weather: WeatherService.WeatherData) -> FrostAlert? {
        guard let tomorrow = weather.dailyForecast.first, let minTemp = tomorrow.minCelsius, minTemp <= frostThresholdCelsius else { return nil }
        return FrostAlert(minTemperatureCelsius: minTemp, dayLabel: "demain")
    }

    // MARK: - Learning from real history (spec §22)

    struct FrequencySuggestion: Identifiable {
        var id: UUID { schedule.id }
        var plant: Plant
        var schedule: CareSchedule
        var configuredDays: Int
        var actualAverageDays: Int
    }

    private static let minEventsForSuggestion = 4
    private static let minDayDifferenceToSuggest = 2

    /// Compares each active watering schedule's configured frequency to
    /// the real average interval between actual watering events, and
    /// suggests adjusting when they've meaningfully diverged. Needs at
    /// least a handful of real events — a suggestion from 2 data points
    /// isn't a pattern, it's noise presented as one.
    static func frequencySuggestions(plants: [Plant]) -> [FrequencySuggestion] {
        var results: [FrequencySuggestion] = []
        for plant in plants {
            guard let schedule = plant.schedule(for: .watering), schedule.isActive else { continue }
            let waterings = plant.careEvents
                .filter { $0.type == .watering }
                .sorted { $0.date < $1.date }
            guard waterings.count >= minEventsForSuggestion else { continue }

            let intervals = zip(waterings, waterings.dropFirst()).map { first, second in
                Calendar.current.dateComponents([.day], from: first.date, to: second.date).day ?? 0
            }
            guard !intervals.isEmpty else { continue }
            let average = intervals.reduce(0, +) / intervals.count
            guard abs(average - schedule.frequencyDays) >= minDayDifferenceToSuggest else { continue }

            // « Garder N j » veut dire quelque chose, et ce filtre est ce
            // qui le lui fait vouloir dire. Sans lui, refuser une
            // suggestion la faisait réapparaître au chargement suivant du
            // tableau de bord — c'est-à-dire tout de suite.
            guard !WateringSuggestionDismissals.isDismissed(
                plantID: plant.id,
                configuredDays: schedule.frequencyDays
            ) else { continue }

            results.append(FrequencySuggestion(plant: plant, schedule: schedule, configuredDays: schedule.frequencyDays, actualAverageDays: average))
        }
        return results
    }
}
