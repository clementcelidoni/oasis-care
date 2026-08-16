import SwiftUI

// MARK: - Résumé global (spec §2)

struct GlobalSummaryCard: View {
    var plants: [Plant]

    private var healthy: [Plant] { plants.filter { $0.healthStatus == .healthy } }
    private var monitor: [Plant] { plants.filter { $0.healthStatus == .monitor } }
    private var attention: [Plant] { plants.filter { $0.healthStatus == .attention } }
    private var urgent: [Plant] { plants.filter { $0.healthStatus == .urgent } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: PlantCategoryFilter(title: "Tous les végétaux", plants: plants)) {
                HStack {
                    Text("Mon univers végétal")
                        .font(.headline)
                    Spacer()
                    Text("🌿 \(plants.count)")
                        .font(.subheadline.weight(.semibold))
                }
            }
            .buttonStyle(.plain)

            VStack(spacing: 6) {
                row("🟢", "en bon état", healthy, .green)
                row("🟡", "à surveiller", monitor, .yellow)
                row("🟠", "interventions", attention, .orange)
                row("🔴", "urgents", urgent, .red)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func row(_ dot: String, _ label: String, _ subset: [Plant], _ tint: Color) -> some View {
        NavigationLink(value: PlantCategoryFilter(title: label.capitalized, plants: subset)) {
            HStack {
                Text("\(dot) \(subset.count) \(label)")
                    .font(.subheadline)
                    .foregroundStyle(subset.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(tint))
                Spacer()
                if !subset.isEmpty {
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(subset.isEmpty)
    }
}

// MARK: - Score de santé (spec §3)

struct HealthScoreCard: View {
    var score: DashboardService.HealthScore

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Santé du jardin")
                .font(.headline)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(score.value)")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                Text("/ 100")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(score.explanation)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Actions groupées (spec §5)

struct BulkActionRow: View {
    var type: CareEventType
    var count: Int
    var action: () -> Void

    var body: some View {
        HStack {
            Image(systemName: type.icon)
                .foregroundStyle(.secondary)
            Text("\(count) plante\(count > 1 ? "s" : "") à \(actionVerb)")
                .font(.subheadline)
            Spacer()
            Button(actionVerb.capitalized, action: action)
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var actionVerb: String {
        switch type {
        case .watering: return "arroser"
        case .fertilizing: return "fertiliser"
        default: return type.displayName.lowercased()
        }
    }
}

// MARK: - Alertes importantes (spec §6)

struct AlertsCard: View {
    var insights: [GardenInsightService.Insight]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("À surveiller")
                .font(.headline)

            VStack(spacing: 0) {
                ForEach(Array(insights.prefix(5).enumerated()), id: \.element.id) { index, insight in
                    InsightRow(insight: insight)
                    if index < min(insights.count, 5) - 1 {
                        Divider()
                    }
                }
            }

            if insights.count > 5 {
                NavigationLink("Voir toutes les alertes", value: AllInsightsRoute())
                    .font(.subheadline)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct InsightRow: View {
    var insight: GardenInsightService.Insight

    var body: some View {
        Group {
            if let plant = insight.plant {
                NavigationLink(value: plant) { rowContent }
            } else {
                rowContent
            }
        }
        .buttonStyle(.plain)
        .padding(.vertical, 6)
    }

    private var rowContent: some View {
        HStack(spacing: 12) {
            Image(systemName: insight.icon)
                .foregroundStyle(priorityColor)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(insight.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                Text(insight.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var priorityColor: Color {
        switch insight.priority {
        case .urgent: return .red
        case .important: return .orange
        case .upcoming: return .yellow
        case .info: return .secondary
        }
    }
}

// MARK: - Météo (spec §7 — shell; réel en Phase 4B)

struct WeatherCard: View {
    var garden: Garden?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Météo", systemImage: "cloud.sun.fill")
                .font(.headline)
            Text("Ajoutez la localisation d'un jardin dans ses réglages pour voir la météo ici.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Prochainement (spec §8)

struct UpcomingCard: View {
    var days: [DashboardService.UpcomingDay]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Prochainement")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                ForEach(days) { day in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(day.label)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                        ForEach(day.items) { item in
                            HStack(spacing: 8) {
                                Image(systemName: item.schedule.type.icon)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text("\(item.plant.customName) — \(item.schedule.type.displayName)")
                                    .font(.subheadline)
                            }
                        }
                    }
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Activité récente (spec §9)

struct RecentActivityCard: View {
    var events: [CareEvent]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Activité récente")
                .font(.headline)

            VStack(spacing: 0) {
                ForEach(Array(events.enumerated()), id: \.element.id) { index, event in
                    HStack(spacing: 10) {
                        Text(event.date.formatted(.dateTime.hour().minute()))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .leading)
                        Image(systemName: event.type.icon)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("\(event.plant?.customName ?? "?") \(event.type.displayName.lowercased())")
                            .font(.subheadline)
                        Spacer()
                    }
                    .padding(.vertical, 4)
                    if index < events.count - 1 {
                        Divider()
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Consommation d'eau (spec §10 — shell; réel en Phase 4D)

struct WaterCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Eau", systemImage: "drop.fill")
                .font(.headline)
            Text("Créez une zone d'irrigation pour suivre votre consommation d'eau ici.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Évolution (spec §11)

struct EvolutionCard: View {
    var evolution: DashboardService.Evolution

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Évolution", systemImage: "leaf.fill")
                .font(.headline)
            if evolution.newPhotosThisWeek == 0 && evolution.newPlantsThisWeek == 0 {
                Text("Rien de nouveau cette semaine.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                if evolution.newPhotosThisWeek > 0 {
                    Text("\(evolution.newPhotosThisWeek) nouvelle\(evolution.newPhotosThisWeek > 1 ? "s" : "") photo\(evolution.newPhotosThisWeek > 1 ? "s" : "") cette semaine")
                        .font(.subheadline)
                }
                if evolution.newPlantsThisWeek > 0 {
                    let isPlural = evolution.newPlantsThisWeek > 1
                    Text("\(evolution.newPlantsThisWeek) nouveau\(isPlural ? "x" : "") \(isPlural ? "végétaux" : "végétal")")
                        .font(.subheadline)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Oasis AI sur l'accueil (spec §12)

struct OasisAICard: View {
    var insights: [GardenInsightService.Insight]
    var todayTaskCount: Int
    var onAsk: () -> Void

    private var bullets: [String] {
        var items: [String] = []
        if todayTaskCount > 0 {
            items.append("\(todayTaskCount) tâche\(todayTaskCount > 1 ? "s" : "") aujourd'hui")
        }
        for insight in insights.prefix(3) {
            items.append("\(insight.title) — \(insight.subtitle)")
        }
        return items
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Oasis AI", systemImage: "sparkles")
                .font(.headline)
                .foregroundStyle(.purple)

            if bullets.isEmpty {
                Text("Rien de particulier ne demande votre attention aujourd'hui.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Text("Voici ce qui mérite votre attention aujourd'hui :")
                    .font(.subheadline)
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(bullets, id: \.self) { bullet in
                        Text("• \(bullet)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Button(action: onAsk) {
                HStack {
                    Image(systemName: "text.bubble")
                    Text("Demander quelque chose à Oasis...")
                    Spacer()
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(10)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding()
        .background(Color.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct OasisAssistantSheet: View {
    var context: GardenAIContext

    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var authState = AuthState.shared

    @State private var question = ""
    @State private var isAsking = false
    @State private var answer: String?
    @State private var errorMessage: String?
    @State private var isSignInPresented = false

    private let suggestedQuestions = [
        "Que dois-je faire aujourd'hui ?",
        "Quels arbres dois-je inspecter ?",
        "Quelles plantes sont à surveiller ?",
        "Dois-je arroser demain ?",
    ]

    var body: some View {
        NavigationStack {
            Group {
                if case .authenticated = authState.status {
                    content
                } else {
                    signInPrompt
                }
            }
            .navigationTitle("✨ Demander à Oasis")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .sheet(isPresented: $isSignInPresented) {
                EmailSignInView()
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let answer {
                ScrollView {
                    Text(answer)
                        .font(.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Questions suggérées")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ForEach(suggestedQuestions, id: \.self) { suggestion in
                        Button {
                            question = suggestion
                            Task { await ask() }
                        } label: {
                            Text(suggestion)
                                .font(.subheadline)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Spacer()

            HStack {
                TextField("Poser une question…", text: $question, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...3)
                Button {
                    Task { await ask() }
                } label: {
                    if isAsking {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.up.circle.fill").font(.title2)
                    }
                }
                .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isAsking)
            }
        }
        .padding()
    }

    private var signInPrompt: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Assistant du jardin")
                .font(.title3.weight(.semibold))
            Text("Connectez-vous pour poser des questions à Oasis AI sur l'ensemble de votre jardin.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Se connecter") { isSignInPresented = true }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func ask() async {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isAsking = true
        errorMessage = nil
        do {
            answer = try await GardenAIService.ask(trimmed, context: context)
        } catch {
            errorMessage = error.localizedDescription
        }
        isAsking = false
    }
}

// MARK: - Actions rapides (spec §13)

struct QuickActionsGrid: View {
    var onAddPlant: () -> Void
    var onScan: () -> Void
    var onBulkWater: () -> Void
    var onAddIntervention: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Actions rapides")
                .font(.headline)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                QuickActionButton(title: "Ajouter un végétal", icon: "plus", tint: .green, action: onAddPlant)
                QuickActionButton(title: "Scanner une plante", icon: "camera.viewfinder", tint: .purple, action: onScan)
                QuickActionButton(title: "Arrosage groupé", icon: "drop.fill", tint: .blue, action: onBulkWater)
                QuickActionButton(title: "Ajouter une intervention", icon: "square.and.pencil", tint: .orange, action: onAddIntervention)
            }
        }
    }
}

private struct QuickActionButton: View {
    var title: String
    var icon: String
    var tint: Color
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .foregroundStyle(tint)
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                Spacer()
            }
            .padding(12)
            .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
