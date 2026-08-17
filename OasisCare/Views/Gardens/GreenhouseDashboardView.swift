import SwiftUI
import SwiftData

/// Spec §42 — read-only live readings plus manual overrides for each
/// actuator; automatic climate control (when enabled) runs via
/// GreenhouseClimateService on the same foreground cadence as
/// AutomationEngine (HomeView.task) — this view triggers one
/// evaluation on appear too, so opening it reflects the latest state
/// rather than waiting for the next dashboard load.
struct GreenhouseDashboardView: View {
    var greenhouse: Greenhouse

    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var commandService = DeviceCommandService.shared
    @State private var isEditPresented = false
    @State private var isBusy = false

    var body: some View {
        Form {
            Section("Relevés") {
                readingRow("Température", sensor: greenhouse.temperatureSensor, target: rangeLabel(greenhouse.targetTemperatureMin, greenhouse.targetTemperatureMax, unit: "°C"))
                readingRow("Humidité", sensor: greenhouse.humiditySensor, target: rangeLabel(greenhouse.targetHumidityMin, greenhouse.targetHumidityMax, unit: "%"))
                readingRow("Luminosité", sensor: greenhouse.lightSensor, target: rangeLabel(greenhouse.targetLightMin, greenhouse.targetLightMax, unit: "lux"))
                if let soilSensor = greenhouse.soilSensor {
                    readingRow("Sol", sensor: soilSensor, target: nil)
                }
            }

            Section {
                Toggle("Pilotage automatique", isOn: Binding(
                    get: { greenhouse.climateControlEnabled },
                    set: { newValue in
                        greenhouse.climateControlEnabled = newValue
                        greenhouse.markDirty()
                        try? modelContext.save()
                    }
                ))
            }

            actuatorSection("Chauffage", device: greenhouse.heaterDevice, capability: .heater)
            actuatorSection("Ventilation", device: greenhouse.fanDevice, capability: .fan)
            actuatorSection("Brumisation", device: greenhouse.misterDevice, capability: .mister)
            actuatorSection("Éclairage", device: greenhouse.lightDevice, capability: .light)
        }
        .navigationTitle(greenhouse.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Modifier") { isEditPresented = true }
            }
        }
        .sheet(isPresented: $isEditPresented) {
            GreenhouseFormView(garden: greenhouse.garden ?? Garden(name: ""), greenhouse: greenhouse)
        }
        .task {
            await GreenhouseClimateService.evaluate(greenhouse, context: modelContext)
        }
    }

    private func readingRow(_ title: String, sensor: Sensor?, target: String?) -> some View {
        HStack {
            Text(title)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                if let reading = sensor?.latestReading {
                    Text("\(reading.value.formatted()) \(sensor?.unit ?? "")")
                        .foregroundStyle(.primary)
                } else {
                    Text("—")
                        .foregroundStyle(.secondary)
                }
                if let target {
                    Text(target)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func rangeLabel(_ min: Double?, _ max: Double?, unit: String) -> String? {
        guard min != nil || max != nil else { return nil }
        return "Cible : \(min.map { Int($0).description } ?? "?")–\(max.map { Int($0).description } ?? "?") \(unit)"
    }

    @ViewBuilder
    private func actuatorSection(_ title: String, device: ConnectedDevice?, capability: DeviceCapability) -> some View {
        if let device {
            Section(title) {
                HStack {
                    Text(device.currentState ?? "État inconnu")
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Marche") { Task { await setPower(device, on: true, capability: capability) } }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(isBusy || !device.online)
                    Button("Arrêt") { Task { await setPower(device, on: false, capability: capability) } }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(isBusy || !device.online)
                }
            }
        }
    }

    private func setPower(_ device: ConnectedDevice, on: Bool, capability: DeviceCapability) async {
        isBusy = true
        await commandService.setPower(device, on: on, capability: capability, context: modelContext)
        isBusy = false
    }
}
