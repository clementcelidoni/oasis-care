import SwiftUI
import SwiftData

/// Spec §54-55 — records one measurement session. Always creates a new
/// entry, never edits an existing one ("Ne jamais écraser les
/// anciennes mesures").
struct TreeMeasurementFormView: View {
    var plant: Plant

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var date = Date.now
    @State private var heightText = ""
    @State private var trunkCircumferenceText = ""
    @State private var trunkDiameterText = ""
    @State private var canopyDiameterText = ""
    @State private var estimatedAgeText = ""
    @State private var notes = ""

    private var isValid: Bool {
        [heightText, trunkCircumferenceText, trunkDiameterText, canopyDiameterText, estimatedAgeText]
            .contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                }

                Section {
                    measurementRow("Hauteur", text: $heightText, unit: "m")
                    measurementRow("Circonférence du tronc", text: $trunkCircumferenceText, unit: "cm")
                    measurementRow("Diamètre du tronc", text: $trunkDiameterText, unit: "cm")
                    measurementRow("Houppier", text: $canopyDiameterText, unit: "m")
                    HStack {
                        Text("Âge estimé")
                        Spacer()
                        TextField("ans", text: $estimatedAgeText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 70)
                        Text("ans")
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Renseignez uniquement ce que vous avez mesuré aujourd'hui.")
                }

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Nouvelle mesure")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(!isValid)
                }
            }
        }
    }

    private func measurementRow(_ title: String, text: Binding<String>, unit: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField(unit, text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 70)
            Text(unit)
                .foregroundStyle(.secondary)
        }
    }

    private func save() {
        let measurement = PlantMeasurement(
            plant: plant,
            date: date,
            height: parsedDouble(heightText),
            trunkCircumference: parsedDouble(trunkCircumferenceText),
            trunkDiameter: parsedDouble(trunkDiameterText),
            canopyDiameter: parsedDouble(canopyDiameterText),
            estimatedAge: Int(estimatedAgeText),
            notes: notes
        )
        modelContext.insert(measurement)
        plant.measurements.append(measurement)
        dismiss()
    }

    private func parsedDouble(_ text: String) -> Double? {
        Double(text.replacingOccurrences(of: ",", with: "."))
    }
}
