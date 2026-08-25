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
/// libres partout." Extended by the Phase 7 enhancement (§12) with the
/// remaining units its own list names (µg/L, M, mM, µL/L) — appended
/// rather than reshuffled, so every recipe version already saved with
/// one of the original 4 cases keeps decoding exactly as before.
enum ConcentrationUnit: String, Codable, CaseIterable, Identifiable {
    case milligramsPerLiter
    case gramsPerLiter
    case millilitersPerLiter
    case micromolar
    case microgramsPerLiter
    case molar
    case millimolar
    case microlitersPerLiter

    var id: String { rawValue }

    var label: String {
        switch self {
        case .milligramsPerLiter: return "mg/L"
        case .gramsPerLiter: return "g/L"
        case .millilitersPerLiter: return "mL/L"
        case .micromolar: return "µM"
        case .microgramsPerLiter: return "µg/L"
        case .molar: return "M"
        case .millimolar: return "mM"
        case .microlitersPerLiter: return "µL/L"
        }
    }

    /// Whether converting this unit to/from an absolute mass or volume
    /// needs a molar mass (true for the three molarity-based units) —
    /// `MediaRecipeCalculator` refuses that conversion outright rather
    /// than guessing when the compound's `molecularWeight` is unknown
    /// (enhancement §13: "NE PAS INVENTER").
    var requiresMolecularWeight: Bool {
        switch self {
        case .micromolar, .molar, .millimolar: return true
        case .milligramsPerLiter, .gramsPerLiter, .millilitersPerLiter, .microgramsPerLiter, .microlitersPerLiter: return false
        }
    }

    var isVolumeBased: Bool {
        switch self {
        case .millilitersPerLiter, .microlitersPerLiter: return true
        case .milligramsPerLiter, .gramsPerLiter, .micromolar, .microgramsPerLiter, .molar, .millimolar: return false
        }
    }
}

/// Enhancement §11 "COMPOSANTS" — extends the existing, already-shipped
/// `MediumComponentAmount` in place rather than introducing a parallel
/// `MediumIngredient` type ("réutiliser... éviter les doublons"):
/// `name`/`amount`/`unit` already are the spec's `displayName`/
/// `targetConcentration`/`concentrationUnit`. Both new fields are
/// optional so every component already saved on an existing recipe
/// version decodes unchanged (`compoundId`/`sourceType` absent → nil).
struct MediumComponentAmount: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var type: MediumComponentType
    var name: String
    var amount: Double
    var unit: ConcentrationUnit
    var pgrCategory: PlantGrowthRegulatorCategory?
    /// Set when this line was picked from the `LabCompound` library
    /// rather than typed as free text.
    var compoundId: UUID?
    /// Enhancement §46 — nil for every component created before this
    /// field existed, since retroactively guessing a provenance would
    /// be its own kind of invention.
    var sourceType: DataProvenance?
}
