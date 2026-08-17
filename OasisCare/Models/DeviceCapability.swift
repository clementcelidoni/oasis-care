import Foundation

/// Spec §10 — what a ConnectedDevice can do. A single accessory can expose
/// several (e.g. a combined soil probe reports both soilMoisture and
/// soilTemperature), hence `ConnectedDevice.capabilities: [DeviceCapability]`
/// rather than one capability per device.
enum DeviceCapability: String, Codable, CaseIterable, Identifiable, Hashable {
    case temperatureSensor
    case humiditySensor
    case soilMoistureSensor
    case soilTemperatureSensor
    case lightSensor
    case rainSensor
    case waterLevelSensor
    case flowSensor
    case valve
    case pump
    case switchDevice
    case light
    case heater
    case fan
    case mister
    case uvSterilizer
    case filter
    case energyMeter
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .temperatureSensor: return "Capteur de température"
        case .humiditySensor: return "Capteur d'humidité"
        case .soilMoistureSensor: return "Capteur d'humidité du sol"
        case .soilTemperatureSensor: return "Capteur de température du sol"
        case .lightSensor: return "Capteur de luminosité"
        case .rainSensor: return "Pluviomètre"
        case .waterLevelSensor: return "Capteur de niveau d'eau"
        case .flowSensor: return "Capteur de débit"
        case .valve: return "Vanne"
        case .pump: return "Pompe"
        case .switchDevice: return "Interrupteur"
        case .light: return "Éclairage"
        case .heater: return "Chauffage"
        case .fan: return "Ventilation"
        case .mister: return "Brumisation"
        case .uvSterilizer: return "Stérilisateur UV"
        case .filter: return "Filtration"
        case .energyMeter: return "Compteur d'énergie"
        case .other: return "Autre"
        }
    }

    var icon: String {
        switch self {
        case .temperatureSensor: return "thermometer"
        case .humiditySensor: return "humidity.fill"
        case .soilMoistureSensor: return "drop.fill"
        case .soilTemperatureSensor: return "thermometer.medium"
        case .lightSensor: return "sun.max.fill"
        case .rainSensor: return "cloud.rain.fill"
        case .waterLevelSensor: return "water.waves"
        case .flowSensor: return "gauge.with.dots.needle.50percent"
        case .valve: return "spigot.fill"
        case .pump: return "arrow.triangle.2.circlepath.circle.fill"
        case .switchDevice: return "switch.2"
        case .light: return "lightbulb.fill"
        case .heater: return "flame.fill"
        case .fan: return "fan.fill"
        case .mister: return "aqi.medium"
        case .uvSterilizer: return "sun.dust.fill"
        case .filter: return "line.3.horizontal.decrease.circle.fill"
        case .energyMeter: return "bolt.fill"
        case .other: return "questionmark.circle.fill"
        }
    }

    /// Whether commands to this capability physically act on the world
    /// (vs. only reporting readings) — used to decide whether
    /// DeviceCommandService's guard rails and Emergency Stop apply.
    var isActuator: Bool {
        switch self {
        case .valve, .pump, .switchDevice, .light, .heater, .fan, .mister, .uvSterilizer, .filter:
            return true
        case .temperatureSensor, .humiditySensor, .soilMoistureSensor, .soilTemperatureSensor,
             .lightSensor, .rainSensor, .waterLevelSensor, .flowSensor, .energyMeter, .other:
            return false
        }
    }
}
