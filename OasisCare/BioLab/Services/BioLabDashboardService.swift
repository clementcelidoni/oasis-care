import Foundation

/// Spec Phase 7A/7M — "Créer un dashboard BioLab... une vraie page
/// d'accueil laboratoire." Aggregates real counts only — every field
/// here reads from data this app actually has; nothing is a placeholder
/// standing in for a number that can't yet be computed (see
/// acclimatizingPlantCount/alertCount's own history: both stayed at a
/// hardcoded zero for phases where nothing existed to compute them from,
/// never a fake nonzero placeholder).
struct BioLabDashboardSummary {
    var activeBioreactorCount: Int = 0
    var multiplicationBatchCount: Int = 0
    var rootingBatchCount: Int = 0
    var acclimatizingPlantCount: Int = 0
    var alertCount: Int = 0
    var totalExplantCount: Int = 0
    var todayImmersionCount: Int = 0
    var todayAerationCount: Int = 0
    var todayInspectionCount: Int = 0
    var todayMediumChangeCount: Int = 0
    var averageMultiplicationRate: Double?
    var weeklyContaminationRate: Double?
    var averageAcclimatizationSurvivalRate: Double?
}

enum BioLabDashboardService {
    static func summary(
        batches: [CultureBatch] = [], bioreactors: [Bioreactor] = [], executions: [BioreactorCycleExecution] = [],
        inspections: [BioreactorInspection] = [], mediumBatches: [MediumBatch] = [],
        acclimatizationBatches: [AcclimatizationBatch] = [], alerts: [BioLabAlert] = []
    ) -> BioLabDashboardSummary {
        var summary = BioLabDashboardSummary()
        let activeBatches = batches.filter { $0.status == .active }
        summary.multiplicationBatchCount = activeBatches.filter { $0.cultureStage == .multiplication }.count
        summary.rootingBatchCount = activeBatches.filter { $0.cultureStage == .rooting }.count
        summary.activeBioreactorCount = bioreactors.filter { $0.status != .maintenance && $0.currentBatch != nil }.count
        summary.totalExplantCount = activeBatches.reduce(0) { $0 + $1.currentCount }
        summary.acclimatizingPlantCount = acclimatizationBatches.filter { $0.status == .active }.reduce(0) { $0 + $1.currentSurvivorCount }
        summary.alertCount = alerts.filter(\.isActive).count

        let calendar = Calendar.current
        let now = Date.now
        summary.todayImmersionCount = executions.filter {
            $0.cycleType == .immersion && $0.actualStart.map { calendar.isDate($0, inSameDayAs: now) } == true
        }.count
        summary.todayAerationCount = executions.filter {
            $0.cycleType == .aeration && $0.actualStart.map { calendar.isDate($0, inSameDayAs: now) } == true
        }.count
        summary.todayInspectionCount = inspections.filter { calendar.isDate($0.date, inSameDayAs: now) }.count
        summary.todayMediumChangeCount = mediumBatches.filter { calendar.isDate($0.preparedAt, inSameDayAs: now) }.count

        let multiplicationRatios = batches.compactMap { batch -> Double? in
            guard batch.initialExplantCount > 0 else { return nil }
            return Double(batch.currentCount) / Double(batch.initialExplantCount)
        }
        summary.averageMultiplicationRate = multiplicationRatios.isEmpty ? nil : multiplicationRatios.reduce(0, +) / Double(multiplicationRatios.count)

        let weekAgo = calendar.date(byAdding: .day, value: -7, to: now) ?? now
        let recentInspections = inspections.filter { $0.date >= weekAgo }
        summary.weeklyContaminationRate = recentInspections.isEmpty
            ? nil
            : Double(recentInspections.filter { $0.contaminationStatus == .confirmed }.count) / Double(recentInspections.count)

        let survivalRates = acclimatizationBatches.compactMap(\.survivalRate)
        summary.averageAcclimatizationSurvivalRate = survivalRates.isEmpty ? nil : survivalRates.reduce(0, +) / Double(survivalRates.count)

        return summary
    }

    struct ActivityItem: Identifiable {
        var id = UUID()
        var date: Date
        var text: String
    }

    /// Spec "ACTIVITÉ RÉCENTE" — merges the three kinds of BioLab events
    /// that actually have a timestamp to sort by, newest first.
    static func recentActivity(
        executions: [BioreactorCycleExecution], inspections: [BioreactorInspection], mediumBatches: [MediumBatch], limit: Int = 15
    ) -> [ActivityItem] {
        var items: [ActivityItem] = []
        for execution in executions {
            guard let start = execution.actualStart, let code = execution.bioreactor?.code else { continue }
            items.append(ActivityItem(date: start, text: "\(code) \(execution.cycleType.label.lowercased())"))
        }
        for inspection in inspections {
            let code = inspection.cultureBatch?.batchCode ?? "?"
            items.append(ActivityItem(date: inspection.date, text: "Lot \(code) inspection"))
        }
        for mediumBatch in mediumBatches {
            items.append(ActivityItem(date: mediumBatch.preparedAt, text: "Préparation de milieu \(mediumBatch.code) créée"))
        }
        return items.sorted { $0.date > $1.date }.prefix(limit).map { $0 }
    }
}
