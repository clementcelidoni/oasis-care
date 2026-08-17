import SwiftUI
import SwiftData

/// Spec §49-56 — read-only live readings plus manual control of
/// pump/filtration/UV. Deliberately no automatic mode (unlike
/// GreenhouseDashboardView's "Pilotage automatique"): §55 explicitly
/// warns against ever auto-triggering a refill, and the pump/filtration/
/// UV loop has no equivalent safe default behavior worth automating this
/// phase, so every actuator here stays manual-only.
struct PondDashboardView: View {
    var pond: Pond

    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var commandService = DeviceCommandService.shared
    @State private var isEditPresented = false
    @State private var isBusy = false

    var body: some View {
        Form {
            if pond.lowWaterAlert || pond.uvLampDue {
                Section {
                    if pond.lowWaterAlert {
                        Label("Niveau d'eau bas", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                    if pond.uvLampDue {
                        Label("Remplacement de la lampe UV recommandé", systemImage: "sun.dust.fill")
                            .foregroundStyle(.orange)
                    }
                }
            }

            Section("Relevés") {
                readingRow("Température de l'eau", sensor: pond.waterTemperatureSensor, target: rangeLabel(pond.targetTemperatureMin, pond.targetTemperatureMax, unit: "°C"))
                readingRow("Niveau d'eau", sensor: pond.waterLevelSensor, target: pond.targetWaterLevelPercent.map { "Cible : \(Int($0)) %" })
                readingRow("Débit", sensor: pond.flowSensor, target: nil)
                readingRow("pH", sensor: pond.phSensor, target: nil)
                readingRow("Conductivité", sensor: pond.conductivitySensor, target: nil)
            }

            actuatorSection("Pompe", device: pond.pumpDevice, capability: .pump)
            actuatorSection("Filtration", device: pond.filtrationDevice, capability: .filter)
            actuatorSection("Lampe UV", device: pond.uvDevice, capability: .uvSterilizer)

            if pond.lastFiltrationCleanedAt != nil || pond.uvLampInstalledAt != nil {
                Section("Entretien") {
                    if let date = pond.lastFiltrationCleanedAt {
                        LabeledContent("Dernier nettoyage", value: date.formatted(date: .abbreviated, time: .omitted))
                    }
                    if let date = pond.uvLampInstalledAt {
                        LabeledContent("Lampe UV installée le", value: date.formatted(date: .abbreviated, time: .omitted))
                    }
                }
            }
        }
        .navigationTitle(pond.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Modifier") { isEditPresented = true }
            }
        }
        .sheet(isPresented: $isEditPresented) {
            PondFormView(garden: pond.garden ?? Garden(name: ""), pond: pond)
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
