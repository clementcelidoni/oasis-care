import SwiftData
import SwiftUI

/// Spec Phase 7L — starting a new acclimatization attempt for a
/// CultureBatch. Editing after creation happens directly on
/// AcclimatizationBatchDetailView (survivor count, status, steps) —
/// this form only covers the one-time starting conditions.
struct AcclimatizationBatchFormView: View {
    var cultureBatch: CultureBatch

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var initialPlantletCount = ""
    @State private var substrate = ""
    @State private var humidityProgram = ""
    @State private var temperature = ""
    @State private var location = ""
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Nombre de plantules")
                        Spacer()
                        TextField("Nombre", text: $initialPlantletCount)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                    }
                    TextField("Substrat", text: $substrate)
                    TextField("Programme d'humidité", text: $humidityProgram)
                    HStack {
                        Text("Température")
                        Spacer()
                        TextField("°C", text: $temperature)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                    }
                    TextField("Emplacement", text: $location)
                }

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .navigationTitle("Nouvelle acclimatation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Démarrer") { save() }
                        .disabled(Int(initialPlantletCount).map { $0 <= 0 } ?? true)
                }
            }
        }
    }

    private func save() {
        guard let count = Int(initialPlantletCount), count > 0 else { return }
        let batch = AcclimatizationBatch(
            cultureBatch: cultureBatch, initialPlantletCount: count, substrate: substrate,
            humidityProgram: humidityProgram, temperature: Double(temperature.replacingOccurrences(of: ",", with: ".")),
            location: location, notes: notes
        )
        modelContext.insert(batch)
        cultureBatch.acclimatizationBatches.append(batch)
        try? modelContext.save()
        dismiss()
    }
}
