import SwiftUI
import SwiftData
import Charts

/// Manual reading entry (spec §14's "Humidité actuelle : 32 %") plus a
/// simple history chart. Device-sourced sensors don't get a manual-entry
/// field — their values arrive from HomeKitService (Phase 5C wires the
/// actual polling); this sheet still shows their history either way.
struct SensorDetailSheet: View {
    var sensor: Sensor

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    @State private var newValue = ""
    @State private var isEditPresented = false

    private var sortedReadings: [SensorReading] {
        sensor.readings.sorted { $0.timestamp > $1.timestamp }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Type", value: sensor.type.displayName)
                    LabeledContent("Source", value: sensor.source.displayName)
                    if let device = sensor.device {
                        LabeledContent("Équipement", value: device.name)
                    }
                    if let latest = sensor.latestReading {
                        LabeledContent("Dernière valeur", value: "\(latest.value.formatted()) \(sensor.unit)")
                    }
                }

                if sensor.source == .manual {
                    Section("Enregistrer une mesure") {
                        HStack {
                            TextField("Valeur", text: $newValue)
                                .keyboardType(.decimalPad)
                            Text(sensor.unit)
                                .foregroundStyle(.secondary)
                            Button("Ajouter") { addReading() }
                                .disabled(Double(newValue.replacingOccurrences(of: ",", with: ".")) == nil)
                        }
                    }
                }

                if sortedReadings.count > 1 {
                    Section("Historique") {
                        Chart(sortedReadings.reversed()) { reading in
                            LineMark(x: .value("Date", reading.timestamp), y: .value(sensor.unit, reading.value))
                        }
                        .frame(height: 160)
                    }
                }

                if !sortedReadings.isEmpty {
                    Section {
                        ForEach(sortedReadings.prefix(20)) { reading in
                            HStack {
                                Text(reading.timestamp.formatted(.dateTime.day().month().hour().minute()))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Spacer()
                                Text("\(reading.value.formatted()) \(reading.unit)")
                                    .font(.subheadline)
                                if reading.quality != .good {
                                    Image(systemName: "exclamationmark.circle")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(sensor.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Modifier") { isEditPresented = true }
                }
            }
            .sheet(isPresented: $isEditPresented) {
                SensorFormSheet(plant: sensor.plant, zone: sensor.zone, garden: sensor.garden, sensor: sensor)
            }
        }
    }

    private func addReading() {
        guard let value = Double(newValue.replacingOccurrences(of: ",", with: ".")) else { return }
        let reading = SensorReading(sensor: sensor, value: value, unit: sensor.unit, source: .manual)
        modelContext.insert(reading)
        sensor.readings.append(reading)
        if sensor.syncStatus == .synced { sensor.syncStatus = .pendingUpdate }
        try? modelContext.save()
        newValue = ""
        Haptics.success()
    }
}
