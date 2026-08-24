import Foundation

/// Spec Phase 7A — "Créer un dashboard BioLab." Aggregates real counts
/// only; acclimatizingPlantCount/alertCount stay genuinely at zero
/// until their sub-phases land (7L, alerts) — never a placeholder
/// number standing in for real data.
struct BioLabDashboardSummary {
    var activeBioreactorCount: Int = 0
    var multiplicationBatchCount: Int = 0
    var rootingBatchCount: Int = 0
    var acclimatizingPlantCount: Int = 0
    var alertCount: Int = 0
}

enum BioLabDashboardService {
    static func summary(batches: [CultureBatch] = [], bioreactors: [Bioreactor] = []) -> BioLabDashboardSummary {
        var summary = BioLabDashboardSummary()
        summary.multiplicationBatchCount = batches.filter { $0.status == .active && $0.cultureStage == .multiplication }.count
        summary.rootingBatchCount = batches.filter { $0.status == .active && $0.cultureStage == .rooting }.count
        summary.activeBioreactorCount = bioreactors.filter { $0.status != .maintenance && $0.currentBatch != nil }.count
        return summary
    }
}
