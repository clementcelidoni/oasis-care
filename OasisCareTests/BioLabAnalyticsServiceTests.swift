import XCTest
@testable import OasisCare

/// BioLabAnalyticsService's own doc comment: "Returns nil rather than 0
/// wherever a rate genuinely can't be computed... never a fabricated
/// value" — these stats are shown directly to the user in
/// BioLabAnalyticsView, so a silent nil-vs-zero mixup would misreport
/// real lab results, same risk category as IrrigationCalculatorTests'
/// own worked example. Also covers the acclimatizationSurvivalRate
/// calculation directly (added after initially shipping as a hardcoded
/// nil placeholder).
///
/// Scope note: the contamination/hyperhydricity detection paths read
/// `batch.inspections`, a SwiftData to-many inverse relationship that
/// only auto-populates once both sides are inserted into a live
/// ModelContext — not on plain, unpersisted model instances like the
/// ones built here. Covered here only for the "nothing recorded yet"
/// case (a real, well-defined 0%, computed from the always-populated
/// speciesBatches array itself); the "something WAS recorded" case
/// needs a ModelContext-backed integration test instead.
final class BioLabAnalyticsServiceTests: XCTestCase {
    func testSpeciesStatsAveragesMultiplicationRateAcrossBatches() {
        let batchA = CultureBatch(batchCode: "A", speciesName: "Monstera", initialExplantCount: 10)
        batchA.currentCount = 25
        let batchB = CultureBatch(batchCode: "B", speciesName: "Monstera", initialExplantCount: 5)
        batchB.currentCount = 10

        let stats = BioLabAnalyticsService.speciesStats(batches: [batchA, batchB])

        XCTAssertEqual(stats.count, 1)
        XCTAssertEqual(stats[0].averageMultiplicationRate ?? -1, 2.25, accuracy: 0.0001)
    }

    func testSpeciesStatsContaminationAndHyperhydricityRateAreZeroNotNilWhenNothingRecorded() {
        let batch = CultureBatch(batchCode: "A", speciesName: "Ficus", initialExplantCount: 10)

        let stats = BioLabAnalyticsService.speciesStats(batches: [batch])

        XCTAssertEqual(stats[0].contaminationRate, 0)
        XCTAssertEqual(stats[0].hyperhydricityRate, 0)
    }

    func testSpeciesStatsAcclimatizationSurvivalRateAveragesOnlyMatchingSpecies() throws {
        let batchA = CultureBatch(batchCode: "A", speciesName: "Monstera", initialExplantCount: 10)
        let batchB = CultureBatch(batchCode: "B", speciesName: "Ficus", initialExplantCount: 10)

        let accA1 = AcclimatizationBatch(cultureBatch: batchA, initialPlantletCount: 10)
        accA1.currentSurvivorCount = 8 // 0.8
        let accA2 = AcclimatizationBatch(cultureBatch: batchA, initialPlantletCount: 10)
        accA2.currentSurvivorCount = 6 // 0.6
        let accB = AcclimatizationBatch(cultureBatch: batchB, initialPlantletCount: 10)
        accB.currentSurvivorCount = 10 // 1.0 — must never leak into Monstera's average

        let stats = BioLabAnalyticsService.speciesStats(
            batches: [batchA, batchB], acclimatizationBatches: [accA1, accA2, accB]
        )

        let monstera = try XCTUnwrap(stats.first { $0.speciesName == "Monstera" })
        XCTAssertEqual(monstera.acclimatizationSurvivalRate ?? -1, 0.7, accuracy: 0.0001)
    }

    func testSpeciesStatsAcclimatizationSurvivalRateIsNilWhenNoAttemptsExist() {
        let batch = CultureBatch(batchCode: "A", speciesName: "Ficus", initialExplantCount: 10)

        let stats = BioLabAnalyticsService.speciesStats(batches: [batch])

        XCTAssertNil(stats[0].acclimatizationSurvivalRate)
    }

    func testLabWideStatsLossRateCountsOnlyDiscardedBatches() {
        let batches = (0..<4).map { CultureBatch(batchCode: "\($0)", speciesName: "Ficus", initialExplantCount: 5) }
        batches[0].status = .discarded

        let stats = BioLabAnalyticsService.labWideStats(batches: batches, executions: [])

        XCTAssertEqual(stats.lossRate ?? -1, 0.25, accuracy: 0.0001)
    }

    func testLabWideStatsAverageCycleDurationCountsOnlyCompletedExecutions() {
        let bioreactor = Bioreactor(name: "BR1", code: "BR01", bioreactorType: .rita, totalVolumeLiters: 10, workingVolumeLiters: 8)
        let completedShort = BioreactorCycleExecution(
            bioreactor: bioreactor, programVersion: nil, cycleType: .immersion, plannedStart: .now, expectedDurationSeconds: 120
        )
        completedShort.status = .completed
        completedShort.actualDurationSeconds = 120
        let completedLong = BioreactorCycleExecution(
            bioreactor: bioreactor, programVersion: nil, cycleType: .immersion, plannedStart: .now, expectedDurationSeconds: 180
        )
        completedLong.status = .completed
        completedLong.actualDurationSeconds = 180
        let failed = BioreactorCycleExecution(
            bioreactor: bioreactor, programVersion: nil, cycleType: .immersion, plannedStart: .now, expectedDurationSeconds: 999
        )
        failed.status = .failed
        failed.actualDurationSeconds = 999

        let stats = BioLabAnalyticsService.labWideStats(batches: [], executions: [completedShort, completedLong, failed])

        XCTAssertEqual(stats.averageCycleDurationSeconds ?? -1, 150, accuracy: 0.0001)
    }

    func testBioreactorStatsAvailabilityRateCountsTimeoutAsFailure() {
        let bioreactor = Bioreactor(name: "BR1", code: "BR01", bioreactorType: .rita, totalVolumeLiters: 10, workingVolumeLiters: 8)
        let completed = BioreactorCycleExecution(
            bioreactor: bioreactor, programVersion: nil, cycleType: .immersion, plannedStart: .now, expectedDurationSeconds: 120
        )
        completed.status = .completed
        let timedOut = BioreactorCycleExecution(
            bioreactor: bioreactor, programVersion: nil, cycleType: .immersion, plannedStart: .now, expectedDurationSeconds: 120
        )
        timedOut.status = .timeout
        let stillScheduled = BioreactorCycleExecution(
            bioreactor: bioreactor, programVersion: nil, cycleType: .immersion, plannedStart: .now, expectedDurationSeconds: 120
        )
        stillScheduled.status = .scheduled

        let stats = BioLabAnalyticsService.bioreactorStats(
            bioreactors: [bioreactor], batches: [], executions: [completed, timedOut, stillScheduled], inspections: []
        )

        XCTAssertEqual(stats[0].availabilityRate ?? -1, 0.5, accuracy: 0.0001)
    }

    func testBioreactorStatsAvailabilityRateIsNilWithNoCompletedOrFailedCycles() {
        let bioreactor = Bioreactor(name: "BR1", code: "BR01", bioreactorType: .rita, totalVolumeLiters: 10, workingVolumeLiters: 8)
        let running = BioreactorCycleExecution(
            bioreactor: bioreactor, programVersion: nil, cycleType: .immersion, plannedStart: .now, expectedDurationSeconds: 120
        )
        running.status = .running

        let stats = BioLabAnalyticsService.bioreactorStats(
            bioreactors: [bioreactor], batches: [], executions: [running], inspections: []
        )

        XCTAssertNil(stats[0].availabilityRate)
    }
}
