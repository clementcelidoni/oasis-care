import Foundation
import SwiftData

/// Spec §26. Deliberately flat fields covering every condition type
/// rather than a per-type subclass/associated-value enum — this
/// codebase hasn't proven SwiftData handles the latter cleanly, and a
/// flat shape is what AutomationEngine.evaluate(_:context:) and the
/// builder UI both need anyway. Not every field applies to every
/// `type`; unused ones stay nil for a given condition.
@Model
final class AutomationCondition {
    var id: UUID
    var rule: AutomationRule?
    var type: AutomationConditionType
    var order: Int

    /// soilMoistureBelow/Above, temperatureBelow/Above, humidityBelow/
    /// Above (%, °C), rainForecastBelow/Above (mm).
    var numericThreshold: Double?
    /// lastWateringOlderThan (hours).
    var hoursThreshold: Double?
    /// timeBetween — minutes since midnight, local time.
    var timeRangeStartMinutes: Int?
    var timeRangeEndMinutes: Int?
    /// dayOfWeek — Calendar.weekday convention (1 = Sunday...7 = Saturday).
    var daysOfWeek: [Int]
    /// Which sensor a soilMoisture/temperature/humidity condition reads.
    /// Nil means "any sensor of the matching type in the rule's scope"
    /// (aggregated per spec §16's min/max/avg approach).
    var sensor: Sensor?
    /// sensorOnline/deviceOnline target.
    var device: ConnectedDevice?

    init(type: AutomationConditionType, order: Int = 0) {
        self.id = UUID()
        self.type = type
        self.order = order
        self.daysOfWeek = []
    }
}

enum AutomationConditionType: String, Codable, CaseIterable, Identifiable, Hashable {
    case soilMoistureBelow
    case soilMoistureAbove
    case temperatureBelow
    case temperatureAbove
    case humidityBelow
    case humidityAbove
    case rainForecastBelow
    case rainForecastAbove
    case lastWateringOlderThan
    case timeBetween
    case dayOfWeek
    case sensorOnline
    case deviceOnline

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .soilMoistureBelow: return "Humidité sol inférieure à"
        case .soilMoistureAbove: return "Humidité sol supérieure à"
        case .temperatureBelow: return "Température inférieure à"
        case .temperatureAbove: return "Température supérieure à"
        case .humidityBelow: return "Humidité air inférieure à"
        case .humidityAbove: return "Humidité air supérieure à"
        case .rainForecastBelow: return "Pluie prévue inférieure à"
        case .rainForecastAbove: return "Pluie prévue supérieure à"
        case .lastWateringOlderThan: return "Dernier arrosage date de plus de"
        case .timeBetween: return "Heure comprise entre"
        case .dayOfWeek: return "Jour de la semaine"
        case .sensorOnline: return "Capteur en ligne"
        case .deviceOnline: return "Équipement en ligne"
        }
    }

    var usesNumericThreshold: Bool {
        switch self {
        case .soilMoistureBelow, .soilMoistureAbove, .temperatureBelow, .temperatureAbove,
             .humidityBelow, .humidityAbove, .rainForecastBelow, .rainForecastAbove:
            return true
        default: return false
        }
    }

    var usesSensor: Bool {
        switch self {
        case .soilMoistureBelow, .soilMoistureAbove, .temperatureBelow, .temperatureAbove,
             .humidityBelow, .humidityAbove, .sensorOnline:
            return true
        default: return false
        }
    }
}
