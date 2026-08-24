import SwiftData
import SwiftUI

/// Spec Phase 7B — creation only. batchCode starts as a suggested
/// default (see CultureBatchService.suggestedBatchCode) but stays a
/// plain, editable text field — never presented as a guaranteed-unique
/// cloud identifier.
struct CultureBatchFormView: View {
    var existingBatches: [CultureBatch]

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @Query(filter: #Predicate<Plant> { !$0.isArchived }, sort: \Plant.customName) private var plants: [Plant]

    @State private var speciesName = ""
    @State private var batchCode = ""
    @State private var motherPlant: Plant?
    @State private var initialCountText = "1"
    @State private var cultureStage: CultureStage = .initiation
    @State private var notes = ""
    @State private var matchedSpeciesProfile: SpeciesProfile?

    var body: some View {
        NavigationStack {
            Form {
                Section("Espèce") {
                    TextField("ex. Alocasia Frydek", text: $speciesName)
                        .onChange(of: speciesName) { _, newValue in
                            lookupSpeciesProfile(newValue)
                            guard batchCode.isEmpty || batchCode == suggestedCode else { return }
                            batchCode = CultureBatchService.suggestedBatchCode(speciesName: newValue, existingBatches: existingBatches)
                        }
                    if let matchedSpeciesProfile, let payload = matchedSpeciesProfile.decodedPayload() {
                        Label("Profil trouvé : \(payload.commonName ?? matchedSpeciesProfile.scientificName)", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.caption)
                    }
                    Picker("Plante mère (optionnel)", selection: $motherPlant) {
                        Text("Aucune").tag(Plant?.none)
                        ForEach(plants) { plant in
                            Text(plant.customName).tag(Optional(plant))
                        }
                    }
                }

                Section {
                    TextField("Code du lot", text: $batchCode)
                    Picker("Stade", selection: $cultureStage) {
                        ForEach(CultureStage.allCases) { stage in
                            Text(stage.label).tag(stage)
                        }
                    }
                    HStack {
                        Text("Nombre d'explants initial")
                        Spacer()
                        TextField("", text: $initialCountText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                    }
                } footer: {
                    Text("Le code est généré automatiquement à partir de l'espèce — modifiable librement.")
                }

                Section("Notes") {
                    TextField("Notes (optionnel)", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .navigationTitle("Nouveau lot")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Créer") { createBatch() }
                        .disabled(speciesName.trimmingCharacters(in: .whitespaces).isEmpty || batchCode.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private var suggestedCode: String {
        CultureBatchService.suggestedBatchCode(speciesName: speciesName, existingBatches: existingBatches)
    }

    /// Same lookup as WhereToPlantSheet (Phase 6H): a locally-cached,
    /// cross-user SpeciesProfile is a nice-to-have enrichment when one
    /// already exists for this name — never required to create a batch.
    private func lookupSpeciesProfile(_ name: String) {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else {
            matchedSpeciesProfile = nil
            return
        }
        let normalized = SpeciesProfile.normalize(name)
        let descriptor = FetchDescriptor<SpeciesProfile>(predicate: #Predicate<SpeciesProfile> { $0.normalizedName == normalized })
        matchedSpeciesProfile = try? modelContext.fetch(descriptor).first
    }

    private func createBatch() {
        let count = max(Int(initialCountText) ?? 1, 1)
        let batch = CultureBatch(
            batchCode: batchCode,
            speciesName: speciesName,
            cultureStage: cultureStage,
            initialExplantCount: count,
            motherPlant: motherPlant,
            speciesProfile: matchedSpeciesProfile,
            notes: notes
        )
        modelContext.insert(batch)
        try? modelContext.save()
        dismiss()
    }
}
