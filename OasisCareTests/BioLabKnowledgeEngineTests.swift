import XCTest
@testable import OasisCare

final class BioLabKnowledgeEngineTests: XCTestCase {
    func testPerformanceOnlyIncludesVersionsWithAtLeastOneBatch() {
        let recipe = MediumRecipe(name: "MS", speciesName: "Monstera")
        let usedVersion = MediumRecipeVersion(recipe: recipe, versionNumber: 1, targetPH: 5.8, components: [])
        let unusedVersion = MediumRecipeVersion(recipe: recipe, versionNumber: 2, targetPH: 5.8, components: [])

        let batch = CultureBatch(batchCode: "A", speciesName: "Monstera", initialExplantCount: 10)
        batch.mediumRecipeVersion = usedVersion
        batch.currentCount = 20

        let performances = BioLabKnowledgeEngine.performance(for: [usedVersion, unusedVersion], batches: [batch], acclimatizationBatches: [])

        XCTAssertEqual(performances.count, 1)
        XCTAssertEqual(performances[0].versionId, usedVersion.id)
        XCTAssertEqual(performances[0].batchCount, 1)
        XCTAssertEqual(performances[0].averageMultiplicationRate ?? -1, 2.0, accuracy: 0.0001)
    }
}

final class ProtocolPerformanceScoreTests: XCTestCase {
    func testSingleCandidateHasNoScore() {
        let performance = RecipeVersionPerformance(
            versionId: UUID(), batchCount: 5, averageMultiplicationRate: 3.0, contaminationRate: 0,
            hyperhydricityRate: 0, rootingRate: 1, survivalRate: 1
        )
        let scored = ProtocolPerformanceScore.score([performance])
        XCTAssertNil(scored[0].score)
    }

    func testHigherMultiplicationScoresHigherWhenOtherMetricsEqual() {
        let idLow = UUID()
        let idHigh = UUID()
        let low = RecipeVersionPerformance(
            versionId: idLow, batchCount: 5, averageMultiplicationRate: 1.5, contaminationRate: 0.1,
            hyperhydricityRate: 0.1, rootingRate: 0.8, survivalRate: 0.8
        )
        let high = RecipeVersionPerformance(
            versionId: idHigh, batchCount: 5, averageMultiplicationRate: 3.5, contaminationRate: 0.1,
            hyperhydricityRate: 0.1, rootingRate: 0.8, survivalRate: 0.8
        )
        let scored = ProtocolPerformanceScore.score([low, high])
        let lowScore = try! XCTUnwrap(scored.first { $0.versionId == idLow }?.score)
        let highScore = try! XCTUnwrap(scored.first { $0.versionId == idHigh }?.score)
        XCTAssertGreaterThan(highScore, lowScore)
    }

    func testMissingMetricsAreExcludedRatherThanTreatedAsZero() {
        let idA = UUID()
        let idB = UUID()
        let a = RecipeVersionPerformance(
            versionId: idA, batchCount: 1, averageMultiplicationRate: 2.0, contaminationRate: nil,
            hyperhydricityRate: nil, rootingRate: nil, survivalRate: nil
        )
        let b = RecipeVersionPerformance(
            versionId: idB, batchCount: 1, averageMultiplicationRate: 4.0, contaminationRate: nil,
            hyperhydricityRate: nil, rootingRate: nil, survivalRate: nil
        )
        let scored = ProtocolPerformanceScore.score([a, b])
        XCTAssertNotNil(scored.first { $0.versionId == idA }?.score)
        XCTAssertNotNil(scored.first { $0.versionId == idB }?.score)
    }
}

final class MediaCostServiceTests: XCTestCase {
    func testEstimatedCostIsCompleteWhenEveryIngredientIsCosted() {
        let compoundId = UUID()
        let component = MediumComponentAmount(type: .sugar, name: "Saccharose", amount: 30, unit: .gramsPerLiter, compoundId: compoundId)
        let estimate = MediaCostService.estimatedCost(
            for: [component], targetVolumeLiters: 1, molecularWeightByCompoundId: [:],
            costPerBaseUnitByCompoundId: [compoundId: 0.01] // 0.01 currency unit per gram
        )
        let unwrapped = try! XCTUnwrap(estimate)
        XCTAssertTrue(unwrapped.isComplete)
        XCTAssertEqual(unwrapped.totalCost, 0.30, accuracy: 0.0001) // 30 g * 0.01/g
        XCTAssertEqual(unwrapped.missingIngredientCount, 0)
    }

    func testEstimatedCostIsIncompleteWhenAnIngredientHasNoKnownCost() {
        let costedId = UUID()
        let costed = MediumComponentAmount(type: .sugar, name: "Saccharose", amount: 30, unit: .gramsPerLiter, compoundId: costedId)
        let uncosted = MediumComponentAmount(type: .basalMedium, name: "MS", amount: 4.4, unit: .gramsPerLiter, compoundId: UUID())

        let estimate = MediaCostService.estimatedCost(
            for: [costed, uncosted], targetVolumeLiters: 1, molecularWeightByCompoundId: [:],
            costPerBaseUnitByCompoundId: [costedId: 0.01]
        )
        let unwrapped = try! XCTUnwrap(estimate)
        XCTAssertFalse(unwrapped.isComplete)
        XCTAssertEqual(unwrapped.missingIngredientCount, 1)
    }

    func testEstimatedCostIsNilWhenNothingCanBeCosted() {
        let component = MediumComponentAmount(type: .sugar, name: "Saccharose", amount: 30, unit: .gramsPerLiter)
        let estimate = MediaCostService.estimatedCost(
            for: [component], targetVolumeLiters: 1, molecularWeightByCompoundId: [:], costPerBaseUnitByCompoundId: [:]
        )
        XCTAssertNil(estimate)
    }
}
