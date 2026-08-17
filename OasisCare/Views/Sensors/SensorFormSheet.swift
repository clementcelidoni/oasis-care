import SwiftUI
import SwiftData

/// Creates or edits a Sensor scoped to a plant, zone, or garden (exactly
/// one context is passed in by the caller). Spec §14 — offers linking to
/// an existing ConnectedDevice whose HomeKit-detected capabilities match
/// this sensor type, falling back to manual entry for types HomeKit's
/// standard catalog doesn't cover.
struct SensorFormSheet: View {
    var plant: Plant?
    var zone: GardenZone?
    var garden: Garden?
    var sensor: Sensor?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Query private var allDevices: [ConnectedDevice]

    @State private var name = ""
    @State private var type: SensorType = .soilMoisture
    @State private var selectedDevice: ConnectedDevice?
    @State private var minimumExpected = ""
    @State private var maximumExpected = ""

    private var matchingDevices: [ConnectedDevice] {
        guard let capability = type.matchingDeviceCapability else { return [] }
        return allDevices.filter { $0.hasCapability(capability) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Capteur") {
                    TextField("Nom", text: $name)
                    Picker("Type", selection: $type) {
                        ForEach(SensorType.allCases) { type in
                            Label(type.displayName, systemImage: type.icon).tag(type)
                        }
                    }
                }

                Section {
                    if matchingDevices.isEmpty {
                        Text("Aucun équipement HomeKit compatible détecté pour ce type — les valeurs seront saisies manuellement.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Équipement source", selection: $selectedDevice) {
                            Text("Saisie manuelle").tag(ConnectedDevice?.none)
                            ForEach(matchingDevices) { device in
                                Text(device.name).tag(ConnectedDevice?.some(device))
                            }
                        }
                    }
                } header: {
                    Text("Source")
                }

                Section {
                    TextField("Minimum", text: $minimumExpected)
                        .keyboardType(.decimalPad)
                    TextField("Maximum", text: $maximumExpected)
                        .keyboardType(.decimalPad)
                } header: {
                    Text("Plage attendue (facultatif)")
                } footer: {
                    Text("Utilisée pour repérer les valeurs impossibles (Phase 5I).")
                }

                if sensor != nil {
                    Section {
                        Button("Supprimer ce capteur", role: .destructive) { deleteSensor() }
                    }
                }
            }
            .navigationTitle(sensor == nil ? "Nouveau capteur" : "Modifier le capteur")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task {
                guard let sensor else { return }
                name = sensor.name
                type = sensor.type
                selectedDevice = sensor.device
                minimumExpected = sensor.minimumExpected.map { String($0) } ?? ""
                maximumExpected = sensor.maximumExpected.map { String($0) } ?? ""
            }
        }
    }

    private func save() {
        let target = sensor ?? Sensor(name: name, type: type, plant: plant, garden: garden ?? plant?.garden, zone: zone)
        target.name = name
        target.type = type
        target.unit = type.defaultUnit
        target.device = selectedDevice
        target.source = selectedDevice != nil ? .device : .manual
        target.minimumExpected = Double(minimumExpected.replacingOccurrences(of: ",", with: "."))
        target.maximumExpected = Double(maximumExpected.replacingOccurrences(of: ",", with: "."))
        if sensor == nil {
            modelContext.insert(target)
        } else if target.syncStatus == .synced {
            target.syncStatus = .pendingUpdate
        }
        target.updatedAt = .now
        try? modelContext.save()
        dismiss()
    }

    private func deleteSensor() {
        guard let sensor else { return }
        DeletionService.delete(sensor, in: modelContext)
        try? modelContext.save()
        dismiss()
    }
}
