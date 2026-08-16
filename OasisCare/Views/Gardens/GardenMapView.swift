import SwiftUI
import MapKit

/// Interactive garden map (spec §23-30). Reuses PlantType.icon for the
/// per-type SF Symbol (spec §26) rather than inventing a second
/// type→symbol mapping — the existing one already covers arbre,
/// palmier, plante, massif (flowerBed), pelouse (lawn).
struct GardenMapView: View {
    var garden: Garden

    @State private var cameraPosition: MapCameraPosition
    @State private var showHealthOverlay = false
    @State private var selectedPlant: Plant?
    @State private var selectedClusterPlants: IdentifiablePlantGroup?

    init(garden: Garden) {
        self.garden = garden
        let coordinates = garden.plants.compactMap { plant -> CLLocationCoordinate2D? in
            guard let lat = plant.latitude, let lng = plant.longitude else { return nil }
            return CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }
        if let first = coordinates.first {
            let region = MKCoordinateRegion(center: first, span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01))
            _cameraPosition = State(initialValue: .region(region))
        } else {
            _cameraPosition = State(initialValue: .automatic)
        }
    }

    private var positionedPlants: [Plant] {
        garden.plants.filter { $0.hasMapPosition && !$0.isArchived }
    }

    /// Groups plants within a small coordinate delta into one annotation
    /// (spec §29: "clustering ou équivalent... ne pas afficher 500
    /// annotations superposées") — a fixed-radius grouping rather than
    /// MapKit's zoom-dependent MKClusterAnnotation, which needs the
    /// older UIKit MKMapView and isn't available on SwiftUI's Map.
    private var clusters: [MapCluster] {
        let thresholdDegrees = 0.0003 // roughly 30m
        var result: [MapCluster] = []
        for plant in positionedPlants {
            guard let lat = plant.latitude, let lng = plant.longitude else { continue }
            if let index = result.firstIndex(where: {
                abs($0.coordinate.latitude - lat) < thresholdDegrees && abs($0.coordinate.longitude - lng) < thresholdDegrees
            }) {
                result[index].plants.append(plant)
            } else {
                result.append(MapCluster(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng), plants: [plant]))
            }
        }
        return result
    }

    var body: some View {
        Group {
            if positionedPlants.isEmpty {
                EmptyStateView(
                    icon: "map",
                    title: "Aucun végétal positionné",
                    message: "Ouvrez la fiche d'un végétal puis « Position dans le jardin » pour le placer sur la carte."
                )
            } else {
                Map(position: $cameraPosition) {
                    ForEach(clusters) { cluster in
                        Annotation(cluster.title, coordinate: cluster.coordinate) {
                            annotationView(for: cluster)
                                .onTapGesture { handleTap(on: cluster) }
                        }
                    }
                }
                .mapStyle(.standard)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showHealthOverlay.toggle()
                } label: {
                    Label("Afficher l'état de santé", systemImage: showHealthOverlay ? "heart.text.square.fill" : "heart.text.square")
                }
            }
        }
        .sheet(item: $selectedPlant) { plant in
            PlantMapPreviewSheet(plant: plant)
        }
        .sheet(item: $selectedClusterPlants) { group in
            NavigationStack {
                List(group.plants) { plant in
                    Button { selectedPlant = plant } label: {
                        PlantRow(plant: plant)
                    }
                    .buttonStyle(.plain)
                }
                .listStyle(.plain)
                .navigationTitle("\(group.plants.count) végétaux")
                .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    private func handleTap(on cluster: MapCluster) {
        if cluster.plants.count == 1, let plant = cluster.plants.first {
            selectedPlant = plant
        } else {
            selectedClusterPlants = IdentifiablePlantGroup(plants: cluster.plants)
        }
    }

    @ViewBuilder
    private func annotationView(for cluster: MapCluster) -> some View {
        if cluster.plants.count > 1 {
            ZStack {
                Circle().fill(Color.accentColor.gradient).frame(width: 32, height: 32)
                Text("\(cluster.plants.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
            }
            .shadow(radius: 2)
        } else if let plant = cluster.plants.first {
            ZStack {
                Circle()
                    .fill((showHealthOverlay ? plant.healthStatus.color : Color.accentColor).gradient)
                    .frame(width: 30, height: 30)
                Image(systemName: plant.type.icon)
                    .font(.caption)
                    .foregroundStyle(.white)
            }
            .shadow(radius: 2)
        }
    }
}

private struct MapCluster: Identifiable {
    let id = UUID()
    var coordinate: CLLocationCoordinate2D
    var plants: [Plant]
    var title: String { plants.count == 1 ? (plants.first?.customName ?? "") : "\(plants.count) végétaux" }
}

private struct IdentifiablePlantGroup: Identifiable {
    let id = UUID()
    var plants: [Plant]
}

/// Spec §28: tap an annotation → name, species, health, last
/// inspection, [Ouvrir]. A normal (not height-constrained) sheet with
/// its own NavigationStack, since a `.sheet` is a separate hierarchy
/// from GardenMapView's — pushing PlantDetailView here needs this
/// sheet's own navigationDestination, not the presenter's.
private struct PlantMapPreviewSheet: View {
    var plant: Plant

    @Environment(\.dismiss) private var dismiss

    private var lastInspectionDate: Date? {
        plant.careEvents.filter { $0.type == .inspection }.map(\.date).max()
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    if let photoData = plant.thumbnailData ?? plant.photoData, let uiImage = UIImage(data: photoData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 56, height: 56)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    } else {
                        Image(systemName: plant.type.icon)
                            .font(.title2)
                            .foregroundStyle(.white)
                            .frame(width: 56, height: 56)
                            .background(plant.healthStatus.color.gradient, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(plant.customName)
                            .font(.title3.weight(.semibold))
                        if let scientificName = plant.scientificName, !scientificName.isEmpty {
                            Text(scientificName)
                                .font(.subheadline.italic())
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                HealthStatusBadge(status: plant.healthStatus)

                if let lastInspectionDate {
                    Label("Dernière inspection : \(DateFormatting.shortDate(lastInspectionDate))", systemImage: "checkmark.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Label("Jamais inspecté", systemImage: "circle.dashed")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                NavigationLink(value: plant) {
                    Text("Ouvrir")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Spacer(minLength: 0)
            }
            .padding()
            .navigationDestination(for: Plant.self) { plant in
                PlantDetailView(plant: plant)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .presentationDetents([.height(280), .large])
        }
    }
}
