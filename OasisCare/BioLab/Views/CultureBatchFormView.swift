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
    @Query private var allRecipeVersions: [MediumRecipeVersion]
    @Query private var allExperiments: [BioLabExperiment]

    @State private var speciesName = ""
    @State private var cultivar = ""
    @State private var explantType = ""
    @State private var cultureSystem: CultureSystem?
    @State private var batchCode = ""
    @State private var motherPlant: Plant?
    @State private var initialCountText = "1"
    @State private var cultureStage: CultureStage = .initiation
    @State private var notes = ""
    @State private var matchedSpeciesProfile: SpeciesProfile?

    @State private var showingRecommendationSheet = false
    @State private var selectedRecommendation: MediaRecommendation?
    @State private var selectedRecommendationPH = ""

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
                    TextField("Cultivar (optionnel)", text: $cultivar)
                    TextField("Type d'explant (optionnel)", text: $explantType)
                    Picker("Système de culture (optionnel)", selection: $cultureSystem) {
                        Text("Non précisé").tag(CultureSystem?.none)
                        ForEach(CultureSystem.allCases) { system in
                            Text(system.label).tag(Optional(system))
                        }
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

                Section("Milieu de culture") {
                    if let selectedRecommendation {
                        LabeledContent("Milieu proposé", value: selectedRecommendation.basalMediumName)
                        HStack {
                            Text("pH cible")
                            Spacer()
                            TextField("", text: $selectedRecommendationPH)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 60)
                        }
                        Button("Retirer cette proposition", role: .destructive) { self.selectedRecommendation = nil }
                    } else {
                        Button {
                            showingRecommendationSheet = true
                        } label: {
                            Label("Proposer un milieu avec Oasis AI", systemImage: "sparkles")
                        }
                        .disabled(speciesName.trimmingCharacters(in: .whitespaces).isEmpty)
                        Text("Une recette sera créée à partir de la proposition retenue, ou choisissez-en une existante après création du lot.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
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
            .sheet(isPresented: $showingRecommendationSheet) {
                MediaRecommendationSheet(request: buildRecommendationRequest()) { recommendation in
                    selectedRecommendation = recommendation
                    selectedRecommendationPH = recommendation.targetPH.map { String(format: "%.2f", $0) } ?? ""
                }
            }
        }
    }

    private func buildRecommendationRequest() -> MediaRecommendationRequest {
        SmartMediaService.buildRequest(
            speciesName: speciesName, cultivar: cultivar.isEmpty ? nil : cultivar, explantType: explantType.isEmpty ? nil : explantType,
            cultureStage: cultureStage, cultureSystem: cultureSystem, priorVersions: allRecipeVersions,
            priorExperiments: allExperiments, priorBatches: existingBatches
        )
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
        batch.cultivar = cultivar.isEmpty ? nil : cultivar
        batch.explantType = explantType.isEmpty ? nil : explantType
        batch.cultureSystem = cultureSystem
        modelContext.insert(batch)

        // §9 "Utiliser cette recette" — only materializes into a real
        // recipe when a real, user-confirmed pH is present; a
        // recommendation with a blank/invalid pH field is silently not
        // applied rather than saved with an invented value.
        if let selectedRecommendation, let targetPH = Double(selectedRecommendationPH) {
            let recipe = MediumRecipe(name: "\(speciesName) — \(selectedRecommendation.basalMediumName)", speciesName: speciesName)
            modelContext.insert(recipe)
            let version = MediumRecipeVersion(
                recipe: recipe, versionNumber: 1, targetPH: targetPH,
                components: selectedRecommendation.ingredients.map { $0.toMediumComponentAmount() }
            )
            modelContext.insert(version)
            batch.mediumRecipeVersion = version
        }

        try? modelContext.save()
        dismiss()
    }
}
