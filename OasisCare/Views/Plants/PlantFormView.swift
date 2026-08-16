import SwiftUI
import SwiftData

struct PlantFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var authState = AuthState.shared

    @Query(sort: \Garden.name) private var gardens: [Garden]
    @Query private var existingSpeciesProfiles: [SpeciesProfile]

    var plant: Plant?
    /// Called after a successful save, in addition to dismissing this
    /// view — lets ScannerView/PlantNameSearchView close their own
    /// picker sheet too instead of leaving the user to dismiss twice.
    var onSaved: (() -> Void)?

    @State private var customName: String
    @State private var commonName: String
    @State private var scientificName: String
    @State private var type: PlantType
    @State private var isIndoor: Bool
    @State private var notes: String
    @State private var selectedGarden: Garden?
    @State private var selectedZone: GardenZone?
    @State private var selectedIrrigationZone: IrrigationZone?
    @State private var emitterCountText: String
    @State private var emitterFlowRateText: String

    @State private var isCompletingProfile = false
    @State private var completionError: String?
    @State private var fetchedProfile: SpeciesProfilePayload?
    @State private var fetchedProfileJSON: Data?
    @State private var applySuggestedProgram = true
    @State private var wateringDays: Int?
    @State private var fertilizingDays: Int?
    @State private var rotationDays: Int?
    @State private var isSignInPresented = false

    init(plant: Plant?, initialScientificName: String? = nil, initialCommonName: String? = nil, onSaved: (() -> Void)? = nil) {
        self.plant = plant
        self.onSaved = onSaved
        _customName = State(initialValue: plant?.customName ?? initialCommonName ?? initialScientificName ?? "")
        _commonName = State(initialValue: plant?.commonName ?? initialCommonName ?? "")
        _scientificName = State(initialValue: plant?.scientificName ?? initialScientificName ?? "")
        _type = State(initialValue: plant?.type ?? .houseplant)
        _isIndoor = State(initialValue: plant?.isIndoor ?? true)
        _notes = State(initialValue: plant?.notes ?? "")
        _selectedGarden = State(initialValue: plant?.garden)
        _selectedZone = State(initialValue: plant?.zone)
        _selectedIrrigationZone = State(initialValue: plant?.irrigationZone)
        _emitterCountText = State(initialValue: plant?.emitterCount.map { String($0) } ?? "")
        _emitterFlowRateText = State(initialValue: plant?.emitterFlowRate.map { String($0) } ?? "")
    }

    private var availableZones: [GardenZone] {
        selectedGarden?.zones.sorted { $0.name < $1.name } ?? []
    }

    private var isValid: Bool {
        !customName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identité") {
                    TextField("Nom personnalisé", text: $customName)
                    TextField("Nom commun", text: $commonName)
                    TextField("Nom scientifique", text: $scientificName)
                        .italic()
                }

                if plant == nil {
                    aiCompletionSection
                }

                if let fetchedProfile {
                    Section("Fiche espèce (IA)") {
                        SpeciesProfileSummaryView(payload: fetchedProfile)
                    }
                    if hasSuggestedProgram {
                        suggestedProgramSection
                    }
                }

                Section("Catégorie") {
                    Picker("Type", selection: $type) {
                        ForEach(PlantType.allCases) { type in
                            Label(type.displayName, systemImage: type.icon).tag(type)
                        }
                    }
                    Picker("Emplacement", selection: $isIndoor) {
                        Text("Intérieur").tag(true)
                        Text("Extérieur").tag(false)
                    }
                    .pickerStyle(.segmented)
                }

                Section("Jardin") {
                    Picker("Jardin", selection: $selectedGarden) {
                        Text("Aucun").tag(Garden?.none)
                        ForEach(gardens) { garden in
                            Text(garden.name).tag(Garden?.some(garden))
                        }
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier("gardenPicker")

                    if selectedGarden != nil {
                        Picker("Zone", selection: $selectedZone) {
                            Text("Aucune").tag(GardenZone?.none)
                            ForEach(availableZones) { zone in
                                Text(zone.name).tag(GardenZone?.some(zone))
                            }
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("zonePicker")
                    }
                }

                if let selectedGarden, !selectedGarden.irrigationZones.isEmpty {
                    Section {
                        Picker("Zone d'irrigation", selection: $selectedIrrigationZone) {
                            Text("Aucune").tag(IrrigationZone?.none)
                            ForEach(selectedGarden.irrigationZones.sorted { $0.name < $1.name }) { zone in
                                Text(zone.name).tag(IrrigationZone?.some(zone))
                            }
                        }
                        .pickerStyle(.menu)

                        if selectedIrrigationZone != nil {
                            HStack {
                                Text("Goutteurs")
                                Spacer()
                                TextField("nombre", text: $emitterCountText)
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.trailing)
                                    .frame(width: 60)
                            }
                            HStack {
                                Text("Débit par goutteur")
                                Spacer()
                                TextField("L/h", text: $emitterFlowRateText)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                                    .frame(width: 60)
                                Text("L/h")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text("Irrigation")
                    } footer: {
                        Text("Facultatif — permet d'estimer la consommation d'eau de ce végétal.")
                    }
                }

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(plant == nil ? "Nouveau végétal" : "Modifier")
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
            .onChange(of: selectedGarden) { _, newGarden in
                if let selectedZone, selectedZone.garden != newGarden {
                    self.selectedZone = nil
                }
                if let selectedIrrigationZone, selectedIrrigationZone.garden != newGarden {
                    self.selectedIrrigationZone = nil
                }
            }
            .sheet(isPresented: $isSignInPresented) {
                EmailSignInView()
            }
        }
    }

    // MARK: - AI completion

    private var hasSuggestedProgram: Bool {
        wateringDays != nil || fertilizingDays != nil || rotationDays != nil
    }

    @ViewBuilder
    private var aiCompletionSection: some View {
        Section {
            if isCompletingProfile {
                HStack {
                    ProgressView()
                    Text("Complétion en cours…")
                        .foregroundStyle(.secondary)
                }
            } else if fetchedProfile == nil {
                Button {
                    Task { await completeWithAI() }
                } label: {
                    Label("Compléter avec Oasis AI", systemImage: "sparkles")
                }
                .disabled(scientificName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let completionError {
                Text(completionError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        } footer: {
            if fetchedProfile == nil {
                Text("Renseignez un nom scientifique pour laisser l'IA proposer le reste de la fiche.")
            }
        }
    }

    private var suggestedProgramSection: some View {
        Section {
            Toggle("Appliquer le programme suggéré", isOn: $applySuggestedProgram)
            if applySuggestedProgram {
                if wateringDays != nil {
                    Stepper(
                        "💧 Arrosage : tous les \(wateringDays ?? 7) j",
                        value: Binding(get: { wateringDays ?? 7 }, set: { wateringDays = $0 }),
                        in: 1...90
                    )
                }
                if fertilizingDays != nil {
                    Stepper(
                        "🧪 Fertilisation : tous les \(fertilizingDays ?? 21) j",
                        value: Binding(get: { fertilizingDays ?? 21 }, set: { fertilizingDays = $0 }),
                        in: 1...180
                    )
                }
                if rotationDays != nil {
                    Stepper(
                        "🔄 Rotation : tous les \(rotationDays ?? 14) j",
                        value: Binding(get: { rotationDays ?? 14 }, set: { rotationDays = $0 }),
                        in: 1...90
                    )
                }
            }
        } header: {
            Text("Programme de soins suggéré")
        } footer: {
            Text("Ces rappels pourront être modifiés à tout moment depuis la fiche du végétal.")
        }
    }

    private func completeWithAI() async {
        guard case .authenticated = authState.status else {
            isSignInPresented = true
            return
        }
        isCompletingProfile = true
        completionError = nil
        do {
            let trimmedScientificName = scientificName.trimmingCharacters(in: .whitespacesAndNewlines)
            let result = try await PlantInformationService.complete(scientificName: trimmedScientificName)
            fetchedProfile = result.profile
            fetchedProfileJSON = result.profileJSON
            wateringDays = result.profile.suggestedCareProgram?.wateringFrequencyDays
            fertilizingDays = result.profile.suggestedCareProgram?.fertilizingFrequencyDays
            rotationDays = result.profile.suggestedCareProgram?.rotationFrequencyDays
            if commonName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let aiCommonName = result.profile.commonName {
                commonName = aiCommonName
            }
        } catch {
            completionError = error.localizedDescription
        }
        isCompletingProfile = false
    }

    // MARK: - Save

    private func save() {
        let trimmedName = customName.trimmingCharacters(in: .whitespacesAndNewlines)
        let targetPlant: Plant

        if let plant {
            plant.customName = trimmedName
            plant.commonName = commonName.isEmpty ? nil : commonName
            plant.scientificName = scientificName.isEmpty ? nil : scientificName
            plant.type = type
            plant.isIndoor = isIndoor
            plant.notes = notes
            plant.garden = selectedGarden
            plant.zone = selectedZone
            plant.markDirty()
            targetPlant = plant
        } else {
            let newPlant = Plant(
                customName: trimmedName,
                commonName: commonName.isEmpty ? nil : commonName,
                scientificName: scientificName.isEmpty ? nil : scientificName,
                type: type,
                isIndoor: isIndoor,
                notes: notes,
                garden: selectedGarden,
                zone: selectedZone
            )
            modelContext.insert(newPlant)
            selectedGarden?.plants.append(newPlant)
            selectedZone?.plants.append(newPlant)
            selectedIrrigationZone?.plants.append(newPlant)
            targetPlant = newPlant
        }

        targetPlant.irrigationZone = selectedIrrigationZone
        targetPlant.emitterCount = selectedIrrigationZone != nil ? Int(emitterCountText) : nil
        targetPlant.emitterFlowRate = selectedIrrigationZone != nil
            ? Double(emitterFlowRateText.replacingOccurrences(of: ",", with: "."))
            : nil

        if let fetchedProfile, let fetchedProfileJSON {
            attachSpeciesProfile(fetchedProfile, json: fetchedProfileJSON, to: targetPlant)
            if applySuggestedProgram {
                applySuggestedSchedules(to: targetPlant)
            }
        }

        dismiss()
        onSaved?()
    }

    private func attachSpeciesProfile(_ payload: SpeciesProfilePayload, json: Data, to plant: Plant) {
        let name = payload.scientificName ?? scientificName
        let normalized = SpeciesProfile.normalize(name)

        let profile: SpeciesProfile
        if let existing = existingSpeciesProfiles.first(where: { $0.normalizedName == normalized }) {
            existing.profileJSON = json
            existing.generatedAt = .now
            profile = existing
        } else {
            let newProfile = SpeciesProfile(scientificName: name, normalizedName: normalized, profileJSON: json)
            modelContext.insert(newProfile)
            profile = newProfile
        }
        plant.speciesProfile = profile

        let analysis = AIAnalysis(
            plant: plant,
            type: .profileCompletion,
            summary: "Fiche complétée automatiquement pour \(name).",
            provider: "openai",
            confidence: .unknown
        )
        modelContext.insert(analysis)
    }

    private func applySuggestedSchedules(to plant: Plant) {
        if let wateringDays {
            CareScheduleEngine.setSchedule(.watering, frequencyDays: wateringDays, for: plant, in: modelContext)
        }
        if let fertilizingDays {
            CareScheduleEngine.setSchedule(.fertilizing, frequencyDays: fertilizingDays, for: plant, in: modelContext)
        }
        if let rotationDays {
            CareScheduleEngine.setSchedule(.rotating, frequencyDays: rotationDays, for: plant, in: modelContext)
        }
    }
}
