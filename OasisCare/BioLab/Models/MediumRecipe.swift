import Foundation
import SwiftData

/// Spec Phase 7C — the named recipe/protocol (e.g. "MS Multiplication
/// Alocasia"). Its actual formulation lives entirely in
/// MediumRecipeVersion — see that model's own doc comment for why
/// versions are immutable once created.
@Model
final class MediumRecipe: Syncable {
    var id: UUID
    var name: String
    var speciesName: String
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \MediumRecipeVersion.recipe)
    var versions: [MediumRecipeVersion] = []

    init(name: String, speciesName: String = "", notes: String = "") {
        self.id = UUID()
        self.name = name
        self.speciesName = speciesName
        self.notes = notes
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var latestVersion: MediumRecipeVersion? {
        versions.max { $0.versionNumber < $1.versionNumber }
    }
}
