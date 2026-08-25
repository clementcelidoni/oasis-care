import Foundation
import SwiftData

/// Enhancement §19 "TRAÇABILITÉ LOT MATIÈRE PREMIÈRE" — one physical,
/// received batch of a `LabCompound` (e.g. "MS basal, lot fournisseur
/// ABC123, reçu le 12/08"). Separate from the pre-existing
/// `LabInventoryItem` (general lab consumable stock — gloves, tips,
/// substrate — with a single free-text lot field): a compound used in
/// recipes routinely has several distinct purchased lots over time, and
/// §19 explicitly asks that a recipe ingredient be traceable to the
/// exact one used, which a single string field can't express. Linking
/// this stays optional everywhere (spec: "cela doit rester facultatif").
@Model
final class InventoryLot: Syncable {
    var id: UUID
    var lotNumber: String
    var quantityReceived: Double
    var quantityRemaining: Double
    var unit: AmountUnit
    var receivedAt: Date
    var expiresAt: Date?
    var supplier: String?
    var costTotal: Double?
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var compound: LabCompound?

    init(
        compound: LabCompound?, lotNumber: String, quantityReceived: Double, unit: AmountUnit,
        supplier: String? = nil, expiresAt: Date? = nil, costTotal: Double? = nil, notes: String = ""
    ) {
        self.id = UUID()
        self.compound = compound
        self.lotNumber = lotNumber
        self.quantityReceived = quantityReceived
        self.quantityRemaining = quantityReceived
        self.unit = unit
        self.receivedAt = .now
        self.expiresAt = expiresAt
        self.supplier = supplier
        self.costTotal = costTotal
        self.notes = notes
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var isExpired: Bool {
        guard let expiresAt else { return false }
        return expiresAt < .now
    }

    /// Enhancement's own cost-per-plantule chain (§20) starts from a
    /// per-unit cost, only when both quantity and total cost are known.
    var costPerUnit: Double? {
        guard let costTotal, quantityReceived > 0 else { return nil }
        return costTotal / quantityReceived
    }
}
