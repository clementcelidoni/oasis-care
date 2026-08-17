import SwiftUI
import SwiftData

/// Spec §72/§75/§76 — Vacances/Hiver/Économie d'eau are standing
/// toggles the user controls here; Canicule/Gel (§73-74) aren't
/// configurable — they're detected automatically from the forecast
/// (SmartWateringService.heatwaveAlert/frostAlert) and shown directly
/// on the weather card when they apply.
struct SmartModesView: View {
    @Environment(\.modelContext) private var modelContext

    private var settings: SmartModeSettings {
        SmartModeService.settings(in: modelContext)
    }

    var body: some View {
        Form {
            Section {
                Toggle("Mode Vacances", isOn: boolBinding(\.vacationModeEnabled))
                if settings.vacationModeEnabled {
                    DatePicker("Du", selection: dateBinding(\.vacationStartDate, default: .now), displayedComponents: .date)
                    DatePicker(
                        "Au",
                        selection: dateBinding(\.vacationEndDate, default: .now.addingTimeInterval(7 * 86400)),
                        displayedComponents: .date
                    )
                }
            } header: {
                Text("Vacances")
            } footer: {
                Text("Pendant cette période, Oasis ne vous envoie que les alertes importantes ou critiques — la surveillance elle-même reste identique.")
            }

            Section {
                Toggle("Mode Hiver", isOn: boolBinding(\.winterModeEnabled))
            } footer: {
                Text("Affiche un rappel sur l'accueil pour penser à adapter arrosage, engrais, chauffage et éclairage à la saison — rien n'est changé automatiquement à votre place.")
            }

            Section {
                Toggle("Économie d'eau", isOn: boolBinding(\.waterSavingModeEnabled))
            } footer: {
                Text("Oasis propose de reporter l'arrosage dès une pluie plus faible que d'habitude (5 mm au lieu de 10 mm).")
            }
        }
        .navigationTitle("Modes intelligents")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func boolBinding(_ keyPath: ReferenceWritableKeyPath<SmartModeSettings, Bool>) -> Binding<Bool> {
        Binding(
            get: { settings[keyPath: keyPath] },
            set: { newValue in
                let target = settings
                target[keyPath: keyPath] = newValue
                target.markDirty()
                try? modelContext.save()
            }
        )
    }

    private func dateBinding(_ keyPath: ReferenceWritableKeyPath<SmartModeSettings, Date?>, default defaultValue: Date) -> Binding<Date> {
        Binding(
            get: { settings[keyPath: keyPath] ?? defaultValue },
            set: { newValue in
                let target = settings
                target[keyPath: keyPath] = newValue
                target.markDirty()
                try? modelContext.save()
            }
        )
    }
}
