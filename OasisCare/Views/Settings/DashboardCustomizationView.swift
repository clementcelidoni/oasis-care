import SwiftUI
import SwiftData

/// "Personnaliser l'accueil" (spec §14). Reordering is explicitly
/// hedged in the spec ("si raisonnable") — only visibility toggles are
/// implemented; section order stays fixed.
struct DashboardCustomizationView: View {
    @Environment(\.modelContext) private var modelContext

    private var preferences: DashboardPreferences {
        DashboardService.preferences(in: modelContext)
    }

    var body: some View {
        Form {
            Section {
                toggle("Aujourd'hui", isOn: bindingFor(\.showToday))
                toggle("Alertes", isOn: bindingFor(\.showAlerts))
                toggle("Météo", isOn: bindingFor(\.showWeather))
                toggle("Oasis AI", isOn: bindingFor(\.showOasisAI))
                toggle("Eau", isOn: bindingFor(\.showWater))
                toggle("Activité récente", isOn: bindingFor(\.showRecentActivity))
                toggle("Prochainement", isOn: bindingFor(\.showUpcoming))
                toggle("Santé", isOn: bindingFor(\.showHealth))
                toggle("Évolution", isOn: bindingFor(\.showEvolution))
                toggle("Maison connectée", isOn: bindingFor(\.showConnectedHome))
                toggle("Anomalies", isOn: bindingFor(\.showDeviceHealth))
            } footer: {
                Text("Désactivez les sections qui ne vous intéressent pas. L'ordre reste celui par défaut.")
            }
        }
        .navigationTitle("Personnaliser l'accueil")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func toggle(_ title: String, isOn: Binding<Bool>) -> some View {
        Toggle(title, isOn: isOn)
    }

    private func bindingFor(_ keyPath: ReferenceWritableKeyPath<DashboardPreferences, Bool>) -> Binding<Bool> {
        Binding(
            get: { preferences[keyPath: keyPath] },
            set: { newValue in
                let prefs = preferences
                prefs[keyPath: keyPath] = newValue
                prefs.markDirty()
            }
        )
    }
}
