import SwiftUI
import MapKit

/// "Position dans le jardin → Placer sur la carte" (spec §25). Tap
/// anywhere on the map to drop a pin, or use the device's current
/// position. Uses SpatialTapGesture + simultaneousGesture rather than
/// a plain .onTapGesture on Map: the latter has had known reliability
/// issues on newer OS versions (confirmed via Apple Developer Forums
/// while researching this), and simultaneousGesture also avoids eating
/// the Map's own pan/zoom gestures.
struct PlacePlantOnMapSheet: View {
    var plant: Plant

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var cameraPosition: MapCameraPosition
    @State private var selectedCoordinate: CLLocationCoordinate2D?
    @State private var isLocating = false
    @State private var locationError: String?

    init(plant: Plant) {
        self.plant = plant
        if let lat = plant.latitude, let lng = plant.longitude {
            let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            _selectedCoordinate = State(initialValue: coordinate)
            _cameraPosition = State(initialValue: .region(Self.region(for: coordinate)))
        } else if let gardenLat = plant.garden?.latitude, let gardenLng = plant.garden?.longitude {
            let coordinate = CLLocationCoordinate2D(latitude: gardenLat, longitude: gardenLng)
            _cameraPosition = State(initialValue: .region(Self.region(for: coordinate)))
        } else {
            _cameraPosition = State(initialValue: .automatic)
        }
    }

    private static func region(for coordinate: CLLocationCoordinate2D) -> MKCoordinateRegion {
        MKCoordinateRegion(center: coordinate, span: MKCoordinateSpan(latitudeDelta: 0.004, longitudeDelta: 0.004))
    }

    var body: some View {
        NavigationStack {
            MapReader { proxy in
                Map(position: $cameraPosition) {
                    if let selectedCoordinate {
                        Annotation("", coordinate: selectedCoordinate) {
                            Image(systemName: "mappin.circle.fill")
                                .font(.title)
                                .foregroundStyle(.red)
                                .shadow(radius: 2)
                        }
                    }
                }
                .simultaneousGesture(
                    SpatialTapGesture().onEnded { value in
                        if let coordinate = proxy.convert(value.location, from: .local) {
                            selectedCoordinate = coordinate
                        }
                    }
                )
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 8) {
                    if let locationError {
                        Text(locationError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                    Button {
                        Task { await useCurrentLocation() }
                    } label: {
                        if isLocating {
                            HStack {
                                ProgressView()
                                Text("Localisation…")
                            }
                            .frame(maxWidth: .infinity)
                        } else {
                            Label("Utiliser ma position actuelle", systemImage: "location.fill")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isLocating)
                }
                .padding()
                .background(.regularMaterial)
            }
            .navigationTitle("Position dans le jardin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(selectedCoordinate == nil)
                }
            }
        }
    }

    private func useCurrentLocation() async {
        isLocating = true
        locationError = nil
        do {
            let coordinate = try await LocationService.shared.requestCurrentLocation()
            selectedCoordinate = coordinate
            cameraPosition = .region(Self.region(for: coordinate))
        } catch {
            locationError = error.localizedDescription
        }
        isLocating = false
    }

    private func save() {
        guard let selectedCoordinate else { return }
        plant.latitude = selectedCoordinate.latitude
        plant.longitude = selectedCoordinate.longitude
        plant.positionSource = "manual"
        plant.markDirty()
        dismiss()
    }
}
