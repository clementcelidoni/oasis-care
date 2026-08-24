import Foundation
import SwiftData

/// Spec Phase 7C — "MediumBatch... permet la traçabilité réelle des
/// préparations." A physical preparation of one exact recipe version
/// (e.g. "MB-2026-0042, MS Alocasia V3, 5 L, 24 août"). Which
/// bioreactors it was used in is added in Phase 7D once Bioreactor
/// exists — this model doesn't need to anticipate that link now.
@Model
final class MediumBatch: Syncable {
    var id: UUID
    var code: String
    var volumeLiters: Double
    var preparedAt: Date
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
