import SwiftUI
import SwiftData

struct IrrigationZoneFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    var garden: Garden
    var zone: IrrigationZone?

    @State private var name: String
    @State private var type: IrrigationType
    @State private var flowRateText: String
    @State private var flowRateUnit: String
    @State private var durationText: String
    @State private var active: Bool
    @State private var notes: String
    @State private var valveDevice: ConnectedDevice?
    @State private var pumpDevice: ConnectedDevice?
    @State private var soilSensor: Sensor?
    @State private var flowSensor: Sensor?

    private var gardenValves: [ConnectedDevice] { garden.connectedDevices.filter { $0.hasCapability(.valve) } }
    private var gardenPumps: [ConnectedDevice] { garden.connectedDevices.filter { $0.hasCapability(.pump) } }
    private var gardenSoilSensors: [Sensor] { garden.sensors.filter { $0.type == .soilMoisture } }
    private var gardenFlowSensors: [Sensor] { garden.sensors.filter { $0.type == .waterFlow } }

    init(garden: Garden, zone: IrrigationZone?) {
        self.garden = garden
        self.zone = zone
        _name = State(initialValue: zone?.name ?? "")
        _type = State(initialValue: zone?.type ?? .drip)
        _flowRateText = State(initialValue: zone?.flowRate.map { String($0) } ?? "")
        _flowRateUnit = State(initialValue: zone?.flowRateUnit ?? "L/h")
        _durationText = State(initialValue: zone?.durationMinutes.map { String($0) } ?? "")
        _active = State(initialValue: zone?.active ?? true)
        _notes = State(initialValue: zone?.notes ?? "")
        _valveDevice = State(initialValue: zone?.valveDevice)
        _pumpDevice = State(initialValue: zone?.pumpDevice)
        _soilSensor = State(initialValue: zone?.soilSensor)
        _flowSensor = State(initialValue: zone?.flowSensor)
    }

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identité") {
                    TextField("Nom de la zone", text: $name)
                    Picker("Type", selection: $type) {
                        ForEach(IrrigationType.allCases) { type in
                            Label(type.displayName, systemImage: type.icon).tag(type)
                        }
                    }
                    Toggle("Active", isOn: $active)
                }

                Section {
                    HStack {
                        TextField("Débit", text: $flowRateText)
                            .keyboardType(.decimalPad)
                        TextField("Unité", text: $flowRateUnit)
                            .frame(width: 80)
                    }
                    HStack {
                        Text("Durée d'un cycle")
                        Spacer()
                        TextField("min", text: $durationText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                        Text("min")
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Débit et durée")
                } footer: {
                    Text("Utilisés pour estimer la consommation d'eau de cette zone.")
                }

                Section {
                    Picker("Vanne", selection: $valveDevice) {
                        Text("Aucune").tag(ConnectedDevice?.none)
                        ForEach(gardenValves) { device in Text(device.name).tag(ConnectedDevice?.some(device)) }
                    }
                    Picker("Pompe", selection: $pumpDevice) {
                        Text("Aucune").tag(ConnectedDevice?.none)
                        ForEach(gardenPumps) { device in Text(device.name).tag(ConnectedDevice?.some(device)) }
                    }
                    Picker("Capteur sol", selection: $soilSensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(gardenSoilSensors) { sensor in Text(sensor.name).tag(Sensor?.some(sensor)) }
                    }
                    Picker("Capteur de débit", selection: $flowSensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(gardenFlowSensors) { sensor in Text(sensor.name).tag(Sensor?.some(sensor)) }
                    }
                } header: {
                    Text("Équipements connectés")
                } footer: {
                    Text("Associez une vanne pour arroser réellement cette zone depuis Oasis Care, plutôt que d'enregistrer un cycle à la main.")
                }

                if let zone, !zone.plants.isEmpty {
                    Section("Végétaux de cette zone") {
                        ForEach(zone.plants.sorted { $0.customName < $1.customName }) { plant in
                            Text(plant.customName)
                        }
                    }
                }

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(zone == nil ? "Nouvelle zone" : "Modifier")
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
        let flowRate = Double(flowRateText.replacingOccurrences(of: ",", with: "."))
        let duration = Int(durationText)

        if let zone {
            zone.name = trimmedName
            zone.type = type
            zone.flowRate = flowRate
            zone.flowRateUnit = flowRateUnit
            zone.durationMinutes = duration
            zone.active = active
            zone.notes = notes
            zone.valveDevice = valveDevice
            zone.pumpDevice = pumpDevice
            zone.soilSensor = soilSensor
            zone.flowSensor = flowSensor
            zone.markDirty()
        } else {
            let newZone = IrrigationZone(
                name: trimmedName, type: type, flowRate: flowRate, flowRateUnit: flowRateUnit,
                durationMinutes: duration, active: active, notes: notes, garden: garden
            )
            newZone.valveDevice = valveDevice
            newZone.pumpDevice = pumpDevice
            newZone.soilSensor = soilSensor
            newZone.flowSensor = flowSensor
            modelContext.insert(newZone)
            garden.irrigationZones.append(newZone)
        }

        dismiss()
    }
}
