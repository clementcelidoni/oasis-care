import SwiftData
import SwiftUI

/// Spec Phase 6L — "QUESTIONS... RÉPONSE VISUELLE" and "MODE DESIGN DU
/// JARDIN... Imaginer un aménagement." Two modes sharing one sheet
/// since both are "ask Oasis AI something about the map" — the
/// difference is just what comes back: a free-form answer with
/// optional zone highlights, or a species proposal for one chosen
/// zone. Dismissing this sheet clears any AI highlight/preview left on
/// the canvas (see .onDisappear) so nothing purple lingers once the
/// user has moved on.
struct GardenMapAIQuerySheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    private enum Mode: String, CaseIterable, Identifiable {
        case query, design
        var id: String { rawValue }
        var label: String {
            switch self {
            case .query: return "Question"
            case .design: return "Imaginer"
            }
        }
    }

    @State private var mode: Mode = .query
    @State private var questionText = ""
    @State private var designPrompt = ""
    @State private var selectedZoneID: UUID?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var answer: String?
    @State private var recommendedAreas: [GardenMapAIService.RecommendedArea] = []
    @State private var designProposal: GardenMapAIService.DesignProposal?

    private var zones: [GardenArea] { engine.garden.areas }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases) { m in Text(m.label).tag(m) }
                    }
                    .pickerStyle(.segmented)
                }

                if mode == .query {
                    queryContent
                } else {
                    designContent
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Oasis AI — Jardin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
        .onDisappear { engine.clearAIPreview() }
    }

    @ViewBuilder
    private var queryContent: some View {
        Section {
            TextField("ex. Où puis-je planter un bananier ?", text: $questionText, axis: .vertical)
                .lineLimit(2...4)
            Button {
                Task { await askQuestion() }
            } label: {
                if isLoading { ProgressView() } else { Text("Demander à Oasis") }
            }
            .disabled(isLoading || questionText.trimmingCharacters(in: .whitespaces).isEmpty)
        } footer: {
            Text("Oasis s'appuie sur les zones déjà dessinées sur ce plan (géométrie, végétaux, ensoleillement estimé, arrosage, tâches). Une réponse peut mettre en évidence une ou plusieurs zones sur la carte.")
        }

        if let answer {
            Section("Réponse") {
                Text(answer)
            }
        }

        if !recommendedAreas.isEmpty {
            Section("Zones recommandées") {
                ForEach(recommendedAreas) { recommendation in
                    Button {
                        highlightZone(recommendation.zoneId)
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(zoneName(for: recommendation.zoneId))
                                    .foregroundStyle(.primary)
                                Spacer()
                                Text("\(recommendation.score)/100")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.purple)
                            }
                            ForEach(recommendation.reasons, id: \.self) { reason in
                                Text("• \(reason)").font(.caption).foregroundStyle(.secondary)
                            }
                            ForEach(recommendation.warnings, id: \.self) { warning in
                                Label(warning, systemImage: "exclamationmark.triangle.fill")
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var designContent: some View {
        Section {
            Picker("Zone cible", selection: $selectedZoneID) {
                Text("Choisir une zone").tag(UUID?.none)
                ForEach(zones) { zone in
                    Text(zone.name.isEmpty ? zone.areaType.label : zone.name).tag(Optional(zone.id))
                }
            }
            TextField("ex. Je veux un massif tropical dans cette zone", text: $designPrompt, axis: .vertical)
                .lineLimit(2...4)
            Button {
                Task { await imagineDesign() }
            } label: {
                if isLoading { ProgressView() } else { Text("Imaginer un aménagement") }
            }
            .disabled(isLoading || selectedZoneID == nil || designPrompt.trimmingCharacters(in: .whitespaces).isEmpty)
        } footer: {
            Text("Oasis propose des espèces adaptées à la zone choisie, jamais leur emplacement exact — vous validez toujours avant qu'un végétal ne soit réellement ajouté au plan.")
        }

        if let designProposal {
            Section("Espèces proposées") {
                ForEach(designProposal.speciesNames, id: \.self) { name in
                    Text(name)
                }
                if !designProposal.notes.isEmpty {
                    Text(designProposal.notes).font(.caption).foregroundStyle(.secondary)
                }
            }

            Section {
                if engine.aiProposedPlacements.isEmpty {
                    Button("Aperçu sur le plan") { previewPlacements(designProposal) }
                } else {
                    Text("Aperçu affiché sur le plan — \(engine.aiProposedPlacements.count) emplacement(s).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Confirmer et ajouter au plan") {
                        engine.confirmAIProposedPlacements(context: modelContext)
                        dismiss()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private func zoneName(for zoneId: String) -> String {
        guard let uuid = UUID(uuidString: zoneId), let zone = zones.first(where: { $0.id == uuid }) else { return "Zone inconnue" }
        return zone.name.isEmpty ? zone.areaType.label : zone.name
    }

    private func highlightZone(_ zoneId: String) {
        guard let uuid = UUID(uuidString: zoneId) else { return }
        engine.setAIHighlightedZones([uuid])
    }

    private func askQuestion() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let context = GardenDigitalTwinAIContext.build(engine: engine, weather: currentWeatherSummary())
            let result = try await GardenMapAIService.ask(questionText, context: context)
            answer = result.answer
            recommendedAreas = result.recommendedAreas
            let realZoneIDs = Set(result.recommendedAreas.compactMap { UUID(uuidString: $0.zoneId) })
            engine.setAIHighlightedZones(realZoneIDs)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func imagineDesign() async {
        guard let selectedZoneID else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let context = GardenDigitalTwinAIContext.build(engine: engine, weather: currentWeatherSummary())
            designProposal = try await GardenMapAIService.imagineDesign(prompt: designPrompt, zoneId: selectedZoneID.uuidString, context: context)
            engine.setAIHighlightedZones([selectedZoneID])
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Real, already-cached data only (no network call from here) —
    /// temperature when a fetch has actually succeeded for this garden,
    /// nil otherwise. No condition string: WeatherData only carries a
    /// numeric conditionCode, and this app has no French-language
    /// lookup table for it yet, so it's left out rather than guessed.
    private func currentWeatherSummary() -> GardenAIContext.WeatherSummary? {
        guard let data = WeatherCache.load(for: engine.garden.id) else { return nil }
        return GardenAIContext.WeatherSummary(temperatureCelsius: data.temperatureCelsius, condition: nil)
    }

    private func previewPlacements(_ proposal: GardenMapAIService.DesignProposal) {
        guard let selectedZoneID, let zone = zones.first(where: { $0.id == selectedZoneID }) else { return }
        let positions = engine.proposedPositions(count: proposal.speciesNames.count, inArea: zone)
        let placements = zip(proposal.speciesNames, positions).map { name, position in
            GardenMapEngine.AIProposedPlacement(label: name, position: position)
        }
        engine.setAIProposedPlacements(placements)
    }
}
