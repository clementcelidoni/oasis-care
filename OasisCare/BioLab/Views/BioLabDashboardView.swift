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
    @Query private var cultureBatches: [CultureBatch]

    private var summary: BioLabDashboardSummary { BioLabDashboardService.summary(batches: cultureBatches) }

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

                NavigationLink {
                    CultureBatchListView()
                } label: {
                    Label("Lots de culture (\(cultureBatches.count))", systemImage: "flask")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding()
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding()
        }
        .navigationTitle("Oasis BioLab")
        .navigationBarTitleDisplayMode(.inline)
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
