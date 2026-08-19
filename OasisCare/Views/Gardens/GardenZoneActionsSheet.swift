import SwiftData
import SwiftUI

/// Spec Phase 6I — "action groupée géographique... sélectionner cette
/// zone, puis arrosage groupé / inspection / photo / intervention."
/// Arrosage/inspection/intervention reuse CareScheduleEngine's existing
/// recordCareForMultiple (built in Phase 1 for multi-select bulk
/// actions elsewhere in the app) rather than a new bulk-logging path —
/// one implementation of "log this care event for N plants at once."
/// Photo is a navigation shortcut instead of a bulk log entry: a photo
/// is inherently per-plant (you can't meaningfully "bulk photograph"
/// several plants as one action), so it opens a picker into each
/// plant's own existing photo-capture flow rather than inventing a
/// bulk photo concept that doesn't correspond to anything real.
struct GardenZoneActionsSheet: View {
    var area: GardenArea
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var lastActionMessage: String?
    @State private var photoTargetPlant: Plant?

    private var plants: [Plant] {
        engine.plants(inArea: area)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Zone", value: area.name.isEmpty ? area.areaType.label : area.name)
                    LabeledContent("Végétaux dans la zone", value: "\(plants.count)")
                }

                if plants.isEmpty {
                    Section {
                        Text("Aucun végétal placé dans cette zone n'est associé à une fiche Oasis.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        actionButton(title: "Arrosage groupé", icon: "drop.fill", type: .watering)
                        actionButton(title: "Inspection groupée", icon: "magnifyingglass", type: .inspection)
                        actionButton(title: "Intervention groupée", icon: "wrench.and.screwdriver.fill", type: .custom)
                    }

                    if let lastActionMessage {
                        Section {
                            Label(lastActionMessage, systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                        }
                    }

                    Section("Photo") {
                        ForEach(plants) { plant in
                            Button(plant.customName) {
                                photoTargetPlant = plant
                            }
                        }
                    }
                }
            }
            .navigationTitle("Actions groupées")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .sheet(item: $photoTargetPlant) { plant in
                NavigationStack { PlantDetailView(plant: plant) }
            }
        }
    }

    private func actionButton(title: String, icon: String, type: CareEventType) -> some View {
        Button {
            _ = CareScheduleEngine.recordCareForMultiple(type, plants: plants, in: modelContext)
            lastActionMessage = "\(type.displayName) enregistré pour \(plants.count) \(plants.count > 1 ? "végétaux" : "végétal")."
        } label: {
            Label(title, systemImage: icon)
        }
    }
}
