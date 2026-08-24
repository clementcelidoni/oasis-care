import SwiftData
import SwiftUI

/// Spec Phase 7E — always creates a new BioreactorProgramVersion, never
/// edits an existing one (see that model's own doc comment on why).
struct BioreactorProgramVersionFormView: View {
    var program: BioreactorProgram

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var immersionEnabled = true
    @State private var immersionDurationText = "120"
    @State private var immersionIntervalHoursText = "8"
    @State private var aerationEnabled = true
    @State private var aerationDurationText = "120"
    @State private var aerationIntervalHoursText = "4"
    @State private var targetTemperatureText = "24"
    @State private var maxImmersionMinutesText = "10"
    @State private var maxAerationMinutesText = "10"
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Immersion") {
                    Toggle("Activée", isOn: $immersionEnabled)
                    if immersionEnabled {
                        labeledSecondsField("Durée", text: $immersionDurationText, unit: "s")
                        labeledField("Intervalle", text: $immersionIntervalHoursText, unit: "h")
                    }
                }
                Section("Aération") {
                    Toggle("Activée", isOn: $aerationEnabled)
                    if aerationEnabled {
                        labeledSecondsField("Durée", text: $aerationDurationText, unit: "s")
                        labeledField("Intervalle", text: $aerationIntervalHoursText, unit: "h")
                    }
                }
                Section("Température") {
                    labeledField("Cible (optionnel)", text: $targetTemperatureText, unit: "°C")
                }
                Section {
                    labeledField("Immersion max", text: $maxImmersionMinutesText, unit: "min")
                    labeledField("Aération max", text: $maxAerationMinutesText, unit: "min")
                } header: {
                    Text("Sécurités")
                } footer: {
                    Text("Le système force l'arrêt du cycle si cette durée est dépassée — uniquement lorsque l'application est ouverte. Vérifiez que votre équipement dispose aussi de sa propre sécurité si le cycle est critique.")
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
                }
            }
        }
    }

    private func labeledField(_ title: String, text: Binding<String>, unit: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField("", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 70)
            Text(unit).foregroundStyle(.secondary)
        }
    }

    private func labeledSecondsField(_ title: String, text: Binding<String>, unit: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField("", text: text)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 70)
            Text(unit).foregroundStyle(.secondary)
        }
    }

    private func createVersion() {
        let nextNumber = (program.versions.map(\.versionNumber).max() ?? 0) + 1
        let version = BioreactorProgramVersion(
            program: program, versionNumber: nextNumber,
            immersionEnabled: immersionEnabled,
            immersionDurationSeconds: Int(immersionDurationText) ?? 120,
            immersionIntervalMinutes: (Int(immersionIntervalHoursText) ?? 8) * 60,
            aerationEnabled: aerationEnabled,
            aerationDurationSeconds: Int(aerationDurationText) ?? 120,
            aerationIntervalMinutes: (Int(aerationIntervalHoursText) ?? 4) * 60,
            targetTemperature: Double(targetTemperatureText.replacingOccurrences(of: ",", with: ".")),
            maxImmersionDurationSeconds: (Int(maxImmersionMinutesText) ?? 10) * 60,
            maxAerationDurationSeconds: (Int(maxAerationMinutesText) ?? 10) * 60,
            notes: notes
        )
        modelContext.insert(version)
        program.versions.append(version)
        program.markDirty()
        try? modelContext.save()
        dismiss()
    }
}
