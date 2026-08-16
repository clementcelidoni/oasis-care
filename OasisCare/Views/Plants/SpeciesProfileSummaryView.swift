import SwiftUI

/// Read-only display of an AI-generated species profile (spec §34-39).
/// Deliberately not editable inline: SpeciesProfile is shared across
/// every user's exemplar of the same species (spec §36/§48), so letting
/// one user "correct" a field here would silently change what every
/// other user sees. What IS per-user and editable is the plant's own
/// data and its care schedules — see PlantFormView's suggested-program
/// section and the normal schedule editing already in PlantDetailView.
struct SpeciesProfileSummaryView: View {
    var payload: SpeciesProfilePayload

    var body: some View {
        Group {
            header

            group("Exposition", confidence: payload.confidence?.exposure) {
                row("Ensoleillement", sunlightLabel(payload.exposure?.sunlight))
                row("Recommandations", payload.exposure?.recommendations)
            }
            group("Arrosage", confidence: payload.confidence?.watering) {
                row("Besoin", levelLabel(payload.watering?.needLevel))
                row("Fréquence indicative", payload.watering?.frequencyIndicative)
                row("Laisser sécher entre deux arrosages", boolLabel(payload.watering?.letDrySoilBetweenWaterings))
                row("Sensibilité à l'excès d'eau", levelLabel(payload.watering?.overwateringSensitivity))
                row("Conseils saisonniers", payload.watering?.seasonalAdvice)
            }
            group("Humidité", confidence: payload.confidence?.humidity) {
                row("Humidité idéale", payload.humidity?.idealPercentRange)
                row("Tolérance à l'air sec", levelLabel(payload.humidity?.dryAirTolerance))
            }
            group("Température", confidence: payload.confidence?.temperature) {
                row("Minimale", celsius(payload.temperature?.minimumCelsius))
                row("Plage idéale", temperatureRange)
                row("Sensible au gel", boolLabel(payload.temperature?.frostSensitive))
            }
            group("Sol / substrat", confidence: payload.confidence?.soil) {
                row("Type recommandé", payload.soil?.recommendedType)
                row("pH indicatif", payload.soil?.phIndicative)
                row("Drainage", payload.soil?.drainage)
            }
            group("Fertilisation", confidence: payload.confidence?.fertilizing) {
                row("Besoin", levelLabel(payload.fertilizing?.needLevel))
                row("Fréquence indicative", payload.fertilizing?.frequencyIndicative)
                row("Période", payload.fertilizing?.period)
            }
            group("Croissance", confidence: payload.confidence?.growth) {
                row("Vitesse", growthSpeedLabel(payload.growth?.speed))
                row("Port", payload.growth?.habit)
                row("Taille adulte", payload.growth?.adultHeight)
            }
            group("Entretien", confidence: payload.confidence?.maintenance) {
                row("Taille", payload.maintenance?.pruning)
                row("Rempotage", payload.maintenance?.repotting)
                row("Période de repos", payload.maintenance?.restPeriod)
            }
            group("Santé", confidence: payload.confidence?.health) {
                row("Parasites fréquents", (payload.health?.commonPests ?? []).joined(separator: ", "))
                row("Maladies fréquentes", (payload.health?.commonDiseases ?? []).joined(separator: ", "))
            }
            group("Toxicité", confidence: payload.confidence?.toxicity) {
                row("Humains", payload.toxicity?.humanToxicity)
                row("Animaux domestiques", payload.toxicity?.petToxicity)
            }
            group("Multiplication", confidence: payload.confidence?.propagation) {
                row("Bouturage", boolLabel(payload.propagation?.cutting))
                row("Division", boolLabel(payload.propagation?.division))
                row("Semis", boolLabel(payload.propagation?.seed))
            }
        }
    }

    private var header: some View {
        HStack {
            Image(systemName: "sparkles")
                .foregroundStyle(.purple)
            Text("Suggestion Oasis AI")
                .font(.caption.weight(.medium))
                .foregroundStyle(.purple)
        }
    }

    @ViewBuilder
    private func group(_ title: String, confidence: String?, @ViewBuilder content: () -> some View) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 6) {
                content()
            }
            .padding(.top, 4)
        } label: {
            HStack {
                Text(title)
                Spacer()
                if let confidence {
                    Text(AIConfidence(rawValue: confidence)?.displayName ?? confidence)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private func row(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack(alignment: .top) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 140, alignment: .leading)
                Text(value)
                    .font(.caption)
                Spacer()
            }
        }
    }

    private var temperatureRange: String? {
        guard let min = payload.temperature?.idealMinCelsius, let max = payload.temperature?.idealMaxCelsius else { return nil }
        return "\(Int(min))–\(Int(max)) °C"
    }

    private func celsius(_ value: Double?) -> String? {
        value.map { "\(Int($0)) °C" }
    }

    private func boolLabel(_ value: Bool?) -> String? {
        guard let value else { return nil }
        return value ? "Oui" : "Non"
    }

    private func levelLabel(_ value: String?) -> String? {
        switch value {
        case "low": return "Faible"
        case "moderate": return "Modéré"
        case "high": return "Élevé"
        default: return value
        }
    }

    private func sunlightLabel(_ value: String?) -> String? {
        switch value {
        case "fullSun": return "Plein soleil"
        case "partialShade": return "Mi-ombre"
        case "shade": return "Ombre"
        case "indirectLight": return "Lumière indirecte"
        default: return value
        }
    }

    private func growthSpeedLabel(_ value: String?) -> String? {
        switch value {
        case "slow": return "Lente"
        case "moderate": return "Modérée"
        case "fast": return "Rapide"
        default: return value
        }
    }
}
