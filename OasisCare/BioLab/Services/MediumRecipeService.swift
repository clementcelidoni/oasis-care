import Foundation
import SwiftData

/// Spec Phase 7C.
enum MediumRecipeService {
    /// The only way a MediumRecipeVersion is ever created — always a
    /// new row, never an edit to an existing one (see that model's own
    /// doc comment on why versions must stay immutable).
    static func createNewVersion(
        for recipe: MediumRecipe, targetPH: Double, components: [MediumComponentAmount], notes: String,
        parentVersion: MediumRecipeVersion? = nil, changeReason: String = "", context: ModelContext
    ) -> MediumRecipeVersion {
        let nextNumber = (recipe.versions.map(\.versionNumber).max() ?? 0) + 1
        let version = MediumRecipeVersion(
            recipe: recipe, versionNumber: nextNumber, targetPH: targetPH, components: components, notes: notes,
            parentVersion: parentVersion, changeReason: changeReason
        )
        context.insert(version)
        recipe.versions.append(version)
        recipe.markDirty()
        try? context.save()
        return version
    }
}
