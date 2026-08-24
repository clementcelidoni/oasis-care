import SwiftData
import SwiftUI

/// Spec Phase 7A — "Ajouter un nouvel espace principal : BioLab...
/// Créer un dashboard BioLab." Pushed from HomeView's existing
/// NavigationStack (a plain NavigationLink, no tab bar change) rather
/// than a sixth tab — a sixth item would push "Planning" into iOS's
/// automatic tab-bar overflow ("More"), exactly the kind of disruption
/// to existing navigation spec explicitly warns against ("sans
/// perturber la navigation existante"). No NavigationStack of its own
/// here, matching every other pushed (not sheeted) destination in this
/// app (e.g. SettingsView) — it's already inside Home's.
///
/// This is 7A's own minimal example layout (five counts). 7M
/// ("Dashboard BioLab") is where the fuller lab home page — activité
/// récente, performance de la semaine — gets built; this view grows in
/// place rather than being replaced when that lands.
struct BioLabDashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var cultureBatches: [CultureBatch]
    @Query private var bioreactors: [Bioreactor]
    @Query private var cycleExecutions: [BioreactorCycleExecution]
    @State private var isAssistantPresented = false

    private var summary: BioLabDashboardSummary { BioLabDashboardService.summary(batches: cultureBatches, bioreactors: bioreactors) }
    private var aiContext: BioLabAIContext { BioLabAIContext.build(batches: cultureBatches, bioreactors: bioreactors) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if cultureBatches.isEmpty {
                    EmptyStateView(
                        icon: "testtube.2",
                        title: "Bienvenue dans Oasis BioLab",
                        message: "Créez votre première plante mère et votre premier lot pour commencer le suivi de culture in vitro."
                    )
                    .padding(.top, 40)
                } else {
                    statGrid
                }

                aiAssistantRow
                quickLinks
            }
            .padding()
        }
        .navigationTitle("Oasis BioLab")
        .navigationBarTitleDisplayMode(.inline)
        .task { await runCycleSchedulerLoop() }
        .sheet(isPresented: $isAssistantPresented) {
            BioLabAIAssistantSheet(context: aiContext)
        }
    }

    /// Spec Phase 7I "QUESTIONS" — same visual convention as HomeView's
    /// own "Demander quelque chose à Oasis..." row.
    private var aiAssistantRow: some View {
        Button {
            isAssistantPresented = true
        } label: {
            HStack {
                Image(systemName: "text.bubble")
                Text("Demander quelque chose à Oasis BioLab...")
                Spacer()
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .padding(10)
            .background(Color.purple.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    /// Spec Phase 7E — the only place BioreactorCycleScheduler.tick is
    /// called from. See that service's own doc comment: this only ever
    /// runs while a BioLab screen is on screen and the app is in the
    /// foreground — there is no background daemon. `actuate` is Phase
    /// 7G's real BioreactorController-backed implementation, itself
    /// gated on each bioreactor's own automationEnabled opt-in.
    private func runCycleSchedulerLoop() async {
        while !Task.isCancelled {
            BioreactorCycleScheduler.tick(
                bioreactors: bioreactors, executions: cycleExecutions,
                actuate: { execution, starting in
                    BioreactorController.actuateCycle(execution, starting: starting, context: modelContext)
                },
                context: modelContext
            )
            try? modelContext.save()
            try? await Task.sleep(for: .seconds(30))
        }
    }

    /// Grows in place across the remaining sub-phases (bioréacteurs in
    /// 7D, recettes/inventaire already here from 7C, etc.) — one shared
    /// row style rather than a hand-styled NavigationLink per
    /// destination.
    private var quickLinks: some View {
        VStack(spacing: 10) {
            BioLabQuickLinkRow(title: "Bioréacteurs (\(bioreactors.count))", icon: "testtube.2") {
                BioreactorListView()
            }
            BioLabQuickLinkRow(title: "Lots de culture (\(cultureBatches.count))", icon: "flask") {
                CultureBatchListView()
            }
            BioLabQuickLinkRow(title: "Recettes de milieu", icon: "testtube.2") {
                MediumRecipeListView()
            }
            BioLabQuickLinkRow(title: "Préparations de milieu", icon: "flask.fill") {
                MediumBatchListView()
            }
            if bioreactors.count >= 2 {
                BioLabQuickLinkRow(title: "Comparer deux bioréacteurs", icon: "arrow.left.arrow.right") {
                    BioLabComparisonView()
                }
            }
        }
    }

    private var statGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            statCard(title: "Bioréacteurs actifs", value: "\(summary.activeBioreactorCount)", icon: "testtube.2", tint: .teal)
            statCard(title: "Lots en multiplication", value: "\(summary.multiplicationBatchCount)", icon: "leaf.arrow.circlepath", tint: .green)
            statCard(title: "Lots en enracinement", value: "\(summary.rootingBatchCount)", icon: "arrow.down.to.line", tint: .brown)
            statCard(title: "Acclimatation", value: "\(summary.acclimatizingPlantCount) plantes", icon: "sun.max.fill", tint: .orange)
            if summary.alertCount > 0 {
                statCard(title: "Alertes", value: "\(summary.alertCount)", icon: "exclamationmark.triangle.fill", tint: .red)
            }
        }
    }

    private func statCard(title: String, value: String, icon: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(tint)
            Text(value)
                .font(.title2.weight(.semibold))
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct BioLabQuickLinkRow<Destination: View>: View {
    var title: String
    var icon: String
    @ViewBuilder var destination: () -> Destination

    var body: some View {
        NavigationLink {
            destination()
        } label: {
            Label(title, systemImage: icon)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
