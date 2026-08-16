import Foundation

/// Spec §71 — prepared only, no real hardware connection this phase.
enum SensorType: String, Codable, CaseIterable, Identifiable {
    case soilMoisture
    case temperature
    case airHumidity
    case light
    case waterLevel
    case flow
    case rain
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .soilMoisture: return "Humidité du sol"
        case .temperature: return "Température"
        case .airHumidity: return "Humidité de l'air"
        case .light: return "Luminosité"
        case .waterLevel: return "Niveau d'eau"
        case .flow: return "Débit"
        case .rain: return "Pluie"
        case .other: return "Autre"
        }
    }

    var icon: String {
        switch self {
        case .soilMoisture: return "drop.fill"
        case .temperature: return "thermometer"
        case .airHumidity: return "humidity.fill"
        case .light: return "sun.max.fill"
        case .waterLevel: return "water.waves"
        case .flow: return "gauge"
        case .rain: return "cloud.rain.fill"
        case .other: return "questionmark.circle.fill"
        }
    }
}
