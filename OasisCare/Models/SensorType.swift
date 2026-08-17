import Foundation

/// Spec §12 — expanded from Phase 4's placeholder 8 cases to the full
/// list. Not every case has a native HomeKit service (soil moisture,
/// soil temperature specifically, uv, waterTemperature, waterFlow, ph,
/// conductivity, energyConsumption have no dedicated HAP service type),
/// so `source: .manual` is expected to be common for those until a
/// vendor exposes them some other way.
enum SensorType: String, Codable, CaseIterable, Identifiable {
    case soilMoisture
    case soilTemperature
    case airTemperature
    case airHumidity
    case light
    case uv
    case rain
    case waterTemperature
    case waterLevel
    case waterFlow
    case ph
    case conductivity
    case energyConsumption
    case custom

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .soilMoisture: return "Humidité du sol"
        case .soilTemperature: return "Température du sol"
        case .airTemperature: return "Température de l'air"
        case .airHumidity: return "Humidité de l'air"
        case .light: return "Luminosité"
        case .uv: return "Indice UV"
        case .rain: return "Pluie"
        case .waterTemperature: return "Température de l'eau"
        case .waterLevel: return "Niveau d'eau"
        case .waterFlow: return "Débit d'eau"
        case .ph: return "pH"
        case .conductivity: return "Conductivité"
        case .energyConsumption: return "Consommation électrique"
        case .custom: return "Personnalisé"
        }
    }

    var icon: String {
        switch self {
        case .soilMoisture: return "drop.fill"
        case .soilTemperature: return "thermometer.medium"
        case .airTemperature: return "thermometer"
        case .airHumidity: return "humidity.fill"
        case .light: return "sun.max.fill"
        case .uv: return "sun.dust.fill"
        case .rain: return "cloud.rain.fill"
        case .waterTemperature: return "thermometer.and.liquid.waves.and.rays"
        case .waterLevel: return "water.waves"
        case .waterFlow: return "gauge.with.dots.needle.50percent"
        case .ph: return "eyedropper.halffull"
        case .conductivity: return "bolt.horizontal.fill"
        case .energyConsumption: return "bolt.fill"
        case .custom: return "questionmark.circle.fill"
        }
    }

    var defaultUnit: String {
        switch self {
        case .soilMoisture, .airHumidity: return "%"
        case .soilTemperature, .airTemperature, .waterTemperature: return "°C"
        case .light: return "lux"
        case .uv: return "index"
        case .rain: return "mm"
        case .waterLevel: return "%"
        case .waterFlow: return "L/h"
        case .ph: return "pH"
        case .conductivity: return "µS/cm"
        case .energyConsumption: return "W"
        case .custom: return ""
        }
    }

    /// The DeviceCapability a ConnectedDevice would need for this sensor
    /// type to plausibly come from `source: .device` — used to filter
    /// which linked devices make sense to offer for a given sensor type.
    var matchingDeviceCapability: DeviceCapability? {
        switch self {
        case .soilMoisture: return .soilMoistureSensor
        case .soilTemperature: return .soilTemperatureSensor
        case .airTemperature: return .temperatureSensor
        case .airHumidity: return .humiditySensor
        case .light, .uv: return .lightSensor
        case .rain: return .rainSensor
        case .waterLevel: return .waterLevelSensor
        case .waterFlow: return .flowSensor
        case .energyConsumption: return .energyMeter
        case .waterTemperature, .ph, .conductivity, .custom: return nil
        }
    }
}
