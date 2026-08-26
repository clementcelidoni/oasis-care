import SwiftUI
import SwiftData
import Supabase
import UserNotifications
import UIKit

struct SettingsView: View {
    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var authState = AuthState.shared
    @ObservedObject private var syncEngine = SyncEngine.shared

    @AppStorage(NotificationSettings.notificationsEnabledKey) private var notificationsEnabled = false
    @AppStorage(NotificationSettings.remindOverdueKey) private var remindOverdue = true

    @State private var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @State private var reminderTime = NotificationSettings.defaultReminderTimeToday()
    @State private var isPermissionDeniedAlertPresented = false
    @State private var isSignInPresented = false
    @State private var isSignOutConfirmationPresented = false
    @State private var isDeleteAccountConfirmationPresented = false
    @State private var isDeletingAccount = false
    @State private var deleteAccountError: String?

    var body: some View {
        Form {
            Section("Mon compte") {
                switch authState.status {
                case .authenticated:
                    if let email = authState.session?.user.email {
                        LabeledContent("E-mail", value: email)
                    }
                    Button("Se déconnecter", role: .destructive) {
                        isSignOutConfirmationPresented = true
                    }

                    Button("Supprimer mon compte", role: .destructive) {
                        deleteAccountError = nil
                        isDeleteAccountConfirmationPresented = true
                    }
                    .disabled(isDeletingAccount)

                    if isDeletingAccount {
                        HStack {
                            ProgressView()
                            Text("Suppression en cours…")
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let deleteAccountError {
                        Text(deleteAccountError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                case .guest, .loading:
                    Text("Non connecté — vos données restent uniquement sur cet appareil.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Se connecter par e-mail") {
                        isSignInPresented = true
                    }
                    .accessibilityIdentifier("settingsSignInButton")
                }
            }

            if case .authenticated = authState.status {
                cloudSection
            }

            Section {
                NavigationLink("Mon abonnement") {
                    SubscriptionSettingsView()
                }
            }

            Section {
                NavigationLink("Personnaliser l'accueil") {
                    DashboardCustomizationView()
                }
                NavigationLink("Maison connectée") {
                    FeatureGate(entitlement: .connectedGarden, featureName: "Maison connectée") {
                        MaisonConnecteeView()
                    }
                }
                NavigationLink("Modes intelligents") {
                    SmartModesView()
                }
            }

            Section {
                NavigationLink("Aide & Support") {
                    SupportView()
                }
            }

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
        .sheet(isPresented: $isSignInPresented) {
            EmailSignInView()
        }
        .confirmationDialog(
            "Se déconnecter ?",
            isPresented: $isSignOutConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button("Se déconnecter", role: .destructive) {
                Task { await authState.signOutClearingLocalData(context: modelContext) }
            }
            Button("Annuler", role: .cancel) {}
        } message: {
            if pendingSyncCount > 0 {
                Text("\(pendingSyncCount) élément\(pendingSyncCount > 1 ? "s" : "") en attente de synchronisation \(pendingSyncCount > 1 ? "seront perdus" : "sera perdu") si vous vous déconnectez maintenant. Le reste de vos données restera disponible sur votre compte, mais sera retiré de cet appareil.")
            } else {
                Text("Vos données resteront disponibles sur votre compte cloud, mais seront retirées de cet appareil.")
            }
        }
        .confirmationDialog(
            "Supprimer mon compte ?",
            isPresented: $isDeleteAccountConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button("Supprimer définitivement", role: .destructive) {
                Task { await deleteAccount() }
            }
            Button("Annuler", role: .cancel) {}
        } message: {
            // §12L: deleting the Oasis Care account can never cancel an
            // Apple subscription (only Apple/the user can do that) — a
            // subscribed user who isn't warned would keep being billed
            // with no account left to use it with.
            if EntitlementService.shared.snapshot.plan != .free {
                Text("Cela supprimera définitivement : vos jardins, vos végétaux, vos historiques, vos photos cloud et vos paramètres cloud. Cette action est irréversible.\n\nImportant : cela n'annule pas votre abonnement Apple, qui continuera à être facturé. Pour l'annuler, allez dans Réglages > [votre nom] > Abonnements sur votre iPhone.")
            } else {
                Text("Cela supprimera définitivement : vos jardins, vos végétaux, vos historiques, vos photos cloud et vos paramètres cloud. Cette action est irréversible.")
            }
        }
    }

    private func deleteAccount() async {
        isDeletingAccount = true
        deleteAccountError = nil
        do {
            try await AuthService.deleteAccount()
            await authState.signOutClearingLocalData(context: modelContext)
        } catch {
            deleteAccountError = error.localizedDescription
        }
        isDeletingAccount = false
    }

    private var cloudSection: some View {
        Section("Cloud") {
            HStack {
                Text("État")
                Spacer()
                Text(cloudStatusText)
                    .foregroundStyle(.secondary)
            }

            if let lastSyncedAt = syncEngine.lastSyncedAt {
                HStack {
                    Text("Dernière synchronisation")
                    Spacer()
                    Text(lastSyncedAt, format: .dateTime.day().month().hour().minute())
                        .foregroundStyle(.secondary)
                }
            }

            if let error = syncEngine.lastSyncError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Button("Synchroniser maintenant") {
                Task { await syncEngine.syncIfPossible(context: modelContext) }
            }
            .disabled(syncEngine.isSyncing)
            .accessibilityIdentifier("syncNowButton")
        }
    }

    private var cloudStatusText: String {
        if syncEngine.isSyncing {
            return "Synchronisation en cours…"
        }
        if pendingSyncCount > 0 {
            return "\(pendingSyncCount) élément\(pendingSyncCount > 1 ? "s" : "") en attente"
        }
        return "Synchronisé"
    }

    private var pendingSyncCount: Int {
        syncEngine.pendingCount(context: modelContext)
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
