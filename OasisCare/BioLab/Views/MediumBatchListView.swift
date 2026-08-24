import SwiftData
import SwiftUI

/// Spec Phase 7C — "MediumBatch... permet la traçabilité réelle des
/// préparations."
struct MediumBatchListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \MediumBatch.preparedAt, order: .reverse) private var mediumBatches: [MediumBatch]
    @Query(sort: \MediumRecipe.name) private var recipes: [MediumRecipe]

    @State private var isShowingNew = false

    var body: some View {
        Group {
            if mediumBatches.isEmpty {
                EmptyStateView(
                    icon: "flask.fill",
                    title: "Aucune préparation",
                    message: "Enregistrez une préparation de milieu pour tracer exactement quelle version a été utilisée."
                )
            } else {
                List(mediumBatches) { batch in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(batch.code).font(.headline)
                        Text("\(batch.recipeVersion?.recipe?.name ?? "?") V\(batch.recipeVersion?.versionNumber ?? 0) · \(String(format: "%.1f L", batch.volumeLiters)) · \(DateFormatting.shortDate(batch.preparedAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Préparations de milieu")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { isShowingNew = true } label: { Label("Ajouter", systemImage: "plus") }
                    .disabled(recipes.isEmpty)
            }
        }
        .sheet(isPresented: $isShowingNew) {
            MediumBatchFormView(recipes: recipes)
        }
    }
}

private struct MediumBatchFormView: View {
    var recipes: [MediumRecipe]

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var code = ""
    @State private var selectedRecipe: MediumRecipe?
    @State private var selectedVersion: MediumRecipeVersion?
    @State private var volumeText = "5"
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Code (ex. MB-2026-0042)", text: $code)
                    Picker("Recette", selection: $selectedRecipe) {
                        Text("Choisir").tag(MediumRecipe?.none)
                        ForEach(recipes) { recipe in
                            Text(recipe.name).tag(Optional(recipe))
                        }
                    }
                    .onChange(of: selectedRecipe) { _, newValue in
                        selectedVersion = newValue?.latestVersion
                    }
                    if let selectedRecipe {
                        Picker("Version", selection: $selectedVersion) {
                            ForEach(selectedRecipe.versions.sorted { $0.versionNumber > $1.versionNumber }) { version in
                                Text("Version \(version.versionNumber)").tag(Optional(version))
                            }
                        }
                    }
                    HStack {
                        Text("Volume")
                        Spacer()
                        TextField("", text: $volumeText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                        Text("L").foregroundStyle(.secondary)
                    }
                }
                Section("Notes") {
                    TextField("Notes (optionnel)", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .navigationTitle("Nouvelle préparation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Créer") { createBatch() }
                        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || selectedVersion == nil)
                }
            }
        }
    }

    private func createBatch() {
        let volume = Double(volumeText.replacingOccurrences(of: ",", with: ".")) ?? 0
        let batch = MediumBatch(code: code, recipeVersion: selectedVersion, volumeLiters: volume, notes: notes)
        modelContext.insert(batch)
        try? modelContext.save()
        dismiss()
    }
}
