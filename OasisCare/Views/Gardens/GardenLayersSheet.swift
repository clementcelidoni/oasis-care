import SwiftUI

/// Spec Phase 6E — "bouton Calques" + layer toggles/opacity + preset
/// profiles. Consommation d'eau is deliberately a data summary here
/// rather than a spatial heatmap: it would need GardenArea (6C's drawn
/// zones) linked to IrrigationZone (Phase 4D's water-tracking zones) to
/// place volumes on the plan, and nothing ties those two, separate
/// zone concepts together today — showing the real numbers in a list
/// is honest; inventing a spatial mapping between them wouldn't be.
struct GardenLayersSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var isShowingPlanImageSheet = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Plan importé") {
                    if let planImage = engine.garden.planImage {
                        Toggle("Afficher le plan importé", isOn: Binding(
                            get: { planImage.isVisible },
                            set: { planImage.isVisible = $0 }
                        ))
                        if planImage.isCalibrated {
                            HStack {
                                Image(systemName: "circle.lefthalf.filled")
                                    .foregroundStyle(.secondary)
                                Slider(value: Binding(
                                    get: { planImage.opacity },
                                    set: { engine.setPlanImageOpacity($0) }
                                ), in: 0.1...1)
                            }
                            Button("Réaligner") { engine.isAligningPlanImage = true; dismiss() }
                        } else {
                            Button("Terminer la calibration") { isShowingPlanImageSheet = true }
                        }
                        Button("Supprimer le plan importé", role: .destructive) {
                            engine.removePlanImage(context: modelContext)
                        }
                    } else {
                        Button("Importer un plan") { isShowingPlanImageSheet = true }
                    }
                }

                Section("Profils") {
                    ForEach(GardenMapLayerProfile.allCases) { profile in
                        Button(profile.label) {
                            engine.applyLayerProfile(profile)
                        }
                    }
                }

                Section("Calques") {
                    ForEach(GardenMapLayer.allCases) { layer in
                        VStack(alignment: .leading, spacing: 6) {
                            Toggle(isOn: Binding(
                                get: { engine.visibleLayers.contains(layer) },
                                set: { _ in engine.toggleLayer(layer) }
                            )) {
                                Label(layer.label, systemImage: layer.icon)
                            }
                            if layer.supportsOpacity, engine.visibleLayers.contains(layer) {
                                HStack {
                                    Image(systemName: "circle.lefthalf.filled")
                                        .foregroundStyle(.secondary)
                                    Slider(value: Binding(
                                        get: { engine.opacity(for: layer) },
                                        set: { engine.setOpacity($0, for: layer) }
                                    ), in: 0.2...1)
                                }
                            }
                            if layer == .satelliteBackground, engine.visibleLayers.contains(layer) {
                                satelliteBackgroundStatusRow
                            }
                        }
                    }
                }

                if !waterConsumptionRows.isEmpty {
                    Section("Consommation d'eau par zone") {
                        ForEach(waterConsumptionRows) { row in
                            HStack {
                                Text(row.name)
                                Spacer()
                                Text("\(Int(row.todayLiters)) L aujourd'hui · \(Int(row.weekLiters)) L / 7 j")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Calques")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .sheet(isPresented: $isShowingPlanImageSheet) {
                GardenPlanImageSheet(engine: engine)
            }
        }
    }

    @ViewBuilder
    private var satelliteBackgroundStatusRow: some View {
        if engine.isLoadingSatelliteBackground {
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("Chargement de l'image satellite…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else if let error = engine.satelliteBackgroundError {
            VStack(alignment: .leading, spacing: 4) {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Réessayer") { engine.loadSatelliteBackgroundIfNeeded(force: true) }
                    .font(.caption)
            }
        } else if engine.satelliteBackground != nil {
            Button("Actualiser l'image satellite") { engine.loadSatelliteBackgroundIfNeeded(force: true) }
                .font(.caption)
        }
    }

    private struct ZoneConsumptionRow: Identifiable {
        var id: UUID
        var name: String
        var todayLiters: Double
        var weekLiters: Double
    }

    private var waterConsumptionRows: [ZoneConsumptionRow] {
        engine.garden.irrigationZones.map { zone in
            let stats = IrrigationStatsService.stats(events: zone.events)
            return ZoneConsumptionRow(id: zone.id, name: zone.name, todayLiters: stats.todayLiters, weekLiters: stats.weekLiters)
        }
    }
}
