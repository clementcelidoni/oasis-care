import SwiftUI
import SwiftData

/// Configures one AutomationCondition. `condition == nil` builds a new
/// (not-yet-inserted) one and hands it to `onSave`; editing an existing
/// one mutates it in place — the parent form owns insertion either way.
struct AutomationConditionEditSheet: View {
    var condition: AutomationCondition?
    var scopeGarden: Garden?
    var scopeZone: GardenZone?
    var scopePlant: Plant?
    var onSave: (AutomationCondition) -> Void

    @Environment(\.dismiss) private var dismiss
    @Query private var allSensors: [Sensor]
    @Query private var allDevices: [ConnectedDevice]

    @State private var type: AutomationConditionType = .soilMoistureBelow
    @State private var numericThreshold = ""
    @State private var hoursThreshold = ""
    @State private var startHour = 5
    @State private var endHour = 9
    @State private var selectedDays: Set<Int> = []
    @State private var selectedSensor: Sensor?
    @State private var selectedDevice: ConnectedDevice?

    private var scopedSensors: [Sensor] {
        if let scopePlant { return scopePlant.sensors }
        if let scopeZone { return scopeZone.sensors }
        if let scopeGarden { return scopeGarden.sensors }
        return allSensors
    }

    private var scopedDevices: [ConnectedDevice] {
        if let scopeZone { return scopeZone.connectedDevices }
        if let scopeGarden { return scopeGarden.connectedDevices }
        return allDevices
    }

    private let weekdaySymbols = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Condition", selection: $type) {
                        ForEach(AutomationConditionType.allCases) { type in
                            Text(type.displayName).tag(type)
                        }
                    }
                }

                if type.usesNumericThreshold {
                    Section {
                        TextField(placeholderUnit, text: $numericThreshold)
                            .keyboardType(.decimalPad)
                    }
                }

                if type == .lastWateringOlderThan {
                    Section {
                        TextField("Heures", text: $hoursThreshold)
                            .keyboardType(.decimalPad)
                    }
                }

                if type == .timeBetween {
                    Section {
                        Stepper("De \(startHour) h", value: $startHour, in: 0...23)
                        Stepper("À \(endHour) h", value: $endHour, in: 0...23)
                    }
                }

                if type == .dayOfWeek {
                    Section {
                        HStack {
                            ForEach(1...7, id: \.self) { day in
                                Button {
                                    if selectedDays.contains(day) { selectedDays.remove(day) } else { selectedDays.insert(day) }
                                } label: {
                                    Text(weekdaySymbols[day - 1])
                                        .font(.caption.weight(.medium))
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 6)
                                        .background(
                                            selectedDays.contains(day) ? Color.accentColor.opacity(0.2) : Color(.tertiarySystemFill),
                                            in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }

                if type.usesSensor {
                    Section("Capteur") {
                        Picker("Capteur", selection: $selectedSensor) {
                            Text("N'importe lequel dans la portée (moyenne)").tag(Sensor?.none)
                            ForEach(scopedSensors) { sensor in Text(sensor.name).tag(Sensor?.some(sensor)) }
                        }
                    }
                }

                if type == .deviceOnline {
                    Section("Équipement") {
                        Picker("Équipement", selection: $selectedDevice) {
                            Text("Aucun").tag(ConnectedDevice?.none)
                            ForEach(scopedDevices) { device in Text(device.name).tag(ConnectedDevice?.some(device)) }
                        }
                    }
                }
            }
            .navigationTitle("Condition")
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
                guard let condition else { return }
                type = condition.type
                numericThreshold = condition.numericThreshold.map { String($0) } ?? ""
                hoursThreshold = condition.hoursThreshold.map { String($0) } ?? ""
                if let start = condition.timeRangeStartMinutes { startHour = start / 60 }
                if let end = condition.timeRangeEndMinutes { endHour = end / 60 }
                selectedDays = Set(condition.daysOfWeek)
                selectedSensor = condition.sensor
                selectedDevice = condition.device
            }
        }
    }

    private var placeholderUnit: String {
        switch type {
        case .soilMoistureBelow, .soilMoistureAbove, .humidityBelow, .humidityAbove: return "Pourcentage (%)"
        case .temperatureBelow, .temperatureAbove: return "Température (°C)"
        case .rainForecastBelow, .rainForecastAbove: return "Pluie (mm)"
        default: return "Valeur"
        }
    }

    private func save() {
        let target = condition ?? AutomationCondition(type: type)
        target.type = type
        target.numericThreshold = Double(numericThreshold.replacingOccurrences(of: ",", with: "."))
        target.hoursThreshold = Double(hoursThreshold.replacingOccurrences(of: ",", with: "."))
        target.timeRangeStartMinutes = type == .timeBetween ? startHour * 60 : nil
        target.timeRangeEndMinutes = type == .timeBetween ? endHour * 60 : nil
        target.daysOfWeek = Array(selectedDays)
        target.sensor = selectedSensor
        target.device = selectedDevice
        onSave(target)
        dismiss()
    }
}
