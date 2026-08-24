import SwiftData
import SwiftUI

/// Spec Phase 7C — always creates a brand new MediumRecipeVersion, even
/// when editing "the same" recipe again — there is no path in this
/// screen that mutates an existing version (see that model's doc
/// comment on why).
struct MediumRecipeVersionFormView: View {
    var recipe: MediumRecipe

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var targetPHText = "5.8"
    @State private var notes = ""
    @State private var components: [MediumComponentAmount] = []

    var body: some View {
        NavigationStack {
            Form {
                Section("pH") {
                    HStack {
                        Text("pH cible")
                        Spacer()
                        TextField("", text: $targetPHText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                    }
                }

                Section("Composants") {
                    ForEach($components) { $component in
                        ComponentRow(component: $component)
                    }
                    .onDelete { components.remove(atOffsets: $0) }
                    Button("Ajouter un composant") {
                        components.append(MediumComponentAmount(type: .basalMedium, name: "", amount: 0, unit: .milligramsPerLiter))
                    }
                }

                Section("Notes") {
                    TextField("Notes (optionnel)", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .navigationTitle("Nouvelle version")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Créer") { createVersion() }
                        .disabled(Double(targetPHText.replacingOccurrences(of: ",", with: ".")) == nil)
                }
            }
        }
    }

    private func createVersion() {
        let targetPH = Double(targetPHText.replacingOccurrences(of: ",", with: ".")) ?? 5.8
        let validComponents = components.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
        _ = MediumRecipeService.createNewVersion(for: recipe, targetPH: targetPH, components: validComponents, notes: notes, context: modelContext)
        dismiss()
    }
}

private struct ComponentRow: View {
    @Binding var component: MediumComponentAmount

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Type", selection: $component.type) {
                ForEach(MediumComponentType.allCases) { type in
                    Text(type.label).tag(type)
                }
            }
            TextField("Nom (ex. BA, Saccharose, MS basal)", text: $component.name)
            HStack {
                TextField("Quantité", value: $component.amount, format: .number)
                    .keyboardType(.decimalPad)
                Picker("Unité", selection: $component.unit) {
                    ForEach(ConcentrationUnit.allCases) { unit in
                        Text(unit.label).tag(unit)
                    }
                }
                .pickerStyle(.menu)
            }
            if component.type == .plantGrowthRegulator {
                Picker("Catégorie", selection: $component.pgrCategory) {
                    Text("Non précisé").tag(PlantGrowthRegulatorCategory?.none)
                    ForEach(PlantGrowthRegulatorCategory.allCases) { category in
                        Text(category.label).tag(Optional(category))
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}
