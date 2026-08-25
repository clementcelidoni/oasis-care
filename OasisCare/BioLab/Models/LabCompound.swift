import Foundation
import SwiftData

/// Enhancement "BIBLIOTHÈQUE DE COMPOSÉS" §12 categories.
enum LabCompoundCategory: String, Codable, CaseIterable, Identifiable {
    case basalMedium
    case macroElement
    case microElement
    case vitamin
    case sugar
    case auxin
    case cytokinin
    case gibberellin
    case plantGrowthRegulator
    case antioxidant
    case additive
    case gellingAgent
    case buffer
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .basalMedium: return "Milieu de base"
        case .macroElement: return "Macroélément"
        case .microElement: return "Microélément"
        case .vitamin: return "Vitamine"
        case .sugar: return "Sucre"
        case .auxin: return "Auxine"
        case .cytokinin: return "Cytokinine"
        case .gibberellin: return "Gibbérelline"
        case .plantGrowthRegulator: return "Régulateur de croissance"
        case .antioxidant: return "Antioxydant"
        case .additive: return "Additif"
        case .gellingAgent: return "Gélifiant"
        case .buffer: return "Tampon"
        case .other: return "Autre"
        }
    }
}

/// Enhancement §12 — absolute quantity units, distinct from
/// `ConcentrationUnit` (a per-volume rate). `MediaRecipeCalculator`
/// converts a `ConcentrationUnit` amount + a target volume into one of
/// these, never the other way with string parsing.
enum AmountUnit: String, Codable, CaseIterable, Identifiable {
    case gram
    case milligram
    case microgram
    case liter
    case milliliter
    case microliter

    var id: String { rawValue }

    var label: String {
        switch self {
        case .gram: return "g"
        case .milligram: return "mg"
        case .microgram: return "µg"
        case .liter: return "L"
        case .milliliter: return "mL"
        case .microliter: return "µL"
        }
    }

    /// Grams (for mass units) or liters (for volume units) per one unit
    /// of `self` — e.g. `.milligram.baseUnitsPerUnit == 0.001` grams.
    /// `MediaRecipeCalculator` uses this to convert between any two
    /// units of the same kind without a combinatorial case-by-case table.
    var baseUnitsPerUnit: Double {
        switch self {
        case .gram, .liter: return 1
        case .milligram, .milliliter: return 0.001
        case .microgram, .microliter: return 0.000_001
        }
    }

    var isMass: Bool {
        switch self {
        case .gram, .milligram, .microgram: return true
        case .liter, .milliliter, .microliter: return false
        }
    }
}

/// Enhancement "BIBLIOTHÈQUE DE COMPOSÉS" — a reusable, workspace-wide
/// catalog entry for one chemical/product (e.g. "Saccharose", "BAP").
/// `MediumComponentAmount.compoundId` optionally points here when an
/// ingredient was picked from the library rather than typed as free
/// text — free text stays fully supported (spec's own "l'utilisateur
/// peut créer ses propres formulations," and no recipe should ever be
/// blocked on the catalog being incomplete).
///
/// No hard delete once referenced by a recipe: `isHidden` lets a
/// workspace stop offering a compound for NEW recipes ("masquer du
/// catalogue," enhancement's own COMPOSÉS section) without touching any
/// recipe that already names it.
@Model
final class LabCompound: Syncable {
    var id: UUID
    var name: String
    var shortName: String
    var category: LabCompoundCategory
    var molecularWeight: Double?
    var defaultUnit: ConcentrationUnit
    var supplier: String?
    var catalogNumber: String?
    var notes: String
    var isHidden: Bool
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    @Relationship(deleteRule: .nullify, inverse: \StockSolution.compound)
    var stockSolutions: [StockSolution] = []

    @Relationship(deleteRule: .nullify, inverse: \InventoryLot.compound)
    var inventoryLots: [InventoryLot] = []

    init(
        name: String, shortName: String = "", category: LabCompoundCategory, molecularWeight: Double? = nil,
        defaultUnit: ConcentrationUnit = .gramsPerLiter, supplier: String? = nil, catalogNumber: String? = nil, notes: String = ""
    ) {
        self.id = UUID()
        self.name = name
        self.shortName = shortName
        self.category = category
        self.molecularWeight = molecularWeight
        self.defaultUnit = defaultUnit
        self.supplier = supplier
        self.catalogNumber = catalogNumber
        self.notes = notes
        self.isHidden = false
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
