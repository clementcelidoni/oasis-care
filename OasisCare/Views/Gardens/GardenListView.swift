import SwiftUI
import SwiftData

struct GardenListView: View {
    @Environment(\.modelContext) private var modelContext

    @Query(sort: \Garden.name) private var gardens: [Garden]
    @State private var isPresentingAddGarden = false
    @State private var gardenPendingDeletion: Garden?

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
                            .accessibilityIdentifier(garden.name)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    gardenPendingDeletion = garden
                                } label: {
                                    Label("Supprimer", systemImage: "trash")
                                }
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
                    .accessibilityIdentifier("addGardenButton")
                }
            }
            .navigationDestination(for: Garden.self) { garden in
                GardenDetailView(garden: garden)
            }
            .sheet(isPresented: $isPresentingAddGarden) {
                let limits = PlanService.shared.configuration(for: EntitlementService.shared.snapshot.plan).usageLimits
                if UsageLimitService.canAddGarden(currentCount: gardens.count, limits: limits).isWithinLimit {
                    GardenFormView(garden: nil)
                } else {
                    FeatureGate(entitlement: .multipleGardens, featureName: "Plusieurs jardins") {
                        GardenFormView(garden: nil)
                    }
                }
            }
            .confirmationDialog(
                "Supprimer \(gardenPendingDeletion?.name ?? "ce jardin") ?",
                isPresented: Binding(
                    get: { gardenPendingDeletion != nil },
                    set: { if !$0 { gardenPendingDeletion = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Supprimer", role: .destructive) {
                    if let garden = gardenPendingDeletion {
                        DeletionService.delete(garden, in: modelContext)
                    }
                    gardenPendingDeletion = nil
                }
                Button("Annuler", role: .cancel) {
                    gardenPendingDeletion = nil
                }
            } message: {
                Text("Les zones de ce jardin seront aussi supprimées. Les végétaux qu'il contient seront conservés, sans jardin associé. Cette action est irréversible.")
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
