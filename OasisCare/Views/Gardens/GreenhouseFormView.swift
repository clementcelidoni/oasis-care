import SwiftUI
import SwiftData

struct GreenhouseFormView: View {
    var garden: Garden
    var greenhouse: Greenhouse?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    @State private var name = ""
    @State private var tempMin = ""
    @State private var tempMax = ""
    @State private var humidityMin = ""
    @State private var humidityMax = ""
    @State private var lightMin = ""
    @State private var lightMax = ""
    @State private var climateControlEnabled = false
    @State private var temperatureSensor: Sensor?
    @State private var humiditySensor: Sensor?
    @State private var lightSensor: Sensor?
    @State private var heaterDevice: ConnectedDevice?
    @State private var fanDevice: ConnectedDevice?
    @State private var misterDevice: ConnectedDevice?
    @State private var lightDevice: ConnectedDevice?

    var body: some View {
        NavigationStack {
            Form {
                Section("Nom") {
                    TextField("Ex. Serre tropicale", text: $name)
                }

                Section("Plages cibles") {
                    rangeRow("Température (°C)", min: $tempMin, max: $tempMax)
                    rangeRow("Humidité (%)", min: $humidityMin, max: $humidityMax)
                    rangeRow("Luminosité (lux)", min: $lightMin, max: $lightMax)
                }

                Section("Capteurs") {
                    Picker("Température", selection: $temperatureSensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(garden.sensors.filter { $0.type == .airTemperature }) { sensor in
                            Text(sensor.name).tag(Sensor?.some(sensor))
                        }
                    }
                    Picker("Humidité", selection: $humiditySensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(garden.sensors.filter { $0.type == .airHumidity }) { sensor in
                            Text(sensor.name).tag(Sensor?.some(sensor))
                        }
                    }
                    Picker("Luminosité", selection: $lightSensor) {
                        Text("Aucun").tag(Sensor?.none)
                        ForEach(garden.sensors.filter { $0.type == .light }) { sensor in
                            Text(sensor.name).tag(Sensor?.some(sensor))
                        }
                    }
                }

                Section {
                    Picker("Chauffage", selection: $heaterDevice) {
                        Text("Aucun").tag(ConnectedDevice?.none)
                        ForEach(garden.connectedDevices.filter { $0.hasCapability(.heater) }) { device in
                            Text(device.name).tag(ConnectedDevice?.some(device))
                        }
                    }
                    Picker("Ventilation", selection: $fanDevice) {
                        Text("Aucune").tag(ConnectedDevice?.none)
                        ForEach(garden.connectedDevices.filter { $0.hasCapability(.fan) }) { device in
                            Text(device.name).tag(ConnectedDevice?.some(device))
                        }
                    }
                    Picker("Brumisation", selection: $misterDevice) {
                        Text("Aucune").tag(ConnectedDevice?.none)
                        ForEach(garden.connectedDevices.filter { $0.hasCapability(.mister) }) { device in
                            Text(device.name).tag(ConnectedDevice?.some(device))
                        }
                    }
                    Picker("Éclairage", selection: $lightDevice) {
                        Text("Aucun").tag(ConnectedDevice?.none)
                        ForEach(garden.connectedDevices.filter { $0.hasCapability(.light) }) { device in
                            Text(device.name).tag(ConnectedDevice?.some(device))
                        }
                    }
                } header: {
                    Text("Équipements")
                }

                Section {
                    Toggle("Pilotage automatique", isOn: $climateControlEnabled)
                } footer: {
                    Text("Quand activé, Oasis ajuste chauffage/ventilation/brumisation pour rester dans les plages cibles, avec hystérésis pour éviter les allumages/extinctions répétés.")
                }

                if greenhouse != nil {
                    Section {
                        Button("Supprimer cette serre", role: .destructive) { delete() }
                    }
                }
            }
            .navigationTitle(greenhouse == nil ? "Nouvelle serre" : "Modifier la serre")
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
                guard let greenhouse else { return }
                name = greenhouse.name
                tempMin = greenhouse.targetTemperatureMin.map { String($0) } ?? ""
                tempMax = greenhouse.targetTemperatureMax.map { String($0) } ?? ""
                humidityMin = greenhouse.targetHumidityMin.map { String($0) } ?? ""
                humidityMax = greenhouse.targetHumidityMax.map { String($0) } ?? ""
                lightMin = greenhouse.targetLightMin.map { String($0) } ?? ""
                lightMax = greenhouse.targetLightMax.map { String($0) } ?? ""
                climateControlEnabled = greenhouse.climateControlEnabled
                temperatureSensor = greenhouse.temperatureSensor
                humiditySensor = greenhouse.humiditySensor
                lightSensor = greenhouse.lightSensor
                heaterDevice = greenhouse.heaterDevice
                fanDevice = greenhouse.fanDevice
                misterDevice = greenhouse.misterDevice
                lightDevice = greenhouse.lightDevice
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
        let target = greenhouse ?? Greenhouse(name: name, garden: garden)
        target.name = name
        target.targetTemperatureMin = Double(tempMin.replacingOccurrences(of: ",", with: "."))
        target.targetTemperatureMax = Double(tempMax.replacingOccurrences(of: ",", with: "."))
        target.targetHumidityMin = Double(humidityMin.replacingOccurrences(of: ",", with: "."))
        target.targetHumidityMax = Double(humidityMax.replacingOccurrences(of: ",", with: "."))
        target.targetLightMin = Double(lightMin.replacingOccurrences(of: ",", with: "."))
        target.targetLightMax = Double(lightMax.replacingOccurrences(of: ",", with: "."))
        target.climateControlEnabled = climateControlEnabled
        target.temperatureSensor = temperatureSensor
        target.humiditySensor = humiditySensor
        target.lightSensor = lightSensor
        target.heaterDevice = heaterDevice
        target.fanDevice = fanDevice
        target.misterDevice = misterDevice
        target.lightDevice = lightDevice
        if target.syncStatus == .synced { target.syncStatus = .pendingUpdate }
        target.updatedAt = .now
        if greenhouse == nil {
            modelContext.insert(target)
            garden.greenhouses.append(target)
        }
        try? modelContext.save()
        dismiss()
    }

    private func delete() {
        guard let greenhouse else { return }
        DeletionService.delete(greenhouse, in: modelContext)
        try? modelContext.save()
        dismiss()
    }
}
