import SwiftUI
import SwiftData

struct ConfigureScheduleSheet: View {
    var plant: Plant
    var type: CareEventType

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var frequencyDays: Int
    @State private var isActive: Bool
    @State private var reminderEnabled: Bool
    @State private var preferredTime: Date

    init(plant: Plant, type: CareEventType) {
        self.plant = plant
        self.type = type
        let existing = plant.schedule(for: type)
        _frequencyDays = State(initialValue: existing?.frequencyDays ?? 7)
        _isActive = State(initialValue: existing?.isActive ?? true)
        _reminderEnabled = State(initialValue: existing?.reminderEnabled ?? true)
        _preferredTime = State(initialValue: existing?.preferredTime ?? NotificationSettings.defaultReminderTimeToday())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Rappel actif", isOn: $isActive)
                }

                Section("Fréquence") {
                    Stepper(value: $frequencyDays, in: 1...365) {
                        HStack {
                            Text("Tous les")
                            Spacer()
                            Text("\(frequencyDays) jour\(frequencyDays > 1 ? "s" : "")")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if isActive {
                    Section("Notification") {
                        Toggle("Recevoir une notification", isOn: $reminderEnabled)
                        if reminderEnabled {
                            DatePicker("Heure", selection: $preferredTime, displayedComponents: .hourAndMinute)
                        }
                    }
                }

                if let schedule = plant.schedule(for: type), let last = schedule.lastCompletedDate {
                    Section("Dernière fois") {
                        Text(DateFormatting.shortDate(last))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle(type.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                }
            }
        }
    }

    private func save() {
        CareScheduleEngine.setSchedule(
            type,
            frequencyDays: frequencyDays,
            preferredTime: preferredTime,
            reminderEnabled: reminderEnabled,
            for: plant,
            in: modelContext
        )
        if !isActive {
            CareScheduleEngine.deactivateSchedule(type, for: plant)
        }
        dismiss()
    }
}
