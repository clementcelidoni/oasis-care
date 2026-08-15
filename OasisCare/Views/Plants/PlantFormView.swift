import SwiftUI
import SwiftData

struct PlantFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @Query(sort: \Garden.name) private var gardens: [Garden]

    var plant: Plant?

    @State private var customName: String
    @State private var commonName: String
    @State private var scientificName: String
    @State private var type: PlantType
    @State private var isIndoor: Bool
    @State private var notes: String
    @State private var selectedGarden: Garden?
    @State private var selectedZone: GardenZone?

    init(plant: Plant?) {
        self.plant = plant
        _customName = State(initialValue: plant?.customName ?? "")
        _commonName = State(initialValue: plant?.commonName ?? "")
        _scientificName = State(initialValue: plant?.scientificName ?? "")
        _type = State(initialValue: plant?.type ?? .houseplant)
        _isIndoor = State(initialValue: plant?.isIndoor ?? true)
        _notes = State(initialValue: plant?.notes ?? "")
        _selectedGarden = State(initialValue: plant?.garden)
        _selectedZone = State(initialValue: plant?.zone)
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
            }
        }
    }

    private func save() {
        let trimmedName = customName.trimmingCharacters(in: .whitespacesAndNewlines)

        if let plant {
            plant.customName = trimmedName
            plant.commonName = commonName.isEmpty ? nil : commonName
            plant.scientificName = scientificName.isEmpty ? nil : scientificName
            plant.type = type
            plant.isIndoor = isIndoor
            plant.notes = notes
            plant.garden = selectedGarden
            plant.zone = selectedZone
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
        }

        dismiss()
    }
}
