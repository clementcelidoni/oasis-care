import SwiftUI

/// Spec Phase 6F — hour slider (06:00-20:00, "le plan se met à jour"),
/// season mode, and the sun path (lever/midi/coucher) display. Shadows
/// themselves render on the canvas (OasisPlanView.drawShadows); this
/// sheet is purely the simulation's controls.
struct SunSimulationSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.dismiss) private var dismiss

    private var sunPath: (sunrise: Double?, solarNoon: Double, sunset: Double?)? {
        guard let latitude = engine.garden.latitude else { return nil }
        return SunExposureService.sunPath(latitude: latitude, date: engine.sunSimulationDate)
    }

    var body: some View {
        NavigationStack {
            Form {
                if engine.garden.latitude == nil {
                    Section {
                        Text("Renseignez la position du jardin (Modifier le jardin) pour activer la simulation solaire.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section {
                        Toggle("Afficher les ombres", isOn: $engine.isShowingShadows)
                    } footer: {
                        Text("Simulation estimée, basée sur la hauteur saisie pour chaque objet (maison, mur, serre, arbre, palmier).")
                    }

                    Section("Heure") {
                        HStack {
                            Text(Self.timeLabel(for: engine.sunSimulationHour))
                                .font(.title3.weight(.semibold))
                                .monospacedDigit()
                            Spacer()
                        }
                        Slider(value: $engine.sunSimulationHour, in: 6...20, step: 0.25)
                    }

                    Section("Saison") {
                        HStack {
                            ForEach(GardenSeason.allCases) { season in
                                Button(season.label) {
                                    if let latitude = engine.garden.latitude {
                                        engine.sunSimulationDate = season.representativeDate(latitude: latitude)
                                    }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        DatePicker("Date précise", selection: $engine.sunSimulationDate, displayedComponents: .date)
                    }

                    if let sunPath {
                        Section("Trajectoire solaire") {
                            LabeledContent("Lever", value: sunPath.sunrise.map { Self.timeLabel(for: $0) } ?? "—")
                            LabeledContent("Midi solaire", value: Self.timeLabel(for: sunPath.solarNoon))
                            LabeledContent("Coucher", value: sunPath.sunset.map { Self.timeLabel(for: $0) } ?? "—")
                        }
                    }
                }
            }
            .navigationTitle("Soleil et ombres")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }

    private static func timeLabel(for hour: Double) -> String {
        let totalMinutes = Int((hour * 60).rounded())
        let hours = (totalMinutes / 60) % 24
        let minutes = totalMinutes % 60
        return String(format: "%02d:%02d", hours, minutes)
    }
}
