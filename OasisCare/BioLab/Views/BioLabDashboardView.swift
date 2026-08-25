import SwiftData
import SwiftUI

/// Spec Phase 7A/7M — "Ajouter un nouvel espace principal : BioLab...
/// Créer une vraie page d'accueil laboratoire." Pushed from HomeView's
/// existing NavigationStack (a plain NavigationLink, no tab bar change)
/// rather than a sixth tab — a sixth item would push "Planning" into
/// iOS's automatic tab-bar overflow ("More"), exactly the kind of
/// disruption to existing navigation spec explicitly warns against
/// ("sans perturber la navigation existante"). No NavigationStack of its
/// own here, matching every other pushed (not sheeted) destination in
/// this app (e.g. SettingsView) — it's already inside Home's.
struct BioLabDashboardView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var cultureBatches: [CultureBatch]
    @Query private var bioreactors: [Bioreactor]
    @Query private var cycleExecutions: [BioreactorCycleExecution]
    @Query private var inspections: [BioreactorInspection]
    @Query private var mediumBatches: [MediumBatch]
    @Query private var acclimatizationBatches: [AcclimatizationBatch]
    @Query private var alerts: [BioLabAlert]
    @State private var isAssistantPresented = false

    private var summary: BioLabDashboardSummary {
        BioLabDashboardService.summary(
            batches: cultureBatches, bioreactors: bioreactors, executions: cycleExecutions, inspections: inspections,
            mediumBatches: mediumBatches, acclimatizationBatches: acclimatizationBatches, alerts: alerts
        )
    }
    private var activeAlerts: [BioLabAlert] {
        alerts.filter(\.isActive).sorted { $0.priority > $1.priority }
    }
    private var recentActivity: [BioLabDashboardService.ActivityItem] {
        BioLabDashboardService.recentActivity(executions: cycleExecutions, inspections: inspections, mediumBatches: mediumBatches)
    }
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
                    if !activeAlerts.isEmpty {
                        alertsSection
                    }
                    todaySection
                    performanceSection
                    if !recentActivity.isEmpty {
                        activitySection
                    }
                }

                aiAssistantRow
                quickLinks
            }
            .padding()
        }
        .navigationTitle("Oasis BioLab")
        .navigationBarTitleDisplayMode(.inline)
        .task { await runBackgroundLoop() }
        .sheet(isPresented: $isAssistantPresented) {
            BioLabAIAssistantSheet(context: aiContext)
        }
    }

    /// Spec Phase 7E/7M "ALERTES" — the only place BioreactorCycleScheduler.tick
    /// and BioLabAlertService.scan run from. See their own doc comments:
    /// this only ever runs while a BioLab screen is on screen and the
    /// app is in the foreground — there is no background daemon.
    private func runBackgroundLoop() async {
        while !Task.isCancelled {
            BioreactorCycleScheduler.tick(
                bioreactors: bioreactors, executions: cycleExecutions,
                actuate: { execution, starting in
                    BioreactorController.actuateCycle(execution, starting: starting, context: modelContext)
                },
                context: modelContext
            )
            BioLabAlertService.scan(
                bioreactors: bioreactors, activeBatches: cultureBatches.filter { $0.status == .active }, context: modelContext
            )
            try? modelContext.save()
            try? await Task.sleep(for: .seconds(30))
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

    private var quickLinks: some View {
        VStack(spacing: 10) {
            BioLabQuickLinkRow(title: "Plan du laboratoire", icon: "square.grid.3x3.fill") {
                LabDigitalTwinView()
            }
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
            BioLabQuickLinkRow(title: "Statistiques", icon: "chart.bar.fill") {
                BioLabAnalyticsView()
            }
            BioLabQuickLinkRow(title: "Expérimentations", icon: "flask") {
                BioLabExperimentListView()
            }
            BioLabQuickLinkRow(title: "Inventaire", icon: "shippingbox") {
                LabInventoryListView()
            }
            BioLabQuickLinkRow(title: "Composés", icon: "atom") {
                LabCompoundListView()
            }
            BioLabQuickLinkRow(title: "Solutions stock", icon: "eyedropper") {
                StockSolutionListView()
            }
            BioLabQuickLinkRow(title: "Étiquette de rack", icon: "qrcode") {
                RackTagCreationView()
            }
            if bioreactors.count >= 2 {
                BioLabQuickLinkRow(title: "Comparer deux bioréacteurs", icon: "arrow.left.arrow.right") {
                    BioLabComparisonView()
                }
            }
            if !alerts.isEmpty {
                BioLabQuickLinkRow(title: "Toutes les alertes (\(alerts.count))", icon: "bell") {
                    BioLabAlertListView()
                }
            }
        }
    }

    private var statGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            statCard(title: "Bioréacteurs actifs", value: "\(summary.activeBioreactorCount)", icon: "testtube.2", tint: .teal)
            statCard(title: "Explants en culture", value: "\(summary.totalExplantCount)", icon: "leaf.fill", tint: .green)
            statCard(title: "Lots en enracinement", value: "\(summary.rootingBatchCount)", icon: "arrow.down.to.line", tint: .brown)
            statCard(title: "En acclimatation", value: "\(summary.acclimatizingPlantCount) plantes", icon: "sun.max.fill", tint: .orange)
            if summary.alertCount > 0 {
                statCard(title: "Alertes actives", value: "\(summary.alertCount)", icon: "exclamationmark.triangle.fill", tint: .red)
            }
        }
    }

    private var alertsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Alertes").font(.headline)
            VStack(spacing: 0) {
                ForEach(Array(activeAlerts.prefix(5).enumerated()), id: \.element.id) { index, alert in
                    NavigationLink {
                        BioLabAlertListView()
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "circle.fill")
                                .font(.system(size: 7))
                                .foregroundStyle(alertColor(alert.priority))
                                .padding(.top, 5)
                            Text(alert.message)
                                .font(.subheadline)
                                .foregroundStyle(.primary)
                                .multilineTextAlignment(.leading)
                            Spacer()
                        }
                        .padding(.vertical, 8)
                    }
                    if index < min(activeAlerts.count, 5) - 1 { Divider() }
                }
            }
            .padding(.horizontal, 12)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Aujourd'hui").font(.headline)
            VStack(spacing: 6) {
                todayRow("Immersions", summary.todayImmersionCount, "drop.fill")
                todayRow("Aérations", summary.todayAerationCount, "wind")
                todayRow("Inspections", summary.todayInspectionCount, "eye.fill")
                todayRow("Changements de milieu", summary.todayMediumChangeCount, "flask.fill")
            }
            .padding()
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private func todayRow(_ title: String, _ count: Int, _ icon: String) -> some View {
        HStack {
            Label(title, systemImage: icon)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Spacer()
            Text("\(count)").font(.subheadline.weight(.medium))
        }
    }

    private var performanceSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Performance").font(.headline)
            VStack(spacing: 6) {
                performanceRow("Multiplication moyenne", summary.averageMultiplicationRate.map { "x\(String(format: "%.1f", $0))" })
                performanceRow("Contamination (7 derniers jours)", summary.weeklyContaminationRate.map { "\(String(format: "%.1f", $0 * 100)) %" })
                performanceRow("Survie acclimatation", summary.averageAcclimatizationSurvivalRate.map { "\(String(format: "%.1f", $0 * 100)) %" })
            }
            .padding()
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private func performanceRow(_ title: String, _ value: String?) -> some View {
        HStack {
            Text(title).font(.subheadline).foregroundStyle(.secondary)
            Spacer()
            Text(value ?? "Non disponible").font(.subheadline.weight(.medium))
        }
    }

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Activité récente").font(.headline)
            VStack(spacing: 6) {
                ForEach(recentActivity) { item in
                    HStack {
                        Text(item.date.formatted(date: .omitted, time: .shortened))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(width: 50, alignment: .leading)
                        Text(item.text).font(.subheadline)
                        Spacer()
                    }
                }
            }
            .padding()
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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

    private func alertColor(_ priority: BioLabAlertPriority) -> Color {
        switch priority {
        case .info: return .blue
        case .warning: return .yellow
        case .important: return .orange
        case .critical: return .red
        }
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
