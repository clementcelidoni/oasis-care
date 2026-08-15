import SwiftUI
import SwiftData

struct PlantListView: View {
    @Query(filter: #Predicate<Plant> { !$0.isArchived }, sort: \Plant.customName)
    private var plants: [Plant]

    @State private var searchText = ""
    @State private var selectedType: PlantType?
    @State private var isPresentingAddPlant = false

    private var filteredPlants: [Plant] {
        plants.filter { plant in
            let matchesType = selectedType == nil || plant.type == selectedType
            let matchesSearch = searchText.isEmpty
                || plant.customName.localizedCaseInsensitiveContains(searchText)
                || (plant.commonName?.localizedCaseInsensitiveContains(searchText) ?? false)
                || (plant.scientificName?.localizedCaseInsensitiveContains(searchText) ?? false)
                || (plant.garden?.name.localizedCaseInsensitiveContains(searchText) ?? false)
                || (plant.zone?.name.localizedCaseInsensitiveContains(searchText) ?? false)
            return matchesType && matchesSearch
        }
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
                    List {
                        ForEach(filteredPlants) { plant in
                            NavigationLink(value: plant) {
                                PlantRow(plant: plant)
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Végétaux")
            .searchable(text: $searchText, prompt: "Nom, espèce, jardin…")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isPresentingAddPlant = true
                    } label: {
                        Label("Ajouter", systemImage: "plus")
                    }
                }
            }
            .navigationDestination(for: Plant.self) { plant in
                PlantDetailView(plant: plant)
            }
            .sheet(isPresented: $isPresentingAddPlant) {
                PlantFormView(plant: nil)
            }
        }
    }
}
