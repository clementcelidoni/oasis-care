import SwiftUI
import SwiftData

struct BulkChangeZoneSheet: View {
    var plants: [Plant]

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @Query(sort: \Garden.name) private var gardens: [Garden]

    @State private var selectedGarden: Garden?
    @State private var selectedZone: GardenZone?

    private var availableZones: [GardenZone] {
        selectedGarden?.zones.sorted { $0.name < $1.name } ?? []
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Jardin", selection: $selectedGarden) {
                        Text("Aucun").tag(Garden?.none)
                        ForEach(gardens) { garden in
                            Text(garden.name).tag(Garden?.some(garden))
                        }
                    }

                    if selectedGarden != nil {
                        Picker("Zone", selection: $selectedZone) {
                            Text("Aucune").tag(GardenZone?.none)
                            ForEach(availableZones) { zone in
                                Text(zone.name).tag(GardenZone?.some(zone))
                            }
                        }
                    }
                } footer: {
                    Text("\(plants.count) \(plants.count > 1 ? "végétaux" : "végétal") déplacé\(plants.count > 1 ? "s" : "").")
                }
            }
            .navigationTitle("Modifier la zone")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
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
        for plant in plants {
            plant.garden?.plants.removeAll { $0.id == plant.id }
            plant.zone?.plants.removeAll { $0.id == plant.id }
            plant.garden = selectedGarden
            plant.zone = selectedZone
            plant.markDirty()
            selectedGarden?.plants.append(plant)
            selectedZone?.plants.append(plant)
        }
        dismiss()
    }
}
