import SwiftUI

/// Spec §79-80 — one on/off step in a scene. Only offers devices/
/// capabilities compatible with DeviceCommandService.setPower (see
/// OasisSceneAction's own doc comment for why `.valve` is excluded —
/// irrigation belongs to zones/automation rules, not scenes).
struct SceneActionEditSheet: View {
    var action: OasisSceneAction?
    var availableDevices: [ConnectedDevice]
    var onSave: (OasisSceneAction) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var device: ConnectedDevice?
    @State private var capability: DeviceCapability = .switchDevice
    @State private var targetOn = true

    private static let allowedCapabilities: [DeviceCapability] = [.switchDevice, .light, .heater, .fan, .mister, .pump, .filter, .uvSterilizer]

    private var matchingDevices: [ConnectedDevice] {
        availableDevices.filter { $0.hasCapability(capability) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Type d'équipement") {
                    Picker("Capacité", selection: $capability) {
                        ForEach(Self.allowedCapabilities) { capability in
                            Text(capability.displayName).tag(capability)
                        }
                    }
                }

                Section("Équipement") {
                    if matchingDevices.isEmpty {
                        Text("Aucun équipement avec cette capacité dans ce jardin.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Équipement", selection: $device) {
                            Text("Choisir…").tag(ConnectedDevice?.none)
                            ForEach(matchingDevices) { device in
                                Text(device.name).tag(ConnectedDevice?.some(device))
                            }
                        }
                    }
                }

                Section {
                    Picker("État cible", selection: $targetOn) {
                        Text("Marche").tag(true)
                        Text("Arrêt").tag(false)
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle(action == nil ? "Nouvelle action" : "Modifier l'action")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(device == nil)
                }
            }
            .task {
                guard let action else { return }
                device = action.device
                capability = action.capability
                targetOn = action.targetOn
            }
            .onChange(of: capability) { device = nil }
        }
    }

    private func save() {
        guard let device else { return }
        let target = action ?? OasisSceneAction(device: device, capability: capability, targetOn: targetOn)
        target.device = device
        target.capability = capability
        target.targetOn = targetOn
        onSave(target)
        dismiss()
    }
}
