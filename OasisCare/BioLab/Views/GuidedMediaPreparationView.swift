import SwiftData
import SwiftUI

/// Enhancement "PRÉPARATION GUIDÉE" §16-19. One screen rather than a
/// literal multi-page wizard (same "keep it as simple as the content
/// actually needs" call as LabDigitalTwinView not reusing the garden
/// engine) — the steps spec's own §16 lists are illustrative UX
/// checkpoints, not a fixed sequence that has to be paged through one
/// at a time; what actually matters (and IS built here) is capturing a
/// real target-vs-actual per ingredient and never silently inventing a
/// preparation step the chosen recipe doesn't call for.
struct GuidedMediaPreparationView: View {
    var version: MediumRecipeVersion

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var code = ""
    @State private var targetVolumeText = "1"
    @State private var preparedBy = ""
    @State private var measuredPHText = ""
    @State private var actualAmounts: [UUID: String] = [:]
    @State private var notes = ""

    private var targetVolumeLiters: Double {
        Double(targetVolumeText.replacingOccurrences(of: ",", with: ".")) ?? 0
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Code (ex. MB-2026-0042)", text: $code)
                    HStack {
                        Text("Volume cible")
                        Spacer()
                        TextField("", text: $targetVolumeText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                        Text("L").foregroundStyle(.secondary)
                    }
                    TextField("Préparé par (optionnel)", text: $preparedBy)
                } header: {
                    Text("\(version.recipe?.name ?? "Recette") V\(version.versionNumber)")
                }

                Section {
                    ForEach(version.components) { component in
                        ingredientRow(component)
                    }
                } header: {
                    Text("Composants — cible vs réel")
                } footer: {
                    Text("La quantité cible est recalculée automatiquement pour le volume choisi. Modifiez la valeur réelle si elle diffère lors de la pesée.")
                }

                Section("pH") {
                    LabeledContent("pH cible", value: String(format: "%.2f", version.targetPH))
                    HStack {
                        Text("pH mesuré")
                        Spacer()
                        TextField("optionnel", text: $measuredPHText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                    }
                }

                Section("Notes") {
                    TextField("Notes (optionnel)", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .navigationTitle("Préparer ce milieu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Créer") { createBatch() }
                        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || targetVolumeLiters <= 0)
                }
            }
        }
    }

    @ViewBuilder
    private func ingredientRow(_ component: MediumComponentAmount) -> some View {
        let calculated = MediaRecipeCalculator.calculatedAmount(for: component, targetVolumeLiters: targetVolumeLiters, molecularWeight: nil)
        VStack(alignment: .leading, spacing: 4) {
            Text(component.name).fontWeight(.medium)
            switch calculated {
            case .success(let amount):
                HStack {
                    Text("Cible : \(formattedAmount(amount.amount)) \(amount.unit.label)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    TextField("Réel", text: bindingForActual(component.id))
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                    Text(amount.unit.label).font(.caption).foregroundStyle(.secondary)
                }
                if let actual = Double(actualAmounts[component.id] ?? ""), abs(actual - amount.amount) > 0.0001 {
                    Text("Écart enregistré").font(.caption2).foregroundStyle(.orange)
                }
            case .failure:
                Text("Masse molaire du composé inconnue — quantité à calculer manuellement.")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }

    private func bindingForActual(_ id: UUID) -> Binding<String> {
        Binding(get: { actualAmounts[id] ?? "" }, set: { actualAmounts[id] = $0 })
    }

    private func formattedAmount(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", value) : String(format: "%.3g", value)
    }

    private func createBatch() {
        let batch = MediumBatch(code: code, recipeVersion: version, volumeLiters: targetVolumeLiters, notes: notes)
        batch.targetVolumeLiters = targetVolumeLiters
        batch.preparedBy = preparedBy.isEmpty ? nil : preparedBy
        batch.measuredPH = Double(measuredPHText.replacingOccurrences(of: ",", with: "."))

        batch.compoundLots = version.components.compactMap { component -> MediumBatchIngredient? in
            let result = MediaRecipeCalculator.calculatedAmount(for: component, targetVolumeLiters: targetVolumeLiters, molecularWeight: nil)
            guard case .success(let calculated) = result else { return nil }
            let actual = Double((actualAmounts[component.id] ?? "").replacingOccurrences(of: ",", with: "."))
            return MediumBatchIngredient(
                ingredientId: component.id, targetAmount: calculated.amount, actualAmount: actual, amountUnit: calculated.unit
            )
        }

        modelContext.insert(batch)
        try? modelContext.save()
        dismiss()
    }
}
