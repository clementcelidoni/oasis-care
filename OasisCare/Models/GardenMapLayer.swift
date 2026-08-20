import SwiftUI

/// Spec Phase 6E — "créer un vrai système : GardenMapLayer." Purely a
/// visibility switch over data that already exists elsewhere (objects,
/// areas, pipes, sensors, plants) — not persisted itself, since there's
/// nothing to store beyond "is this layer currently shown," which is
/// per-session UI state on GardenMapEngine, not garden data.
enum GardenMapLayer: String, CaseIterable, Identifiable, Codable {
    case vegetation, canopies, irrigation, sensorsLayer, devices, constructions, amenities
    case health, soilMoisture, temperature, waterConsumption, alerts, interventions, qrNfc
    /// Spec Phase 6L — "Ajouter facultativement un calque : Biodiversité."
    case biodiversity
    /// Spec Phase 6A — "GeographicMap: fond géographique" behind the
    /// vector plan, not just a separate alternative mode. A real
    /// MapKit satellite/hybrid snapshot drawn as OasisPlanView's
    /// bottom-most layer.
    case satelliteBackground

    var id: String { rawValue }

    var label: String {
        switch self {
        case .vegetation: return "Végétaux"
        case .canopies: return "Houppiers"
        case .irrigation: return "Irrigation"
        case .sensorsLayer: return "Capteurs"
        case .devices: return "Appareils"
        case .constructions: return "Constructions"
        case .amenities: return "Aménagements"
        case .health: return "Santé"
        case .soilMoisture: return "Humidité du sol"
        case .temperature: return "Température"
        case .waterConsumption: return "Consommation d'eau"
        case .alerts: return "Alertes"
        case .interventions: return "Interventions"
        case .qrNfc: return "QR/NFC"
        case .biodiversity: return "Biodiversité"
        case .satelliteBackground: return "Fond satellite"
        }
    }

    var icon: String {
        switch self {
        case .vegetation: return "leaf.fill"
        case .canopies: return "tree.fill"
        case .irrigation: return "drop.fill"
        case .sensorsLayer: return "antenna.radiowaves.left.and.right"
        case .devices: return "poweroutlet.type.b.fill"
        case .constructions: return "house.fill"
        case .amenities: return "sparkles"
        case .health: return "heart.text.square.fill"
        case .soilMoisture: return "humidity.fill"
        case .temperature: return "thermometer"
        case .waterConsumption: return "gauge.with.dots.needle.50percent"
        case .alerts: return "exclamationmark.triangle.fill"
        case .interventions: return "checklist"
        case .qrNfc: return "qrcode"
        case .biodiversity: return "ladybug.fill"
        case .satelliteBackground: return "globe.americas.fill"
        }
    }

    /// Spec: "permettre pour certains calques : opacité" — the ones
    /// that render as an area fill rather than discrete markers are the
    /// ones opacity actually does something useful for.
    var supportsOpacity: Bool {
        switch self {
        case .soilMoisture, .temperature, .health, .satelliteBackground: return true
        default: return false
        }
    }

    /// Which GardenObjectType cases this layer gates — used by
    /// OasisPlanView's object-rendering filter. Layers that aren't
    /// object-type-based (heatmaps, alerts...) return an empty set and
    /// are gated some other way instead.
    var gatedObjectTypes: Set<GardenObjectType> {
        switch self {
        case .vegetation: return [.plant, .tree, .palm, .shrub]
        case .irrigation: return [.waterSource, .valve, .pump, .filter, .sprinkler, .dripEmitter]
        case .sensorsLayer: return [.sensor]
        case .devices: return [.light, .electricalPoint]
        case .constructions: return [.house, .wall, .fence, .stairs]
        case .amenities: return [.terrace, .pool, .pond, .greenhouse, .path, .rock, .decorativeObject, .custom]
        case .biodiversity: return [.birdhouse, .insectHotel, .wildlifeWaterPoint, .pollinatorZone, .wildlifeRefuge]
        default: return []
        }
    }
}

/// Spec Phase 6E — "profils de calques" presets. Each maps to the exact
/// set of layers that mode cares about, so switching profiles is one
/// tap instead of manually toggling ~14 switches.
enum GardenMapLayerProfile: String, CaseIterable, Identifiable {
    case normal, watering, health, technical, sensors

    var id: String { rawValue }

    var label: String {
        switch self {
        case .normal: return "Vue normale"
        case .watering: return "Arrosage"
        case .health: return "Santé"
        case .technical: return "Technique"
        case .sensors: return "Capteurs"
        }
    }

    var layers: Set<GardenMapLayer> {
        switch self {
        case .normal:
            return [.vegetation, .canopies, .constructions, .amenities]
        case .watering:
            return [.vegetation, .irrigation, .waterConsumption]
        case .health:
            return [.vegetation, .canopies, .health, .alerts]
        case .technical:
            return [.irrigation, .devices, .sensorsLayer, .constructions]
        case .sensors:
            return [.sensorsLayer, .soilMoisture, .temperature]
        }
    }
}
