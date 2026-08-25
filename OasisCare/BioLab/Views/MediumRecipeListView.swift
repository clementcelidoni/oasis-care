import SwiftData
import SwiftUI

/// Spec Phase 7C.
struct MediumRecipeListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \MediumRecipe.name) private var recipes: [MediumRecipe]

    @State private var isShowingNewRecipe = false
    @State private var newRecipeName = ""
    @State private var newRecipeSpecies = ""
    @State private var recipePendingDeletion: MediumRecipe?

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
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                recipePendingDeletion = recipe
                            } label: {
                                Label("Supprimer", systemImage: "trash")
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
        .confirmationDialog(
            "Supprimer \(recipePendingDeletion?.name ?? "cette recette") ?",
            isPresented: Binding(get: { recipePendingDeletion != nil }, set: { if !$0 { recipePendingDeletion = nil } }),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let recipePendingDeletion { DeletionService.delete(recipePendingDeletion, in: modelContext) }
                recipePendingDeletion = nil
            }
            Button("Annuler", role: .cancel) { recipePendingDeletion = nil }
        } message: {
            Text("Toutes les versions de cette recette seront supprimées. Les lots et préparations qui utilisaient une de ces versions perdront cette référence. Cette action est irréversible.")
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
