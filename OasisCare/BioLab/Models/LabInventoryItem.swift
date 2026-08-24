import Foundation
import SwiftData

/// Spec "INVENTAIRE DE LABORATOIRE — préparer une gestion simple... ne
/// pas créer encore une gestion comptable complexe." One flat item list
/// with a low-stock threshold, deliberately not a full inventory/
/// accounting system (no locations-within-locations, no unit-cost
/// tracking, no purchase orders) — spec's own explicit scope limit.
enum LabInventoryCategory: String, Codable, CaseIterable, Identifiable {
    case filters
    case tubes
    case vessels
    case consumables
    case media
    case components
    case hormones
    case labels

    var id: String { rawValue }

    var label: String {
        switch self {
        case .filters: return "Filtres"
        case .tubes: return "Tubes"
        case .vessels: return "Bocaux"
        case .consumables: return "Consommables"
        case .media: return "Milieux"
        case .components: return "Composants"
        case .hormones: return "Hormones"
        case .labels: return "Étiquettes"
        }
    }
}

/// Spec "LOTS PRODUITS — pour les composants importants, prévoir
/// supplier/lotNumber/expiryDate si l'utilisateur souhaite les
/// renseigner." All three optional — spec's own "si l'utilisateur
/// souhaite" hedge, never required.
@Model
final class LabInventoryItem: Syncable {
    var id: UUID
    var name: String
    var category: LabInventoryCategory
    var currentQuantity: Int
    var minimumThreshold: Int?
    var unit: String
    var supplier: String?
    var lotNumber: String?
    var expiryDate: Date?
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var isLowStock: Bool {
        guard let minimumThreshold else { return false }
        return currentQuantity <= minimumThreshold
    }

    init(
        name: String, category: LabInventoryCategory, currentQuantity: Int, minimumThreshold: Int? = nil,
        unit: String = "", supplier: String? = nil, lotNumber: String? = nil, expiryDate: Date? = nil, notes: String = ""
    ) {
        self.id = UUID()
        self.name = name
        self.category = category
        self.currentQuantity = currentQuantity
        self.minimumThreshold = minimumThreshold
        self.unit = unit
        self.supplier = supplier
        self.lotNumber = lotNumber
        self.expiryDate = expiryDate
        self.notes = notes
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
