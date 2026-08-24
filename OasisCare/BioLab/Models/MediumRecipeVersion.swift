import Foundation
import SwiftData

/// Spec Phase 7C — "CRITIQUE: une recette utilisée dans un ancien lot
/// ne doit jamais changer rétroactivement." Enforced by convention, the
/// same way CareEvent/PlantPhoto are append-only elsewhere in this app:
/// there is no "edit version" UI anywhere in BioLab, only "create a new
/// version." A CultureBatch references one exact
/// MediumRecipeVersion.id, so as long as this model's fields are never
/// mutated after creation, that reference always reflects precisely
/// what the batch actually used, no matter how many newer versions the
/// parent recipe later gains.
///
/// `targetPH` vs `measuredPH`: spec's own "ne pas confondre cible et
/// mesure réelle" — targetPH is Saisie utilisateur (the protocol's
/// goal), measuredPH is Mesurée only when someone actually recorded a
/// real reading of a prepared batch, never inferred from the target.
@Model
final class MediumRecipeVersion: Syncable {
    var id: UUID
    var versionNumber: Int
    var targetPH: Double
    var measuredPH: Double?
    var components: [MediumComponentAmount]
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var recipe: MediumRecipe?

    /// Spec's "QR / NFC" section — "recette imprimée." Points at one
    /// exact, immutable version, same reasoning as CultureBatch's own
    /// mediumRecipeVersion: a tag printed today must keep meaning
    /// exactly what it said today even after the recipe gains newer
    /// versions.
    @Relationship(deleteRule: .cascade, inverse: \SmartTag.mediumRecipeVersion)
    var smartTags: [SmartTag] = []

    init(recipe: MediumRecipe?, versionNumber: Int, targetPH: Double, components: [MediumComponentAmount], notes: String = "") {
        self.id = UUID()
        self.recipe = recipe
        self.versionNumber = versionNumber
        self.targetPH = targetPH
        self.components = components
        self.notes = notes
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
