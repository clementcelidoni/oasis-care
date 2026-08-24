import Foundation

/// Spec §59-60 — the event types that can be superimposed on a sensor's
/// history graph. Which of these actually apply to a given sensor
/// depends on which greenhouse/irrigation zone (if any) uses that sensor
/// as one of its designated readings — see GraphAggregationService.
enum EventOverlayKind: String, CaseIterable, Identifiable {
    case irrigation
    case ventilation
    case heating
    case misting
    /// Spec Phase 7F — "afficher les immersions et aérations sur les
    /// graphiques."
    case immersion
    case aeration

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .irrigation: return "Arrosage"
        case .ventilation: return "Ventilation"
        case .heating: return "Chauffage"
        case .misting: return "Brumisation"
        case .immersion: return "Immersion"
        case .aeration: return "Aération"
        }
    }

    var icon: String {
        switch self {
        case .irrigation: return "drop.fill"
        case .ventilation: return "fan.fill"
        case .heating: return "flame.fill"
        case .misting: return "aqi.medium"
        case .immersion: return "drop.circle.fill"
        case .aeration: return "wind"
        }
    }
}
