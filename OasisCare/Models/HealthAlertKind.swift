import Foundation

/// Spec §61/§63 — the things DeviceHealthService looks for: six device/
/// sensor health checks (§61) plus unusual-trend detection (§63), kept
/// in one enum since both feed the same alert/notification pipeline.
enum HealthAlertKind: String {
    case deviceOffline
    case stuckValue
    case impossibleValue
    case incoherentFlow
    case staleSensor
    case abnormalConsumption
    case unusualTrend

    var displayName: String {
        switch self {
        case .deviceOffline: return "Appareil hors ligne"
        case .stuckValue: return "Valeur bloquée"
        case .impossibleValue: return "Valeur impossible"
        case .incoherentFlow: return "Débit incohérent"
        case .staleSensor: return "Capteur sans mise à jour"
        case .abnormalConsumption: return "Consommation anormale"
        case .unusualTrend: return "Tendance inhabituelle"
        }
    }

    var icon: String {
        switch self {
        case .deviceOffline: return "wifi.slash"
        case .stuckValue: return "pause.circle.fill"
        case .impossibleValue: return "exclamationmark.triangle.fill"
        case .incoherentFlow: return "drop.triangle.fill"
        case .staleSensor: return "clock.badge.exclamationmark.fill"
        case .abnormalConsumption: return "bolt.trianglebadge.exclamationmark.fill"
        case .unusualTrend: return "chart.line.downtrend.xyaxis"
        }
    }
}
