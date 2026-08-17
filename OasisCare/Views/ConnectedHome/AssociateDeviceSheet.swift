import SwiftUI
import SwiftData

/// Spec §6/§9 — links a live HomeKit/Matter accessory to a Garden/Zone
/// by creating or updating its ConnectedDevice record. Capabilities are
/// pre-filled from what HomeKitService actually detected on the
/// accessory (never invented), but the user can add ones HomeKit's
/// standard vocabulary doesn't cover (soil moisture, pH, etc. — see
/// HomeKitService.capabilities(for:)'s doc comment) since those are
/// Oasis-specific meanings HomeKit itself has no concept of.
struct AssociateDeviceSheet: View {
    var accessory: ConnectedAccessory

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Garden.name) private var gardens: [Garden]
    @Query private var existingDevices: [ConnectedDevice]
    @ObservedObject private var commandService = DeviceCommandService.shared

    @State private var selectedGarden: Garden?
    @State private var selectedZone: GardenZone?
    @State private var selectedCapabilities: Set<DeviceCapability> = []
    @State private var didLoadExisting = false
    @State private var valveDurationMinutes = 8
    @State private var isCommandInProgress = false
    @State private var commandError: String?

    private var existingDevice: ConnectedDevice? {
        existingDevices.first { $0.providerDeviceId == accessory.id.uuidString }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Équipement") {
                    LabeledContent("Nom", value: accessory.name)
                    LabeledContent("Catégorie", value: accessory.category)
                    if let manufacturer = accessory.manufacturer {
                        LabeledContent("Fabricant", value: manufacturer)
                    }
                }

                if let device = existingDevice, device.isActuator {
                    controlsSection(for: device)
                }

                Section("Emplacement") {
                    Picker("Jardin", selection: $selectedGarden) {
                        Text("Aucun").tag(Garden?.none)
                        ForEach(gardens) { garden in
                            Text(garden.name).tag(Garden?.some(garden))
                        }
                    }
                    if let selectedGarden {
                        Picker("Zone", selection: $selectedZone) {
                            Text("Aucune").tag(GardenZone?.none)
                            ForEach(selectedGarden.zones) { zone in
                                Text(zone.name).tag(GardenZone?.some(zone))
                            }
                        }
                    }
                }

                Section {
                    ForEach(DeviceCapability.allCases) { capability in
                        Toggle(isOn: capabilityBinding(capability)) {
                            Label(capability.displayName, systemImage: capability.icon)
                        }
                    }
                } header: {
                    Text("Fonctions")
                } footer: {
                    Text("Pré-cochées à partir de ce que HomeKit détecte réellement sur cet équipement. Ajoutez-en si cet équipement a un rôle qu'Oasis Care ne peut pas détecter automatiquement (ex. sonde d'humidité du sol).")
                }

                if existingDevice != nil {
                    Section {
                        Button("Dissocier cet équipement", role: .destructive) {
                            dissociate()
                        }
                    }
                }
            }
            .navigationTitle("Associer un équipement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                }
            }
            .task {
                guard !didLoadExisting else { return }
                didLoadExisting = true
                if let existing = existingDevice {
                    selectedGarden = existing.garden
                    selectedZone = existing.zone
                    selectedCapabilities = Set(existing.capabilities)
                } else {
                    selectedCapabilities = Set(accessory.detectedCapabilities)
                }
            }
        }
    }

    @ViewBuilder
    private func controlsSection(for device: ConnectedDevice) -> some View {
        Section {
            if let active = commandService.activeValves[device.id] {
                HStack {
                    Label("En cours — \(Int(active.endsAt.timeIntervalSinceNow / 60)) min restantes", systemImage: "drop.fill")
                        .foregroundStyle(.blue)
                    Spacer()
                    Button("Arrêter") { Task { await stopValve(device) } }
                        .buttonStyle(.bordered)
                        .disabled(isCommandInProgress)
                }
            } else if device.hasCapability(.valve) {
                Stepper("Durée : \(valveDurationMinutes) min", value: $valveDurationMinutes, in: 1...60)
                Button("Ouvrir") { Task { await startValve(device) } }
                    .disabled(isCommandInProgress || !device.online)
            }

            if device.hasCapability(.switchDevice) || device.hasCapability(.light)
                || device.hasCapability(.fan) || device.hasCapability(.heater) {
                HStack {
                    Text(device.currentState ?? "État inconnu")
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Marche") { Task { await setPower(device, on: true) } }
                        .buttonStyle(.bordered)
                        .disabled(isCommandInProgress || !device.online)
                    Button("Arrêt") { Task { await setPower(device, on: false) } }
                        .buttonStyle(.bordered)
                        .disabled(isCommandInProgress || !device.online)
                }
            }

            if !device.online {
                Text("Cet équipement est hors ligne — commandes indisponibles.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let commandError {
                Text(commandError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Contrôles")
        }
    }

    private func startValve(_ device: ConnectedDevice) async {
        isCommandInProgress = true
        commandError = nil
        let result = await commandService.openValve(
            device, durationSeconds: TimeInterval(valveDurationMinutes * 60), context: modelContext
        )
        if case .failure(let error) = result { commandError = error.localizedDescription }
        isCommandInProgress = false
    }

    private func stopValve(_ device: ConnectedDevice) async {
        isCommandInProgress = true
        commandError = nil
        let result = await commandService.closeValve(device, context: modelContext)
        if case .failure(let error) = result { commandError = error.localizedDescription }
        isCommandInProgress = false
    }

    private func setPower(_ device: ConnectedDevice, on: Bool) async {
        isCommandInProgress = true
        commandError = nil
        let capability: DeviceCapability = device.hasCapability(.switchDevice) ? .switchDevice
            : device.hasCapability(.light) ? .light
            : device.hasCapability(.fan) ? .fan
            : .heater
        let result = await commandService.setPower(device, on: on, capability: capability, context: modelContext)
        if case .failure(let error) = result { commandError = error.localizedDescription }
        isCommandInProgress = false
    }

    private func capabilityBinding(_ capability: DeviceCapability) -> Binding<Bool> {
        Binding(
            get: { selectedCapabilities.contains(capability) },
            set: { isOn in
                if isOn { selectedCapabilities.insert(capability) } else { selectedCapabilities.remove(capability) }
            }
        )
    }

    private func save() {
        let device = existingDevice ?? ConnectedDevice(
            provider: .homeKit,
            providerDeviceId: accessory.id.uuidString,
            name: accessory.name,
            category: accessory.category
        )
        device.name = accessory.name
        device.category = accessory.category
        device.manufacturer = accessory.manufacturer
        device.model = accessory.model
        device.firmwareVersion = accessory.firmwareVersion
        device.online = accessory.isReachable
        device.lastSeenAt = accessory.isReachable ? .now : device.lastSeenAt
        device.capabilities = Array(selectedCapabilities)
        device.garden = selectedGarden
        device.zone = selectedZone
        if device.syncStatus == .synced { device.syncStatus = .pendingUpdate }
        device.updatedAt = .now
        if existingDevice == nil {
            modelContext.insert(device)
        }
        try? modelContext.save()
        dismiss()
    }

    private func dissociate() {
        guard let existingDevice else { return }
        DeletionService.delete(existingDevice, in: modelContext)
        try? modelContext.save()
        dismiss()
    }
}
