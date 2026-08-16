import SwiftUI
import SwiftData

struct GardenDetailView: View {
    private enum ActiveSheet: Identifiable {
        case edit
        case addZone
        case editZone(GardenZone)

        var id: String {
            switch self {
            case .edit: return "edit"
            case .addZone: return "addZone"
            case .editZone(let zone): return "editZone-\(zone.id.uuidString)"
            }
        }
    }

    var garden: Garden

    @State private var activeSheet: ActiveSheet?
    @State private var isBulkWaterSheetPresented = false

    private var plantsDueForWatering: [Plant] {
        garden.plants.filter { $0.schedule(for: .watering)?.isDue ?? false }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let address = garden.address, !address.isEmpty {
                    Label(address, systemImage: "location.fill")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if !garden.notes.isEmpty {
                    Text(garden.notes)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if !plantsDueForWatering.isEmpty {
                    quickWaterBanner
                }

                zonesSection
                plantsSection
            }
            .padding()
        }
        .navigationTitle(garden.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Modifier") { activeSheet = .edit }
            }
        }
        .navigationDestination(for: Plant.self) { plant in
            PlantDetailView(plant: plant)
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .edit:
                GardenFormView(garden: garden)
            case .addZone:
                GardenZoneFormView(garden: garden, zone: nil)
            case .editZone(let zone):
                GardenZoneFormView(garden: garden, zone: zone)
            }
        }
        .sheet(isPresented: $isBulkWaterSheetPresented) {
            PlantListView(gardenFilter: garden)
        }
    }

    private var quickWaterBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(plantsDueForWatering.count) plante\(plantsDueForWatering.count > 1 ? "s" : "") à arroser")
                .font(.subheadline.weight(.medium))

            Button {
                isBulkWaterSheetPresented = true
            } label: {
                Label("Sélectionner les plantes à arroser", systemImage: "drop.fill")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .accessibilityIdentifier("selectPlantsToWaterButton")
        }
        .padding()
        .background(Color.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var zonesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Zones")
                    .font(.headline)
                Spacer()
                Button {
                    activeSheet = .addZone
                } label: {
                    Label("Ajouter", systemImage: "plus.circle.fill")
                        .labelStyle(.iconOnly)
                }
                .accessibilityIdentifier("addZoneButton")
            }

            if garden.zones.isEmpty {
                Text("Aucune zone pour l'instant.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                let sortedZones = garden.zones.sorted { $0.name < $1.name }
                VStack(spacing: 0) {
                    ForEach(Array(sortedZones.enumerated()), id: \.element.id) { index, zone in
                        Button {
                            activeSheet = .editZone(zone)
                        } label: {
                            HStack {
                                Text(zone.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                Text("\(zone.plants.count)")
                                    .foregroundStyle(.secondary)
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(zone.name)
                        if index < sortedZones.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private var plantsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Végétaux")
                .font(.headline)

            if garden.plants.isEmpty {
                Text("Aucun végétal associé à ce jardin.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                let sortedPlants = garden.plants.sorted { $0.customName < $1.customName }
                VStack(spacing: 0) {
                    ForEach(Array(sortedPlants.enumerated()), id: \.element.id) { index, plant in
                        NavigationLink(value: plant) {
                            PlantRow(plant: plant)
                        }
                        if index < sortedPlants.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }
}
