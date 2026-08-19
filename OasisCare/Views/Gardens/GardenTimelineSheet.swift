import SwiftUI

/// Spec Phase 6G — "GardenTimeline... curseur 2026 — 2036." Negative
/// offset = mode passé (reconstructed from real PlantMeasurement/
/// dateAdded history), positive = mode futur (GrowthSimulationService's
/// projection), always labeled "Estimation" per spec's own requirement.
struct GardenTimelineSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.dismiss) private var dismiss

    private var targetYear: Int {
        Calendar.current.component(.year, from: .now) + Int(engine.timelineYearOffset.rounded())
    }

    private var collisionWarnings: [GrowthSimulationService.CollisionWarning] {
        engine.timelineCollisionWarnings()
    }

    private var proximityWarnings: [GrowthSimulationService.ProximityWarning] {
        engine.timelineProximityWarnings()
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text(String(targetYear))
                            .font(.title2.weight(.bold))
                            .monospacedDigit()
                        Spacer()
                        if engine.timelineYearOffset != 0 {
                            Text(engine.timelineYearOffset < 0 ? "Passé" : "Estimation")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(engine.timelineYearOffset < 0 ? Color.secondary.opacity(0.2) : Color.orange.opacity(0.2), in: Capsule())
                        }
                    }
                    Slider(value: $engine.timelineYearOffset, in: -5...10, step: 1)
                    Button("Revenir à aujourd'hui") { engine.timelineYearOffset = 0 }
                        .disabled(engine.timelineYearOffset == 0)
                } footer: {
                    Text("Mode passé : reconstitué à partir des mesures et dates d'ajout enregistrées, quand elles existent. Mode futur : simulation de croissance estimée, pas une mesure.")
                }

                if engine.timelineYearOffset > 0 {
                    if !collisionWarnings.isEmpty {
                        Section("Chevauchements possibles") {
                            ForEach(Array(collisionWarnings.enumerated()), id: \.offset) { _, warning in
                                Label(
                                    "Ces deux végétaux pourraient se chevaucher fortement à maturité (\(String(format: "%.1f", warning.overlapMeters)) m).",
                                    systemImage: "exclamationmark.triangle.fill"
                                )
                                .font(.subheadline)
                                .foregroundStyle(.orange)
                            }
                        }
                    }
                    if !proximityWarnings.isEmpty {
                        Section("Proximité des constructions") {
                            ForEach(Array(proximityWarnings.enumerated()), id: \.offset) { _, warning in
                                Label(
                                    "Taille adulte estimée proche d'une construction (dégagement estimé \(String(format: "%.1f", warning.clearanceMeters)) m).",
                                    systemImage: "exclamationmark.triangle.fill"
                                )
                                .font(.subheadline)
                                .foregroundStyle(.orange)
                            }
                        } footer: {
                            Text("Signal indicatif seulement — pas une recommandation structurelle (risque pour les fondations, etc.).")
                        }
                    }
                }
            }
            .navigationTitle("Voyage dans le temps")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }
}
