import Foundation

/// Spec Phase 6A — the four ways to view a garden's map. Only
/// `.oasisPlan` is the new vector system (OasisPlanView); the other
/// three stay backed by the existing MapKit-based GardenMapView, just
/// switching its map style.
enum GardenMapMode: String, Codable, CaseIterable, Identifiable {
    case oasisPlan
    case standard
    case satellite
    case hybrid

    var id: String { rawValue }

    var label: String {
        switch self {
        case .oasisPlan: return "Plan Oasis"
        case .standard: return "Carte"
        case .satellite: return "Satellite"
        case .hybrid: return "Hybride"
        }
    }

    var icon: String {
        switch self {
        case .oasisPlan: return "square.grid.3x3.topleft.filled"
        case .standard: return "map"
        case .satellite: return "globe.americas.fill"
        case .hybrid: return "map.fill"
        }
    }
}
