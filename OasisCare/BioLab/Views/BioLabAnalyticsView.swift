import SwiftUI
import SwiftData

/// Spec Phase 7J — "STATISTIQUES." Three groupings, each mirroring the
/// spec's own examples almost verbatim: "PAR ESPÈCE" (Lots,
/// Multiplication moyenne, Contamination, Hyperhydricité, Enracinement,
/// Survie acclimatation), "PAR BIORÉACTEUR" (Cycles réalisés/échoués,
/// Disponibilité, Lots terminés), and a lab-wide section for the two
/// indicators that don't naturally group by either (averageCycleDuration,
/// lossRate). Filtering "par recette/programme/période" (also named in
/// spec's own "PAR ESPÈCE" list) isn't built — recette/programme
/// comparison already exists via BioLabComparisonView (Phase 7I), and a
/// full time-period filter across every indicator here is a documented
/// Phase 8 candidate rather than in scope now.
struct BioLabAnalyticsView: View {
    @Query private var batches: [CultureBatch]
    @Query private var bioreactors: [Bioreactor]
    @Query private var executions: [BioreactorCycleExecution]
    @Query private var inspections: [BioreactorInspection]

    private var speciesStats: [BioLabAnalyticsService.SpeciesStats] {
        BioLabAnalyticsService.speciesStats(batches: batches)
    }
    private var labWideStats: BioLabAnalyticsService.LabWideStats {
        BioLabAnalyticsService.labWideStats(batches: batches, executions: executions)
    }
    private var bioreactorStats: [BioLabAnalyticsService.BioreactorStats] {
        BioLabAnalyticsService.bioreactorStats(bioreactors: bioreactors, batches: batches, executions: executions, inspections: inspections)
    }

    var body: some View {
        Form {
            if batches.isEmpty {
                Section {
                    Text("Aucun lot enregistré pour le moment.")
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(speciesStats) { stats in
                Section(stats.speciesName) {
                    LabeledContent("Lots", value: "\(stats.batchCount)")
                    LabeledContent("Multiplication moyenne", value: formattedRate(stats.averageMultiplicationRate))
                    LabeledContent("Contamination", value: formattedPercent(stats.contaminationRate))
                    LabeledContent("Hyperhydricité", value: formattedPercent(stats.hyperhydricityRate))
                    LabeledContent("Enracinement", value: formattedPercent(stats.rootingRate))
                    LabeledContent("Survie acclimatation", value: formattedPercent(stats.acclimatizationSurvivalRate))
                }
            }

            ForEach(bioreactorStats) { stats in
                Section(stats.code) {
                    LabeledContent("Cycles réalisés", value: "\(stats.completedCycleCount)")
                    LabeledContent("Cycles échoués", value: "\(stats.failedCycleCount)")
                    LabeledContent("Disponibilité", value: formattedPercent(stats.availabilityRate))
                    LabeledContent("Lots terminés", value: "\(stats.completedBatchCount)")
                }
            }

            Section {
                LabeledContent("Lots au total", value: "\(labWideStats.totalBatchCount)")
                LabeledContent("Perte", value: formattedPercent(labWideStats.lossRate))
                LabeledContent("Durée moyenne de cycle", value: formattedDuration(labWideStats.averageCycleDurationSeconds))
            } header: {
                Text("Ensemble du laboratoire")
            } footer: {
                Text("La survie en acclimatation n'est pas encore disponible — ce suivi arrive avec le module Acclimatation.")
            }
        }
        .navigationTitle("Statistiques")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func formattedRate(_ value: Double?) -> String {
        guard let value else { return "—" }
        return "x\(String(format: "%.1f", value))"
    }

    private func formattedPercent(_ value: Double?) -> String {
        guard let value else { return "Non disponible" }
        return "\(String(format: "%.1f", value * 100)) %"
    }

    private func formattedDuration(_ seconds: Double?) -> String {
        guard let seconds else { return "Non disponible" }
        if seconds >= 60 {
            return "\(Int((seconds / 60).rounded())) min"
        }
        return "\(Int(seconds.rounded())) s"
    }
}
