import SwiftUI
import SwiftData
import UserNotifications
import UIKit

struct SettingsView: View {
    @Environment(\.modelContext) private var modelContext

    @AppStorage(NotificationSettings.notificationsEnabledKey) private var notificationsEnabled = false
    @AppStorage(NotificationSettings.remindOverdueKey) private var remindOverdue = true

    @State private var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @State private var reminderTime = NotificationSettings.defaultReminderTimeToday()
    @State private var isPermissionDeniedAlertPresented = false

    var body: some View {
        Form {
            Section {
                Toggle("Rappels activés", isOn: notificationsBinding)
                    .accessibilityIdentifier("notificationsEnabledToggle")
            } footer: {
                Text(statusFooter)
            }

            if notificationsEnabled {
                Section("Heure par défaut") {
                    DatePicker("Heure de rappel", selection: reminderTimeBinding, displayedComponents: .hourAndMinute)
                }

                Section {
                    Toggle("Rappeler les tâches en retard", isOn: remindOverdueBinding)
                }
            }
        }
        .navigationTitle("Réglages")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            authorizationStatus = await NotificationService.authorizationStatus()
        }
        .alert("Notifications désactivées", isPresented: $isPermissionDeniedAlertPresented) {
            Button("Réglages iPhone") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button("Annuler", role: .cancel) {}
        } message: {
            Text("Autorisez les notifications pour Oasis Care dans Réglages pour recevoir vos rappels.")
        }
    }

    private var statusFooter: String {
        switch authorizationStatus {
        case .denied:
            return "Les notifications sont bloquées pour Oasis Care au niveau du système. Activez-les dans Réglages iPhone."
        case .authorized, .provisional, .ephemeral:
            return "Autorisation système accordée."
        default:
            return "Reçois des rappels d'arrosage, d'engrais et plus, à l'heure de ton choix."
        }
    }

    private var notificationsBinding: Binding<Bool> {
        Binding(
            get: { notificationsEnabled },
            set: { newValue in
                guard newValue else {
                    notificationsEnabled = false
                    NotificationService.cancelAll()
                    return
                }
                Task {
                    let granted = await NotificationService.requestAuthorization()
                    authorizationStatus = await NotificationService.authorizationStatus()
                    notificationsEnabled = granted
                    if granted {
                        NotificationService.rescheduleAll(context: modelContext)
                    } else {
                        isPermissionDeniedAlertPresented = true
                    }
                }
            }
        )
    }

    private var reminderTimeBinding: Binding<Date> {
        Binding(
            get: { reminderTime },
            set: { newValue in
                reminderTime = newValue
                let components = Calendar.current.dateComponents([.hour, .minute], from: newValue)
                UserDefaults.standard.set(components.hour ?? NotificationSettings.defaultHour, forKey: NotificationSettings.defaultReminderHourKey)
                UserDefaults.standard.set(components.minute ?? NotificationSettings.defaultMinute, forKey: NotificationSettings.defaultReminderMinuteKey)
                NotificationService.rescheduleAll(context: modelContext)
            }
        )
    }

    private var remindOverdueBinding: Binding<Bool> {
        Binding(
            get: { remindOverdue },
            set: { newValue in
                remindOverdue = newValue
                NotificationService.rescheduleAll(context: modelContext)
            }
        )
    }
}
