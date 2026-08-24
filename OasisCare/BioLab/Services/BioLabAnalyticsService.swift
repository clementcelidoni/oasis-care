import Foundation

/// Spec Phase 7J — "INDICATEURS." Every rate here is an *observed* rate
/// from this app's own recorded data, not a true underlying probability
/// — e.g. contaminationRate only counts batches with a CONFIRMED
/// contamination inspection (never `.suspected`, which would overstate
/// certainty this app doesn't have), and a batch never inspected simply
/// isn't counted as contaminated. Returns nil rather than 0 wherever a
/// rate genuinely can't be computed from what exists yet, matching this
/// app's own "never display a value that isn't real" discipline.
enum BioLabAnalyticsService {
    struct SpeciesStats: Identifiable {
        var id: String { speciesName }
        var speciesName: String
        var batchCount: Int
        var averageMultiplicationRate: Double?
        var contaminationRate: Double?
        var hyperhydricityRate: Double?
        var rootingRate: Double?
        /// Average `survivalRate` across every AcclimatizationBatch
        /// whose source CultureBatch matches this species — nil when
        /// none exist yet for it, never a fabricated 0%.
        var acclimatizationSurvivalRate: Double?
    }

    struct LabWideStats {
        var totalBatchCount: Int
        var lossRate: Double?
        var averageCycleDurationSeconds: Double?
    }

    /// Spec Phase 7J "PAR BIORÉACTEUR" — its own example (BR04: cycles
    /// réalisés/échoués, disponibilité, lots terminés). `availabilityRate`
    /// is a success-rate proxy (completed / (completed + failed)), not
    /// literal calendar uptime — this app has no maintenance-downtime
    /// duration tracking to compute that from. `completedBatchCount`
    /// counts batches with at least one BioreactorInspection recorded
    /// against this specific bioreactor that have since reached
    /// `.completed` — the only real, recorded batch↔bioreactor link
    /// this app has (Bioreactor.currentBatch is a live snapshot, not
    /// history), so it's a proxy for "finished in this vessel," not a
    /// guaranteed exact count.
    struct BioreactorStats: Identifiable {
        var id: UUID
        var code: String
        var completedCycleCount: Int
        var failedCycleCount: Int
        var availabilityRate: Double?
        var completedBatchCount: Int
    }

    static func speciesStats(batches: [CultureBatch], acclimatizationBatches: [AcclimatizationBatch] = []) -> [SpeciesStats] {
        let grouped = Dictionary(grouping: batches, by: \.speciesName)
        return grouped.map { speciesName, speciesBatches in
            let nonDiscarded = speciesBatches.filter { $0.status != .discarded }

            let multiplicationRatios = speciesBatches.compactMap { batch -> Double? in
                guard batch.initialExplantCount > 0 else { return nil }
                return Double(batch.currentCount) / Double(batch.initialExplantCount)
            }
            let averageMultiplicationRate = multiplicationRatios.isEmpty ? nil : multiplicationRatios.reduce(0, +) / Double(multiplicationRatios.count)

            let contaminatedCount = speciesBatches.filter { batch in
                batch.inspections.contains { $0.contaminationStatus == .confirmed }
            }.count
            let hyperhydricCount = speciesBatches.filter { batch in
                batch.inspections.contains { $0.hyperhydricityStatus != .none && $0.hyperhydricityStatus != .unknown }
            }.count

            // Of batches still in play (not discarded), how many have
            // reached rooting or a later stage — the simplest rate this
            // app can honestly compute without a distinct "rooting
            // attempted but failed" signal, which doesn't exist here.
            let rootedOrLater: Set<CultureStage> = [.rooting, .preAcclimatization, .acclimatization, .completed]
            let rootedCount = nonDiscarded.filter { rootedOrLater.contains($0.cultureStage) }.count

            let speciesBatchIDs = Set(speciesBatches.map(\.id))
            let survivalRates = acclimatizationBatches
                .filter { batch in batch.cultureBatch.map { speciesBatchIDs.contains($0.id) } ?? false }
                .compactMap(\.survivalRate)
            let acclimatizationSurvivalRate = survivalRates.isEmpty ? nil : survivalRates.reduce(0, +) / Double(survivalRates.count)

            return SpeciesStats(
                speciesName: speciesName, batchCount: speciesBatches.count,
                averageMultiplicationRate: averageMultiplicationRate,
                contaminationRate: Double(contaminatedCount) / Double(speciesBatches.count),
                hyperhydricityRate: Double(hyperhydricCount) / Double(speciesBatches.count),
                rootingRate: nonDiscarded.isEmpty ? nil : Double(rootedCount) / Double(nonDiscarded.count),
                acclimatizationSurvivalRate: acclimatizationSurvivalRate
            )
        }
        .sorted { $0.batchCount > $1.batchCount }
    }

    static func labWideStats(batches: [CultureBatch], executions: [BioreactorCycleExecution]) -> LabWideStats {
        let discardedCount = batches.filter { $0.status == .discarded }.count
        let lossRate = batches.isEmpty ? nil : Double(discardedCount) / Double(batches.count)

        let completedDurations = executions
            .filter { $0.status == .completed }
            .compactMap { $0.actualDurationSeconds }
            .map(Double.init)
        let averageCycleDurationSeconds = completedDurations.isEmpty ? nil : completedDurations.reduce(0, +) / Double(completedDurations.count)

        return LabWideStats(totalBatchCount: batches.count, lossRate: lossRate, averageCycleDurationSeconds: averageCycleDurationSeconds)
    }

    static func bioreactorStats(
        bioreactors: [Bioreactor], batches: [CultureBatch], executions: [BioreactorCycleExecution], inspections: [BioreactorInspection]
    ) -> [BioreactorStats] {
        let batchesByID = Dictionary(uniqueKeysWithValues: batches.map { ($0.id, $0) })
        return bioreactors.map { bioreactor in
            let ownExecutions = executions.filter { $0.bioreactor?.id == bioreactor.id }
            let completedCycles = ownExecutions.filter { $0.status == .completed }.count
            let failedCycles = ownExecutions.filter { $0.status == .failed || $0.status == .timeout }.count
            let attempted = completedCycles + failedCycles
            let availabilityRate = attempted == 0 ? nil : Double(completedCycles) / Double(attempted)

            let batchIDsInspectedHere = Set(
                inspections.filter { $0.bioreactor?.id == bioreactor.id }.compactMap { $0.cultureBatch?.id }
            )
            let completedBatchCount = batchIDsInspectedHere.filter { batchesByID[$0]?.status == .completed }.count

            return BioreactorStats(
                id: bioreactor.id, code: bioreactor.code, completedCycleCount: completedCycles,
                failedCycleCount: failedCycles, availabilityRate: availabilityRate,
                completedBatchCount: completedBatchCount
            )
        }
    }
}
