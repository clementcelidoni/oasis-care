import SwiftData
import SwiftUI

/// Spec Phase 7C.
struct MediumRecipeListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \MediumRecipe.name) private var recipes: [MediumRecipe]

    @State private var isShowingNewRecipe = false
    @State private var newRecipeName = ""
    @State private var newRecipeSpecies = ""

    var body: some View {
        Group {
            if recipes.isEmpty {
                EmptyStateView(
                    icon: "testtube.2",
                    title: "Aucune recette",
                    message: "Créez une recette de milieu pour définir un protocole réutilisable et versionné."
                )
            } else {
                List {
                    ForEach(recipes) { recipe in
                        NavigationLink {
                            MediumRecipeDetailView(recipe: recipe)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(recipe.name).font(.headline)
                                Text(recipe.latestVersion.map { "Version \($0.versionNumber) · pH cible \(String(format: "%.1f", $0.targetPH))" } ?? "Aucune version")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Recettes de milieu")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { isShowingNewRecipe = true } label: { Label("Ajouter", systemImage: "plus") }
            }
        }
        .alert("Nouvelle recette", isPresented: $isShowingNewRecipe) {
            TextField("Nom (ex. MS Multiplication Alocasia)", text: $newRecipeName)
            TextField("Espèce (optionnel)", text: $newRecipeSpecies)
            Button("Créer") { createRecipe() }
            Button("Annuler", role: .cancel) { newRecipeName = ""; newRecipeSpecies = "" }
        }
    }

    private func createRecipe() {
        guard !newRecipeName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let recipe = MediumRecipe(name: newRecipeName, speciesName: newRecipeSpecies)
        modelContext.insert(recipe)
        try? modelContext.save()
        newRecipeName = ""
        newRecipeSpecies = ""
    }
}
