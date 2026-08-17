import SwiftUI
import SwiftData

/// Spec §34-40 — the connected-zone dashboard: live valve control (as
/// opposed to IrrigationZoneFormView, which only edits the zone's
/// configuration). Only reachable for zones with a linked valveDevice;
/// zones without one keep using the existing "Enregistrer un cycle"
/// manual-log flow from Phase 4D.
struct ConnectedIrrigationZoneView: View {
    var zone: IrrigationZone

    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var commandService = DeviceCommandService.shared
    @Query(sort: \AutomationRule.name) private var allRules: [AutomationRule]

    @State private var durationMinutes: Int
    @State private var beforeHumidity: Double?
    @State private var isStarting = false
    @State private var isStopping = false
    @State private var errorMessage: String?
    @State private var now = Date.now

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    init(zone: IrrigationZone) {
        self.zone = zone
        _durationMinutes = State(initialValue: zone.durationMinutes ?? 8)
    }

    private var activeValve: DeviceCommandService.ActiveValve? {
        zone.valveDevice.flatMap { commandService.activeValves[$0.id] }
    }

    private var scopedRule: AutomationRule? {
        allRules.first { $0.scopeZone?.id == zone.id }
    }

    private var estimatedLiters: Double {
        guard let flowRate = zone.flowRate else { return 0 }
        return IrrigationCalculator.zoneLitersUsed(flowRateLitersPerHour: flowRate, durationMinutes: durationMinutes)
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Vanne", value: zone.valveDevice?.name ?? "Aucune")
                if let pump = zone.pumpDevice {
                    LabeledContent("Pompe", value: pump.name)
                }
                if let soilSensor = zone.soilSensor {
                    LabeledContent("Capteur sol", value: "\(soilSensor.latestReading.map { "\(Int($0.value)) %" } ?? "—")")
                }
                LabeledContent("Débit", value: zone.flowRate.map { "\(Int($0)) \(zone.flowRateUnit)" } ?? "Non renseigné")
                LabeledContent("Mode", value: scopedRule?.mode.displayName ?? "Manuel")
            }

            if IrrigationController.hasUnexpectedFlow(zone) {
                Section {
                    Label("Débit d'eau inattendu", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    Text("Une consommation d'eau est détectée alors qu'aucun arrosage n'est actif ici. Vérifiez l'installation.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if let active = activeValve {
                liveSection(active)
            } else if let valve = zone.valveDevice {
                startSection(valve)
            } else {
                Section {
                    Text("Associez une vanne à cette zone (Modifier la zone) pour l'arroser directement depuis Oasis Care.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if !zone.events.isEmpty {
                Section("Historique récent") {
                    ForEach(zone.events.sorted { $0.date > $1.date }.prefix(5)) { event in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(event.date.formatted(.dateTime.day().month().hour().minute()))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(Int(event.measuredLiters ?? event.estimatedLiters)) L")
                                    .font(.subheadline.weight(.medium))
                            }
                            if let before = event.soilMoistureBefore, let after = event.soilMoistureAfter {
                                Text("Humidité : \(Int(before)) % → \(Int(after)) %")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle(zone.name)
        .navigationBarTitleDisplayMode(.inline)
        .onReceive(timer) { date in now = date }
    }

    @ViewBuilder
    private func startSection(_ valve: ConnectedDevice) -> some View {
        Section {
            Stepper("Durée : \(durationMinutes) min", value: $durationMinutes, in: 1...60)
            LabeledContent("Volume estimé", value: "\(Int(estimatedLiters)) L")
            Button {
                Task { await startWatering(valve) }
            } label: {
                if isStarting { ProgressView() } else { Text("Démarrer").frame(maxWidth: .infinity) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isStarting || !valve.online)
        } header: {
            Text("Arroser \(zone.name)")
        }
    }

    @ViewBuilder
    private func liveSection(_ active: DeviceCommandService.ActiveValve) -> some View {
        Section {
            let elapsed = now.timeIntervalSince(active.startedAt)
            Label("Arrosage en cours", systemImage: "drop.fill")
                .foregroundStyle(.blue)
            LabeledContent("Écoulé", value: formattedDuration(elapsed))
            if let flowRate = zone.flowRate {
                let liters = IrrigationCalculator.zoneLitersUsed(flowRateLitersPerHour: flowRate, durationMinutes: Int(elapsed / 60))
                LabeledContent("Volume estimé", value: "≈ \(Int(liters)) L")
            }
            if let soilSensor = zone.soilSensor {
                let currentValue = soilSensor.latestReading?.value
                LabeledContent("Humidité sol", value: "\(beforeHumidity.map { "\(Int($0)) %" } ?? "—") → \(currentValue.map { "\(Int($0)) %" } ?? "—")")
            }
            if IrrigationController.isPotentiallyIneffective(zone) {
                Label("Arrosage potentiellement inefficace — aucun débit détecté malgré la vanne ouverte", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            Button(role: .destructive) {
                Task { await stopWatering(elapsed: elapsed) }
            } label: {
                if isStopping { ProgressView() } else { Text("Arrêter").frame(maxWidth: .infinity) }
            }
            .disabled(isStopping)
        }
    }

    private func startWatering(_ valve: ConnectedDevice) async {
        isStarting = true
        errorMessage = nil
        beforeHumidity = zone.soilSensor?.latestReading?.value
        let result = await IrrigationController.startZone(zone, durationMinutes: durationMinutes, context: modelContext)
        if case .failure(let error) = result { errorMessage = error.localizedDescription }
        isStarting = false
    }

    private func stopWatering(elapsed: TimeInterval) async {
        isStopping = true
        await IrrigationController.stopZoneAndLog(zone, elapsedSeconds: elapsed, soilMoistureBefore: beforeHumidity, context: modelContext)
        beforeHumidity = nil
        isStopping = false
    }

    private func formattedDuration(_ interval: TimeInterval) -> String {
        let minutes = Int(interval) / 60
        let seconds = Int(interval) % 60
        return String(format: "%d min %02d sec", minutes, seconds)
    }
}
