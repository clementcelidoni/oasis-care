import Foundation

/// Spec Phase 6F — GardenMicroclimate's descriptive fields (spec's own
/// example: "Zone piscine, +2,1 °C vs moyenne du jardin, Très
/// ensoleillée, Vent modéré, Sol sec"). Folded onto GardenArea rather
/// than a separate model — the spec's own example describes a
/// microclimate AS a zone's properties, not a distinct entity with its
/// own shape to draw.
enum MicroclimateSunLevel: String, Codable, CaseIterable, Identifiable {
    case veryShaded, shaded, moderate, sunny, verySunny

    var id: String { rawValue }

    var label: String {
        switch self {
        case .veryShaded: return "Très ombragée"
        case .shaded: return "Ombragée"
        case .moderate: return "Modérément ensoleillée"
        case .sunny: return "Ensoleillée"
        case .verySunny: return "Très ensoleillée"
        }
    }
}

enum MicroclimateWindLevel: String, Codable, CaseIterable, Identifiable {
    case calm, light, moderate, strong

    var id: String { rawValue }

    var label: String {
        switch self {
        case .calm: return "Calme"
        case .light: return "Vent léger"
        case .moderate: return "Vent modéré"
        case .strong: return "Vent fort"
        }
    }
}

enum MicroclimateSoilLevel: String, Codable, CaseIterable, Identifiable {
    case wet, moist, normal, dry, veryDry

    var id: String { rawValue }

    var label: String {
        switch self {
        case .wet: return "Sol humide"
        case .moist: return "Sol frais"
        case .normal: return "Sol normal"
        case .dry: return "Sol sec"
        case .veryDry: return "Sol très sec"
        }
    }
}
