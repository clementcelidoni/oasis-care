import SwiftUI
import SwiftData

struct GardenFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    var garden: Garden?

    @State private var name: String
    @State private var address: String
    @State private var notes: String
    @State private var locationName: String
    @State private var latitudeText: String
    @State private var longitudeText: String
    @State private var weatherEnabled: Bool
    @State private var isLocating = false
    @State private var locationError: String?

    init(garden: Garden?) {
        self.garden = garden
        _name = State(initialValue: garden?.name ?? "")
        _address = State(initialValue: garden?.address ?? "")
        _notes = State(initialValue: garden?.notes ?? "")
        _locationName = State(initialValue: garden?.locationName ?? "")
        _latitudeText = State(initialValue: garden?.latitude.map { String($0) } ?? "")
        _longitudeText = State(initialValue: garden?.longitude.map { String($0) } ?? "")
        _weatherEnabled = State(initialValue: garden?.weatherEnabled ?? false)
    }

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var hasValidCoordinates: Bool {
        Double(latitudeText) != nil && Double(longitudeText) != nil
    }

    private func useCurrentLocation() async {
        isLocating = true
        locationError = nil
        do {
            let coordinate = try await LocationService.shared.requestCurrentLocation()
            latitudeText = String(coordinate.latitude)
            longitudeText = String(coordinate.longitude)
        } catch {
            locationError = error.localizedDescription
        }
        isLocating = false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identité") {
                    TextField("Nom du jardin", text: $name)
                    TextField("Adresse (facultatif)", text: $address)
                }
                Section {
                    TextField("Nom du lieu (facultatif)", text: $locationName)
                    HStack {
                        TextField("Latitude", text: $latitudeText)
                            .keyboardType(.numbersAndPunctuation)
                        TextField("Longitude", text: $longitudeText)
                            .keyboardType(.numbersAndPunctuation)
                    }
                    Button {
                        Task { await useCurrentLocation() }
                    } label: {
                        if isLocating {
                            HStack {
                                ProgressView()
                                Text("Localisation…")
                            }
                        } else {
                            Label("Utiliser ma position", systemImage: "location.fill")
                        }
                    }
                    .disabled(isLocating)

                    if let locationError {
                        Text(locationError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    Toggle("Afficher la météo pour ce jardin", isOn: $weatherEnabled)
                        .disabled(!hasValidCoordinates)
                } header: {
                    Text("Météo")
                } footer: {
                    Text("La position n'est utilisée que pour récupérer la météo locale — jamais partagée ni demandée automatiquement.")
                }
                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(garden == nil ? "Nouveau jardin" : "Modifier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(!isValid)
                }
            }
        }
    }

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let latitude = Double(latitudeText)
        let longitude = Double(longitudeText)

        let targetGarden: Garden
        if let garden {
            garden.name = trimmedName
            garden.address = address.isEmpty ? nil : address
            garden.notes = notes
            garden.markDirty()
            targetGarden = garden
        } else {
            let newGarden = Garden(name: trimmedName, address: address.isEmpty ? nil : address, notes: notes)
            modelContext.insert(newGarden)
            targetGarden = newGarden
        }

        targetGarden.locationName = locationName.isEmpty ? nil : locationName
        targetGarden.latitude = latitude
        targetGarden.longitude = longitude
        targetGarden.weatherEnabled = weatherEnabled && latitude != nil && longitude != nil

        dismiss()
    }
}
