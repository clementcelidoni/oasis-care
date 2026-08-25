import Foundation
import SwiftData

/// Enhancement §17 "VALEURS RÉELLES" + §19 "TRAÇABILITÉ LOT MATIÈRE
/// PREMIÈRE" — one component's target-vs-actual amount within a real
/// `MediumBatch` preparation. `ingredientId` matches a
/// `MediumComponentAmount.id` from the recipe version actually used, so
/// a deviation can always be traced back to which line it belongs to.
/// `inventoryLotId` stays optional ("cela doit rester facultatif").
struct MediumBatchIngredient: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var ingredientId: UUID
    var targetAmount: Double
    var actualAmount: Double?
    var amountUnit: AmountUnit
    var inventoryLotId: UUID?
}

/// Spec Phase 7C — "MediumBatch... permet la traçabilité réelle des
/// préparations." A physical preparation of one exact recipe version
/// (e.g. "MB-2026-0042, MS Alocasia V3, 5 L, 24 août"). Which
/// bioreactors it was used in is added in Phase 7D once Bioreactor
/// exists — this model doesn't need to anticipate that link now.
@Model
final class MediumBatch: Syncable {
    var id: UUID
    var code: String
    /// Kept as the real, historically-always-actual prepared volume —
    /// never repurposed or renamed, so every batch prepared before the
    /// enhancement's target-vs-actual distinction existed keeps meaning
    /// exactly what it always meant.
    var volumeLiters: Double
    /// Enhancement §10 "VOLUME" — what preparation was originally aimed
    /// for, when that differs from what was actually made. Nil for
    /// every batch that predates this distinction, not backfilled with
    /// a guess.
    var targetVolumeLiters: Double?
    var preparedAt: Date
    /// Enhancement "MEDIUM BATCH COMPLET" field list.
    var preparedBy: String?
    /// The real pH measured for THIS specific preparation — distinct
    /// from `MediumRecipeVersion.measuredPH`, which predates this field
    /// and records a reference reading on the (immutable) recipe
    /// version itself rather than per-preparation.
    var measuredPH: Double?
    /// Enhancement §17/§19 — one entry per recipe component actually
    /// weighed/measured for this preparation.
    var compoundLots: [MediumBatchIngredient] = []
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var recipeVersion: MediumRecipeVersion?

    init(code: String, recipeVersion: MediumRecipeVersion?, volumeLiters: Double, notes: String = "") {
        self.id = UUID()
        self.code = code
        self.recipeVersion = recipeVersion
        self.volumeLiters = volumeLiters
        self.preparedAt = .now
        self.notes = notes
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
