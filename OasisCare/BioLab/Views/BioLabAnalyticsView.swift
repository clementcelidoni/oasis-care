import SwiftUI
import SwiftData

/// Spec Phase 7J — "STATISTIQUES." Layout mirrors the spec's own
/// example almost verbatim (species name, Lots, Multiplication
/// moyenne, Contamination, Hyperhydricité, Enracinement, Survie
/// acclimatation) plus a lab-wide section for the two indicators that
/// don't naturally group by species (averageCycleDuration, lossRate).
struct BioLabAnalyticsView: View {
    @Query private var batches: [CultureBatch]
    @Query private var executions: [BioreactorCycleExecution]

    private var speciesStats: [BioLabAnalyticsService.SpeciesStats] {
        BioLabAnalyticsService.speciesStats(batches: batches)
    }
    private var labWideStats: BioLabAnalyticsService.LabWideStats {
        BioLabAnalyticsService.labWideStats(batches: batches, executions: executions)
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
