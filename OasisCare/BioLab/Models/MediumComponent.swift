import Foundation

/// Spec Phase 7C — "Les composants doivent être structurés." Plain
/// Codable value types stored directly as an array on
/// MediumRecipeVersion (same pattern as GardenArea.points in Phase 6C)
/// rather than a separate @Model + relationship: a recipe version's
/// component list is always read/written as one whole, never queried
/// independently across recipes, so a full relationship would add
/// nothing but sync/consistency overhead.
enum MediumComponentType: String, Codable, CaseIterable, Identifiable {
    case basalMedium
    case sugar
    case plantGrowthRegulator
    case vitamin
    case additive
    case gellingAgent
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .basalMedium: return "Milieu de base"
        case .sugar: return "Sucre"
        case .plantGrowthRegulator: return "Régulateur de croissance"
        case .vitamin: return "Vitamine"
        case .additive: return "Additif"
        case .gellingAgent: return "Gélifiant"
        case .other: return "Autre"
        }
    }
}

/// "HORMONES / PGR... ne pas coder uniquement BA/NAA. Prévoir un modèle
/// générique." Categorizes a component whose type is
/// `.plantGrowthRegulator` — nil for every other component type.
enum PlantGrowthRegulatorCategory: String, Codable, CaseIterable, Identifiable {
    case cytokinin
    case auxin
    case gibberellin
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .cytokinin: return "Cytokinine"
        case .auxin: return "Auxine"
        case .gibberellin: return "Gibbérelline"
        case .other: return "Autre"
        }
    }
}

/// "UNITÉS... utiliser des unités structurées, éviter les chaînes
/// libres partout."
enum ConcentrationUnit: String, Codable, CaseIterable, Identifiable {
    case milligramsPerLiter
    case gramsPerLiter
    case millilitersPerLiter
    case micromolar

    var id: String { rawValue }

    var label: String {
        switch self {
        case .milligramsPerLiter: return "mg/L"
        case .gramsPerLiter: return "g/L"
        case .millilitersPerLiter: return "mL/L"
        case .micromolar: return "µM"
        }
    }
}

struct MediumComponentAmount: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var type: MediumComponentType
    var name: String
    var amount: Double
    var unit: ConcentrationUnit
    var pgrCategory: PlantGrowthRegulatorCategory?
}
