import Foundation

/// How a Sensor's readings actually get recorded.
enum SensorSource: String, Codable, CaseIterable, Identifiable {
    /// Readings come from an associated ConnectedDevice's characteristic.
    case device
    /// The user types a value in by hand — the only option for sensor
    /// types HomeKit's standard catalog doesn't cover (soil moisture,
    /// pH, conductivity...).
    case manual
    /// Reserved for a future non-HomeKit data source.
    case api

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .device: return "Équipement connecté"
        case .manual: return "Saisie manuelle"
        case .api: return "API"
        }
    }
}
