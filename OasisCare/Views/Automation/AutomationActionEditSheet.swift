import SwiftUI
import SwiftData

struct AutomationActionEditSheet: View {
    var action: AutomationAction?
    var scopeGarden: Garden?
    var scopeZone: GardenZone?
    var scopePlant: Plant?
    var onSave: (AutomationAction) -> Void

    @Environment(\.dismiss) private var dismiss
    @Query private var allDevices: [ConnectedDevice]

    @State private var type: AutomationActionType = .openValve
    @State private var selectedDevice: ConnectedDevice?
    @State private var durationMinutes = 8
    @State private var message = ""

    private var scopedDevices: [ConnectedDevice] {
        if let scopeZone { return scopeZone.connectedDevices }
        if let scopeGarden { return scopeGarden.connectedDevices }
        return allDevices
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Action", selection: $type) {
                        ForEach(AutomationActionType.allCases) { type in
                            Text(type.displayName).tag(type)
                        }
                    }
                }

                if type.requiresDevice {
                    Section("Équipement") {
                        Picker("Équipement", selection: $selectedDevice) {
                            Text("Aucun").tag(ConnectedDevice?.none)
                            ForEach(scopedDevices) { device in Text(device.name).tag(ConnectedDevice?.some(device)) }
                        }
                    }
                }

                if type.requiresDuration {
                    Section {
                        Stepper("Durée : \(durationMinutes) min", value: $durationMinutes, in: 1...60)
                    } footer: {
                        Text("Plafonnée à 30 min quel que soit le réglage — limite fixe de sécurité.")
                    }
                }

                if type == .sendNotification || type == .createCareEvent {
                    Section {
                        TextField("Message", text: $message, axis: .vertical)
                            .lineLimit(1...3)
                    }
                }
            }
            .navigationTitle("Action")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("OK") { save() }
                }
            }
            .task {
                guard let action else { return }
                type = action.type
                selectedDevice = action.device
                if let duration = action.durationSeconds { durationMinutes = Int(duration / 60) }
                message = action.message ?? ""
            }
        }
    }

    private func save() {
        let target = action ?? AutomationAction(type: type)
        target.type = type
        target.device = selectedDevice
        target.durationSeconds = type.requiresDuration ? Double(durationMinutes * 60) : nil
        target.message = message.isEmpty ? nil : message
        onSave(target)
        dismiss()
    }
}
