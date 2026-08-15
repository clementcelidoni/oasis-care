import SwiftUI
import SwiftData

struct GardenDetailView: View {
    var garden: Garden

    @State private var isPresentingEdit = false
    @State private var isPresentingAddZone = false
    @State private var editingZone: GardenZone?

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

                zonesSection
                plantsSection
            }
            .padding()
        }
        .navigationTitle(garden.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Modifier") { isPresentingEdit = true }
            }
        }
        .navigationDestination(for: Plant.self) { plant in
            PlantDetailView(plant: plant)
        }
        .sheet(isPresented: $isPresentingEdit) {
            GardenFormView(garden: garden)
        }
        .sheet(isPresented: $isPresentingAddZone) {
            GardenZoneFormView(garden: garden, zone: nil)
        }
        .sheet(item: $editingZone) { zone in
            GardenZoneFormView(garden: garden, zone: zone)
        }
    }

    private var zonesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Zones")
                    .font(.headline)
                Spacer()
                Button {
                    isPresentingAddZone = true
                } label: {
                    Label("Ajouter", systemImage: "plus.circle.fill")
                        .labelStyle(.iconOnly)
                }
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
                            editingZone = zone
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
                        }
                        .buttonStyle(.plain)
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
