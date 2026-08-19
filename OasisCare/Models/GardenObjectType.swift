import Foundation

/// Spec Phase 6C — the fixed catalogue of things a GardenMapObject can
/// represent. Default footprints are sensible starting sizes the user
/// adjusts after placing, not measured values — real dimensions come
/// from the object's own width/height once placed (spec's own "ne
/// jamais inventer une précision... inexistante" applies here too: a
/// default is a starting point, never presented as a measurement).
enum GardenObjectType: String, Codable, CaseIterable, Identifiable {
    case plant, tree, palm, shrub
    case house, wall, fence
    case terrace, pool, pond, greenhouse
    case path, stairs
    case rock, decorativeObject
    case waterSource
    case valve, pump, sensor
    case sprinkler, dripEmitter
    case light, electricalPoint
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .plant: return "Plante"
        case .tree: return "Arbre"
        case .palm: return "Palmier"
        case .shrub: return "Arbuste"
        case .house: return "Maison"
        case .wall: return "Mur"
        case .fence: return "Clôture"
        case .terrace: return "Terrasse"
        case .pool: return "Piscine"
        case .pond: return "Bassin"
        case .greenhouse: return "Serre"
        case .path: return "Allée"
        case .stairs: return "Escalier"
        case .rock: return "Rocher"
        case .decorativeObject: return "Objet décoratif"
        case .waterSource: return "Point d'eau"
        case .valve: return "Vanne"
        case .pump: return "Pompe"
        case .sensor: return "Capteur"
        case .sprinkler: return "Asperseur"
        case .dripEmitter: return "Goutteur"
        case .light: return "Éclairage"
        case .electricalPoint: return "Point électrique"
        case .custom: return "Personnalisé"
        }
    }

    var icon: String {
        switch self {
        case .plant: return "leaf.fill"
        case .tree: return "tree.fill"
        case .palm: return "tree.fill"
        case .shrub: return "leaf.fill"
        case .house: return "house.fill"
        case .wall: return "rectangle.fill"
        case .fence: return "rectangle.split.3x1.fill"
        case .terrace: return "square.grid.3x3.fill"
        case .pool: return "water.waves"
        case .pond: return "drop.fill"
        case .greenhouse: return "house.fill"
        case .path: return "figure.walk"
        case .stairs: return "figure.stairs"
        case .rock: return "circle.fill"
        case .decorativeObject: return "sparkles"
        case .waterSource: return "spigot.fill"
        case .valve: return "spigot.fill"
        case .pump: return "arrow.triangle.2.circlepath.circle.fill"
        case .sensor: return "antenna.radiowaves.left.and.right"
        case .sprinkler: return "sprinkler.fill"
        case .dripEmitter: return "drop.circle.fill"
        case .light: return "lightbulb.fill"
        case .electricalPoint: return "bolt.fill"
        case .custom: return "square.dashed"
        }
    }

    /// Spec Phase 6C — "représenter tronc + houppier" and the two-size
    /// toggle apply only to real vegetation, not the whole catalogue.
    var isVegetation: Bool {
        switch self {
        case .plant, .tree, .palm, .shrub: return true
        default: return false
        }
    }

    var defaultWidthMeters: Double {
        switch self {
        case .plant: return 0.4
        case .tree: return 3
        case .palm: return 2.5
        case .shrub: return 1
        case .house: return 8
        case .wall, .fence: return 2
        case .terrace: return 4
        case .pool: return 5
        case .pond: return 3
        case .greenhouse: return 4
        case .path: return 1
        case .stairs: return 1.2
        case .rock: return 0.5
        case .decorativeObject: return 0.5
        case .waterSource, .valve, .pump, .sensor: return 0.3
        case .sprinkler, .dripEmitter: return 0.2
        case .light, .electricalPoint: return 0.2
        case .custom: return 1
        }
    }

    var defaultHeightMeters: Double {
        switch self {
        case .wall, .fence, .path: return 0.2
        default: return defaultWidthMeters
        }
    }
}
