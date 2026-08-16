import Foundation

/// Spec §15: "architecture indépendante du fournisseur." The provider
/// lives entirely inside fetch(latitude:longitude:) — callers only ever
/// see WeatherData, so swapping providers later touches this one file.
///
/// Uses Open-Meteo (open-meteo.com) rather than WeatherKit: WeatherKit
/// needs the same Apple Developer Portal capability + provisioning
/// profile dance as Sign in with Apple did in Phase 3A, which needs the
/// user's action first and can't happen mid-session. Open-Meteo's
/// forecast endpoint needs no API key for non-commercial use, so it can
/// ship working today; nothing stops swapping to WeatherKit later once
/// that entitlement is in place.
enum WeatherService {
    struct WeatherData: Codable {
        var temperatureCelsius: Double
        var temperatureMinCelsius: Double?
        var temperatureMaxCelsius: Double?
        var humidityPercent: Double?
        var windSpeedKmh: Double?
        var precipitationMm: Double?
        var uvIndex: Double?
        var conditionCode: Int?
        var fetchedAt: Date
        var dailyForecast: [DayForecast]

        struct DayForecast: Codable, Identifiable, Hashable {
            var id: String { date }
            var date: String
            var minCelsius: Double?
            var maxCelsius: Double?
            var precipitationMm: Double?
            var precipitationProbabilityPercent: Int?
            var uvIndexMax: Double?
            var conditionCode: Int?
        }

        var conditionDescription: String {
            WeatherCondition.description(for: conditionCode)
        }

        var conditionSymbol: String {
            WeatherCondition.symbol(for: conditionCode)
        }
    }

    enum WeatherServiceError: LocalizedError {
        case invalidResponse
        case unreachable

        var errorDescription: String? {
            switch self {
            case .invalidResponse: return "Réponse météo invalide."
            case .unreachable: return "Service météo injoignable."
            }
        }
    }

    static func fetch(latitude: Double, longitude: Double) async throws -> WeatherData {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        components.queryItems = [
            URLQueryItem(name: "latitude", value: String(latitude)),
            URLQueryItem(name: "longitude", value: String(longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation"),
            URLQueryItem(name: "daily", value: "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max,weather_code"),
            URLQueryItem(name: "forecast_days", value: "6"),
            URLQueryItem(name: "timezone", value: "auto"),
        ]
        guard let url = components.url else { throw WeatherServiceError.invalidResponse }

        let data: Data
        do {
            (data, _) = try await URLSession.shared.data(from: url)
        } catch {
            throw WeatherServiceError.unreachable
        }

        guard let raw = try? JSONDecoder().decode(OpenMeteoResponse.self, from: data) else {
            throw WeatherServiceError.invalidResponse
        }

        let days: [WeatherData.DayForecast] = (raw.daily?.time ?? []).enumerated().map { index, date in
            WeatherData.DayForecast(
                date: date,
                minCelsius: raw.daily?.temperature2mMin?[safe: index],
                maxCelsius: raw.daily?.temperature2mMax?[safe: index],
                precipitationMm: raw.daily?.precipitationSum?[safe: index],
                precipitationProbabilityPercent: raw.daily?.precipitationProbabilityMax?[safe: index],
                uvIndexMax: raw.daily?.uvIndexMax?[safe: index],
                conditionCode: raw.daily?.weatherCode?[safe: index]
            )
        }

        return WeatherData(
            temperatureCelsius: raw.current?.temperature2m ?? 0,
            temperatureMinCelsius: days.first?.minCelsius,
            temperatureMaxCelsius: days.first?.maxCelsius,
            humidityPercent: raw.current?.relativeHumidity2m,
            windSpeedKmh: raw.current?.windSpeed10m,
            precipitationMm: raw.current?.precipitation,
            uvIndex: days.first?.uvIndexMax,
            conditionCode: raw.current?.weatherCode,
            fetchedAt: .now,
            dailyForecast: days
        )
    }

    private struct OpenMeteoResponse: Decodable {
        var current: Current?
        var daily: Daily?

        struct Current: Decodable {
            var temperature2m: Double?
            var relativeHumidity2m: Double?
            var weatherCode: Int?
            var windSpeed10m: Double?
            var precipitation: Double?

            enum CodingKeys: String, CodingKey {
                case temperature2m = "temperature_2m"
                case relativeHumidity2m = "relative_humidity_2m"
                case weatherCode = "weather_code"
                case windSpeed10m = "wind_speed_10m"
                case precipitation
            }
        }

        struct Daily: Decodable {
            var time: [String]?
            var temperature2mMax: [Double]?
            var temperature2mMin: [Double]?
            var precipitationSum: [Double]?
            var precipitationProbabilityMax: [Int]?
            var uvIndexMax: [Double]?
            var weatherCode: [Int]?

            enum CodingKeys: String, CodingKey {
                case time
                case temperature2mMax = "temperature_2m_max"
                case temperature2mMin = "temperature_2m_min"
                case precipitationSum = "precipitation_sum"
                case precipitationProbabilityMax = "precipitation_probability_max"
                case uvIndexMax = "uv_index_max"
                case weatherCode = "weather_code"
            }
        }
    }
}

/// WMO weather codes, as used by Open-Meteo — a stable, documented
/// public code table, not provider-specific despite living next to the
/// Open-Meteo integration.
private enum WeatherCondition {
    static func description(for code: Int?) -> String {
        guard let code else { return "Météo inconnue" }
        switch code {
        case 0: return "Ciel dégagé"
        case 1, 2: return "Peu nuageux"
        case 3: return "Couvert"
        case 45, 48: return "Brouillard"
        case 51, 53, 55: return "Bruine"
        case 56, 57: return "Bruine verglaçante"
        case 61, 63, 65: return "Pluie"
        case 66, 67: return "Pluie verglaçante"
        case 71, 73, 75, 77: return "Neige"
        case 80, 81, 82: return "Averses"
        case 85, 86: return "Averses de neige"
        case 95: return "Orage"
        case 96, 99: return "Orage avec grêle"
        default: return "Météo variable"
        }
    }

    static func symbol(for code: Int?) -> String {
        guard let code else { return "questionmark" }
        switch code {
        case 0: return "sun.max.fill"
        case 1, 2: return "cloud.sun.fill"
        case 3: return "cloud.fill"
        case 45, 48: return "cloud.fog.fill"
        case 51, 53, 55, 56, 57: return "cloud.drizzle.fill"
        case 61, 63, 65, 66, 67: return "cloud.rain.fill"
        case 71, 73, 75, 77: return "cloud.snow.fill"
        case 80, 81, 82: return "cloud.heavyrain.fill"
        case 85, 86: return "cloud.snow.fill"
        case 95, 96, 99: return "cloud.bolt.rain.fill"
        default: return "cloud.fill"
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
