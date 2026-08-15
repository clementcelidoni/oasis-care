import SwiftUI
import SwiftData

struct GardenListView: View {
    @Query(sort: \Garden.name) private var gardens: [Garden]
    @State private var isPresentingAddGarden = false

    var body: some View {
        NavigationStack {
            Group {
                if gardens.isEmpty {
                    EmptyStateView(
                        icon: "map",
                        title: "Aucun jardin",
                        message: "Créez un jardin pour organiser vos végétaux par zones."
                    )
                } else {
                    List {
                        ForEach(gardens) { garden in
                            NavigationLink(value: garden) {
                                GardenRow(garden: garden)
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Jardins")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isPresentingAddGarden = true
                    } label: {
                        Label("Ajouter", systemImage: "plus")
                    }
                }
            }
            .navigationDestination(for: Garden.self) { garden in
                GardenDetailView(garden: garden)
            }
            .sheet(isPresented: $isPresentingAddGarden) {
                GardenFormView(garden: nil)
            }
        }
    }
}

private struct GardenRow: View {
    var garden: Garden

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "map.fill")
                .font(.title3)
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(Color.accentColor.gradient, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(garden.name)
                    .font(.body.weight(.medium))
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var summary: String {
        let zoneWord = garden.zones.count > 1 ? "zones" : "zone"
        let plantWord = garden.plants.count > 1 ? "végétaux" : "végétal"
        return "\(garden.zones.count) \(zoneWord) · \(garden.plants.count) \(plantWord)"
    }
}
