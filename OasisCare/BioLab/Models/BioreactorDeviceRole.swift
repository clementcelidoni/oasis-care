import Foundation

/// Spec Phase 7G — "DEVICE MAPPING" / "Actions possibles." Exactly the
/// hardware roles spec's own manual-actions list names (startAirPump,
/// openValve, startLiquidPump, lightOn — each paired with its stop/close/
/// off), matching its device-mapping example verbatim ("Air Pump,
/// Transfer Valve, Light").
enum BioreactorDeviceRole: String, Codable, CaseIterable, Identifiable {
    case airPump
    case valve
    case liquidPump
    case light

    var id: String { rawValue }

    var label: String {
        switch self {
        case .airPump: return "Pompe à air"
        case .valve: return "Vanne de transfert"
        case .liquidPump: return "Pompe à liquide"
        case .light: return "Éclairage"
        }
    }

    var icon: String {
        switch self {
        case .airPump: return "fan.fill"
        case .valve: return "circle.grid.cross"
        case .liquidPump: return "drop.circle.fill"
        case .light: return "lightbulb.fill"
        }
    }

    /// Which ConnectedDevice capability a binding for this role should
    /// be filtered to — same "matchingDeviceCapability" idea SensorType
    /// already uses for its own device picker.
    var matchingCapability: DeviceCapability {
        switch self {
        case .airPump, .liquidPump: return .pump
        case .valve: return .valve
        case .light: return .light
        }
    }
}
