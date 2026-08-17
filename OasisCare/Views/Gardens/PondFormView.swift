import SwiftUI
import SwiftData

struct PondFormView: View {
    var garden: Garden
    var pond: Pond?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    @State private var name = ""
    @State private var volumeLiters = ""
    @State private var tempMin = ""
    @State private var tempMax = ""
    @State private var targetWaterLevel = ""
    @State private var waterTemperatureSensor: Sensor?
    @State private var waterLevelSensor: Sensor?
    @State private var flowSensor: Sensor?
    @State private var phSensor: Sensor?
    @State private var conductivitySensor: Sensor?
    @State private var pumpDevice: ConnectedDevice?
    @State private var filtrationDevice: ConnectedDevice?
    @State private var uvDevice: ConnectedDevice?
    @State private var hasLastFiltrationCleanedAt = false
    @State private var lastFiltrationCleanedAt = Date.now
    @State private var hasUvLampInstalledAt = false
    @State private var uvLampInstalledAt = Date.now
    @State private var uvLampReminderAfterDays = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Nom") {
                    TextField("Ex. Bassin aux nénuphars", text: $name)
                }

                Section("Caractéristiques") {
                    HStack {
                        Text("Volume (L)")
                        Spacer()
                        TextField("Optionnel", text: $volumeLiters)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                    rangeRow("Température (°C)", min: $tempMin, max: $tempMax)
                    HStack {
                        Text("Niveau d'eau cible (%)")
                        Spacer()
                        TextField("Optionnel", text: $targetWaterLevel)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }
                }

                Section("Capteurs") {
                    Picker("Température de l'eau", selection: $waterTemperatureSensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(garden.sensors.filter { $0.type == .waterTemperature }) { sensor in
                            Text(sensor.name).tag(Sensor?.some(sensor))
                        }
                    }
                    Picker("Niveau d'eau", selection: $waterLevelSensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(garden.sensors.filter { $0.type == .waterLevel }) { sensor in
                            Text(sensor.name).tag(Sensor?.some(sensor))
                        }
                    }
                    Picker("Débit", selection: $flowSensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(garden.sensors.filter { $0.type == .waterFlow }) { sensor in
                            Text(sensor.name).tag(Sensor?.some(sensor))
                        }
                    }
                    Picker("pH", selection: $phSensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(garden.sensors.filter { $0.type == .ph }) { sensor in
                            Text(sensor.name).tag(Sensor?.some(sensor))
                        }
                    }
                    Picker("Conductivité", selection: $conductivitySensor) {
                        Text("Aucune").tag(Sensor?.none)
                        ForEach(garden.sensors.filter { $0.type == .conductivity }) { sensor in
                            Text(sensor.name).tag(Sensor?.some(sensor))
                        }
                    }
                }

                Section {
                    Picker("Pompe", selection: $pumpDevice) {
                        Text("Aucune").tag(ConnectedDevice?.none)
                        ForEach(garden.connectedDevices.filter { $0.hasCapability(.pump) }) { device in
                            Text(device.name).tag(ConnectedDevice?.some(device))
                        }
                    }
                    Picker("Filtration", selection: $filtrationDevice) {
                        Text("Aucune").tag(ConnectedDevice?.none)
                        ForEach(garden.connectedDevices.filter { $0.hasCapability(.filter) }) { device in
                            Text(device.name).tag(ConnectedDevice?.some(device))
                        }
                    }
                    Picker("Lampe UV", selection: $uvDevice) {
                        Text("Aucune").tag(ConnectedDevice?.none)
                        ForEach(garden.connectedDevices.filter { $0.hasCapability(.uvSterilizer) }) { device in
                            Text(device.name).tag(ConnectedDevice?.some(device))
                        }
                    }
                } header: {
                    Text("Équipements")
                }

                Section {
                    Toggle("Dernier nettoyage connu", isOn: $hasLastFiltrationCleanedAt)
                    if hasLastFiltrationCleanedAt {
                        DatePicker("Date", selection: $lastFiltrationCleanedAt, displayedComponents: .date)
                    }
                } header: {
                    Text("Filtration")
                }

                Section {
                    Toggle("Lampe UV installée", isOn: $hasUvLampInstalledAt)
                    if hasUvLampInstalledAt {
                        DatePicker("Date d'installation", selection: $uvLampInstalledAt, displayedComponents: .date)
                        HStack {
                            Text("Rappel après (jours)")
                            Spacer()
                            TextField("Ex. 365", text: $uvLampReminderAfterDays)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 60)
                        }
                    }
                } header: {
                    Text("Lampe UV")
                } footer: {
                    Text("Oasis rappelle le remplacement en estimant le temps de fonctionnement depuis l'installation — pas un compteur d'heures précis.")
                }

                if pond != nil {
                    Section {
                        Button("Supprimer ce bassin", role: .destructive) { delete() }
                    }
                }
            }
            .navigationTitle(pond == nil ? "Nouveau bassin" : "Modifier le bassin")
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
                guard let pond else { return }
                name = pond.name
                volumeLiters = pond.volumeLiters.map { String($0) } ?? ""
                tempMin = pond.targetTemperatureMin.map { String($0) } ?? ""
                tempMax = pond.targetTemperatureMax.map { String($0) } ?? ""
                targetWaterLevel = pond.targetWaterLevelPercent.map { String($0) } ?? ""
                waterTemperatureSensor = pond.waterTemperatureSensor
                waterLevelSensor = pond.waterLevelSensor
                flowSensor = pond.flowSensor
                phSensor = pond.phSensor
                conductivitySensor = pond.conductivitySensor
                pumpDevice = pond.pumpDevice
                filtrationDevice = pond.filtrationDevice
                uvDevice = pond.uvDevice
                if let date = pond.lastFiltrationCleanedAt {
                    hasLastFiltrationCleanedAt = true
                    lastFiltrationCleanedAt = date
                }
                if let date = pond.uvLampInstalledAt {
                    hasUvLampInstalledAt = true
                    uvLampInstalledAt = date
                }
                uvLampReminderAfterDays = pond.uvLampReminderAfterDays.map { String($0) } ?? ""
            }
        }
    }

    private func rangeRow(_ title: String, min: Binding<String>, max: Binding<String>) -> some View {
        HStack {
            Text(title)
            Spacer()
            TextField("Min", text: min)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 60)
            Text("–")
                .foregroundStyle(.secondary)
            TextField("Max", text: max)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 60)
        }
    }

    private func save() {
        let target = pond ?? Pond(name: name, garden: garden)
        target.name = name
        target.volumeLiters = Double(volumeLiters.replacingOccurrences(of: ",", with: "."))
        target.targetTemperatureMin = Double(tempMin.replacingOccurrences(of: ",", with: "."))
        target.targetTemperatureMax = Double(tempMax.replacingOccurrences(of: ",", with: "."))
        target.targetWaterLevelPercent = Double(targetWaterLevel.replacingOccurrences(of: ",", with: "."))
        target.waterTemperatureSensor = waterTemperatureSensor
        target.waterLevelSensor = waterLevelSensor
        target.flowSensor = flowSensor
        target.phSensor = phSensor
        target.conductivitySensor = conductivitySensor
        target.pumpDevice = pumpDevice
        target.filtrationDevice = filtrationDevice
        target.uvDevice = uvDevice
        target.lastFiltrationCleanedAt = hasLastFiltrationCleanedAt ? lastFiltrationCleanedAt : nil
        target.uvLampInstalledAt = hasUvLampInstalledAt ? uvLampInstalledAt : nil
        target.uvLampReminderAfterDays = hasUvLampInstalledAt ? Int(uvLampReminderAfterDays) : nil
        if target.syncStatus == .synced { target.syncStatus = .pendingUpdate }
        target.updatedAt = .now
        if pond == nil {
            modelContext.insert(target)
            garden.ponds.append(target)
        }
        try? modelContext.save()
        dismiss()
    }

    private func delete() {
        guard let pond else { return }
        DeletionService.delete(pond, in: modelContext)
        try? modelContext.save()
        dismiss()
    }
}
