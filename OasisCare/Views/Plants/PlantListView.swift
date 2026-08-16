import SwiftUI
import SwiftData

struct PlantListView: View {
    /// When set, the list is scoped to this garden's plants and starts
    /// pre-selected for bulk action — the entry point from GardenDetailView's
    /// "Sélectionner les plantes à arroser". When nil, this is the normal
    /// Végétaux tab.
    var gardenFilter: Garden?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @Query(filter: #Predicate<Plant> { !$0.isArchived }, sort: \Plant.customName)
    private var plants: [Plant]

    @State private var searchText = ""
    @State private var selectedType: PlantType?
    @State private var isPresentingAddPlant = false
    @State private var editMode: EditMode
    @State private var selectedPlantIDs = Set<UUID>()
    @State private var isBulkAddEventPresented = false
    @State private var isBulkChangeZonePresented = false
    @State private var plantPendingDeletion: Plant?

    private var isFocusedSelectionMode: Bool { gardenFilter != nil }

    init(gardenFilter: Garden? = nil) {
        self.gardenFilter = gardenFilter
        _editMode = State(initialValue: gardenFilter != nil ? .active : .inactive)
    }

    private var filteredPlants: [Plant] {
        plants.filter { plant in
            let matchesGarden = gardenFilter == nil || plant.garden?.id == gardenFilter?.id
            let matchesType = selectedType == nil || plant.type == selectedType
            let matchesSearch = searchText.isEmpty
                || plant.customName.localizedCaseInsensitiveContains(searchText)
                || (plant.commonName?.localizedCaseInsensitiveContains(searchText) ?? false)
                || (plant.scientificName?.localizedCaseInsensitiveContains(searchText) ?? false)
                || (plant.garden?.name.localizedCaseInsensitiveContains(searchText) ?? false)
                || (plant.zone?.name.localizedCaseInsensitiveContains(searchText) ?? false)
            return matchesGarden && matchesType && matchesSearch
        }
    }

    private var selectedPlants: [Plant] {
        filteredPlants.filter { selectedPlantIDs.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if plants.isEmpty {
                    EmptyStateView(
                        icon: "leaf",
                        title: "Aucun végétal",
                        message: "Appuyez sur + pour ajouter votre premier végétal."
                    )
                } else if filteredPlants.isEmpty {
                    EmptyStateView(
                        icon: "magnifyingglass",
                        title: "Aucun résultat",
                        message: "Essayez un autre nom ou une autre catégorie."
                    )
                } else {
                    List(selection: $selectedPlantIDs) {
                        ForEach(filteredPlants) { plant in
                            if editMode.isEditing {
                                PlantRow(plant: plant)
                            } else {
                                NavigationLink(value: plant) {
                                    PlantRow(plant: plant)
                                }
                                .accessibilityIdentifier(plant.customName)
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        plantPendingDeletion = plant
                                    } label: {
                                        Label("Supprimer", systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .environment(\.editMode, $editMode)
                }
            }
            .navigationTitle(gardenFilter?.name ?? "Végétaux")
            .navigationBarTitleDisplayMode(isFocusedSelectionMode ? .inline : .automatic)
            .searchable(text: $searchText, prompt: "Nom, espèce, jardin…")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if isFocusedSelectionMode {
                        Button("Fermer") { dismiss() }
                    } else {
                        Menu {
                            Button("Tous") { selectedType = nil }
                            Divider()
                            ForEach(PlantType.allCases) { type in
                                Button {
                                    selectedType = type
                                } label: {
                                    Label(type.displayName, systemImage: type.icon)
                                }
                            }
                        } label: {
                            Label("Filtrer", systemImage: selectedType == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                        }
                    }
                }
                if !isFocusedSelectionMode {
                    ToolbarItem(placement: .topBarTrailing) {
                        if editMode.isEditing {
                            Button("Terminé") {
                                editMode = .inactive
                                selectedPlantIDs.removeAll()
                            }
                        } else {
                            Button("Sélectionner") { editMode = .active }
                                .accessibilityIdentifier("selectPlantsButton")
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if !editMode.isEditing {
                            Button {
                                isPresentingAddPlant = true
                            } label: {
                                Label("Ajouter", systemImage: "plus")
                            }
                            .accessibilityIdentifier("addPlantButton")
                        }
                    }
                }
            }
            .navigationDestination(for: Plant.self) { plant in
                PlantDetailView(plant: plant)
            }
            .sheet(isPresented: $isPresentingAddPlant) {
                PlantFormView(plant: nil)
            }
            .sheet(isPresented: $isBulkAddEventPresented) {
                AddCareEventSheet(plants: selectedPlants)
            }
            .sheet(isPresented: $isBulkChangeZonePresented) {
                BulkChangeZoneSheet(plants: selectedPlants)
            }
            .onChange(of: isBulkAddEventPresented) { _, isPresented in
                if !isPresented { finishBulkAction() }
            }
            .onChange(of: isBulkChangeZonePresented) { _, isPresented in
                if !isPresented { finishBulkAction() }
            }
            .confirmationDialog(
                "Supprimer \(plantPendingDeletion?.customName ?? "ce végétal") ?",
                isPresented: Binding(
                    get: { plantPendingDeletion != nil },
                    set: { if !$0 { plantPendingDeletion = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Supprimer", role: .destructive) {
                    if let plant = plantPendingDeletion {
                        DeletionService.delete(plant, in: modelContext)
                    }
                    plantPendingDeletion = nil
                }
                Button("Annuler", role: .cancel) {
                    plantPendingDeletion = nil
                }
            } message: {
                Text("Cette action supprimera aussi son historique et ses photos. Cette action est irréversible.")
            }
            .safeAreaInset(edge: .bottom) {
                if editMode.isEditing && !selectedPlantIDs.isEmpty {
                    BulkActionBar(
                        count: selectedPlantIDs.count,
                        onWater: { performBulkCare(.watering) },
                        onFertilize: { performBulkCare(.fertilizing) },
                        onAddIntervention: { isBulkAddEventPresented = true },
                        onChangeZone: { isBulkChangeZonePresented = true }
                    )
                }
            }
        }
    }

    private func performBulkCare(_ type: CareEventType) {
        let plantsToUpdate = selectedPlants
        let result = CareScheduleEngine.recordCareForMultiple(type, plants: plantsToUpdate, in: modelContext)
        Haptics.success()
        let count = plantsToUpdate.count
        ToastCenter.shared.show(
            title: "✓ \(count) plante\(count > 1 ? "s" : "") — \(type.displayName.lowercased())",
            undoAction: result.undo
        )
        finishBulkAction()
    }

    private func finishBulkAction() {
        if isFocusedSelectionMode {
            dismiss()
        } else {
            editMode = .inactive
            selectedPlantIDs.removeAll()
        }
    }
}

private struct BulkActionBar: View {
    var count: Int
    var onWater: () -> Void
    var onFertilize: () -> Void
    var onAddIntervention: () -> Void
    var onChangeZone: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text("\(count) sélectionné\(count > 1 ? "s" : "")")
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                BulkActionButton(title: "Arrosées", icon: "drop.fill", tint: .blue, action: onWater)
                    .accessibilityIdentifier("bulkWaterButton")
                BulkActionButton(title: "Fertilisées", icon: "sparkles", tint: .green, action: onFertilize)
                    .accessibilityIdentifier("bulkFertilizeButton")
                BulkActionButton(title: "Intervention", icon: "plus.circle.fill", tint: .gray, action: onAddIntervention)
                    .accessibilityIdentifier("bulkAddEventButton")
                BulkActionButton(title: "Zone", icon: "map.fill", tint: .purple, action: onChangeZone)
                    .accessibilityIdentifier("bulkChangeZoneButton")
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 4)
        .padding(.horizontal)
        .background(.bar)
    }
}

private struct BulkActionButton: View {
    var title: String
    var icon: String
    var tint: Color
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.body)
                Text(title)
                    .font(.caption2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .foregroundStyle(tint)
        }
        .buttonStyle(.plain)
    }
}
