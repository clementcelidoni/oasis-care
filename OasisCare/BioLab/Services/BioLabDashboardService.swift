import Foundation

/// Spec Phase 7A — "Créer un dashboard BioLab." Aggregates real counts
/// only; every field here starts genuinely at zero until the models it
/// depends on exist (Bioreactor in 7D, CultureBatch/AcclimatizationBatch
/// in 7B/7L) and grows in place as each later sub-phase adds its data
/// source — never a placeholder number standing in for real data.
struct BioLabDashboardSummary {
    var activeBioreactorCount: Int = 0
    var multiplicationBatchCount: Int = 0
    var rootingBatchCount: Int = 0
    var acclimatizingPlantCount: Int = 0
    var alertCount: Int = 0
}

enum BioLabDashboardService {
    static func summary(batches: [CultureBatch] = []) -> BioLabDashboardSummary {
        var summary = BioLabDashboardSummary()
        summary.multiplicationBatchCount = batches.filter { $0.status == .active && $0.cultureStage == .multiplication }.count
        summary.rootingBatchCount = batches.filter { $0.status == .active && $0.cultureStage == .rooting }.count
        return summary
    }
}
