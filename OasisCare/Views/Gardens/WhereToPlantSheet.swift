import SwiftData
import SwiftUI

/// Spec Phase 6H — "Où planter ? L'utilisateur choisit Ajouter
/// [espèce], puis Trouver un emplacement." Looks up a locally-cached
/// SpeciesProfile by name (Phase 3D's own cache) when one exists for
/// its exposure preference; falls back to manual sun-preference/adult-
/// size entry otherwise — never blocks the feature just because a
/// profile hasn't been generated for this species.
struct WhereToPlantSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var speciesName = ""
    @State private var matchedProfile: SpeciesProfile?
    @State private var manualSunPreference: SiteSuitabilityService.SunPreference?
    @State private var adultDiameterText = ""
    @State private var results: [SiteSuitabilityService.Result] = []
    @State private var hasSearched = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Espèce") {
                    TextField("ex. Strelitzia nicolai", text: $speciesName)
                        .onChange(of: speciesName) { _, newValue in lookupProfile(newValue) }
                    if let matchedProfile, let payload = matchedProfile.decodedPayload() {
                        Label("Profil trouvé : \(payload.commonName ?? matchedProfile.scientificName)", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.caption)
                    }
                }

                if matchedProfile == nil {
                    Section {
                        Picker("Exposition", selection: $manualSunPreference) {
                            Text("Non renseigné").tag(SiteSuitabilityService.SunPreference?.none)
                            Text("Plein soleil").tag(Optional(SiteSuitabilityService.SunPreference.fullSun))
                            Text("Mi-ombre").tag(Optional(SiteSuitabilityService.SunPreference.partialShade))
                            Text("Ombre").tag(Optional(SiteSuitabilityService.SunPreference.shade))
                        }
                    } header: {
                        Text("Préférences (si connues)")
                    } footer: {
                        Text("Sans profil d'espèce, l'exposition doit être renseignée manuellement pour être prise en compte.")
                    }
                }

                Section("Taille adulte estimée") {
                    HStack {
                        Text("Diamètre du houppier")
                        Spacer()
                        TextField("optionnel", text: $adultDiameterText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                        Text("m").foregroundStyle(.secondary)
                    }
                }

                Section {
                    Button("Trouver un emplacement") {
                        computeResults()
                    }
                    .disabled(engine.garden.areas.isEmpty)
                } footer: {
                    if engine.garden.areas.isEmpty {
                        Text("Dessinez d'abord au moins une zone dans le plan pour évaluer où planter.")
                    }
                }

                if hasSearched {
                    Section("Carte d'aptitude") {
                        ForEach(results, id: \.area.id) { result in
                            DisclosureGroup {
                                ForEach(result.reasons, id: \.self) { reason in
                                    Text(reason)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            } label: {
                                HStack {
                                    Image(systemName: result.area.areaType.icon)
                                        .foregroundStyle(result.area.areaType.color)
                                    Text(result.area.name.isEmpty ? result.area.areaType.label : result.area.name)
                                    Spacer()
                                    Text(result.level.label)
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(suitabilityColor(result.level).opacity(0.2), in: Capsule())
                                        .foregroundStyle(suitabilityColor(result.level))
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Où planter ?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }

    private func lookupProfile(_ name: String) {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else {
            matchedProfile = nil
            return
        }
        let normalized = SpeciesProfile.normalize(name)
        let descriptor = FetchDescriptor<SpeciesProfile>(predicate: #Predicate<SpeciesProfile> { $0.normalizedName == normalized })
        matchedProfile = try? modelContext.fetch(descriptor).first
    }

    private func computeResults() {
        let sunPreference: SiteSuitabilityService.SunPreference?
        if let matchedProfile, let payload = matchedProfile.decodedPayload() {
            sunPreference = SiteSuitabilityService.SunPreference.parse(payload.exposure?.sunlight)
        } else {
            sunPreference = manualSunPreference
        }
        let requirements = SiteSuitabilityService.PlantRequirements(
            sunPreference: sunPreference,
            adultCanopyDiameterMeters: Double(adultDiameterText.replacingOccurrences(of: ",", with: "."))
        )
        results = engine.garden.areas
            .map { SiteSuitabilityService.evaluate(area: $0, requirements: requirements, garden: engine.garden) }
            .sorted { $0.level > $1.level }
        hasSearched = true
    }

    private func suitabilityColor(_ level: SiteSuitabilityService.SuitabilityLevel) -> Color {
        switch level {
        case .verySuitable: return .green
        case .suitable: return .blue
        case .possible: return .orange
        case .notRecommended: return .red
        }
    }
}
