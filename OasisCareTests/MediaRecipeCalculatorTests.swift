import XCTest
@testable import OasisCare

/// MediaRecipeCalculator's own doc comment: never guesses a mass from a
/// molar concentration without a real molecular weight, never converts
/// mass↔volume. These numbers are what a real preparation checklist
/// tells the user to weigh out, so a silent unit-conversion bug here is
/// the same risk category as IrrigationCalculatorTests' worked example.
final class MediaRecipeCalculatorTests: XCTestCase {
    func testGramsPerLiterScalesLinearlyWithVolume() {
        let component = MediumComponentAmount(type: .basalMedium, name: "MS", amount: 4.4, unit: .gramsPerLiter)
        let result = MediaRecipeCalculator.calculatedAmount(for: component, targetVolumeLiters: 0.5, molecularWeight: nil)
        guard case .success(let calculated) = result else { return XCTFail("expected success") }
        XCTAssertEqual(calculated.amount, 2.2, accuracy: 0.0001)
        XCTAssertEqual(calculated.unit, .gram)
    }

    func testMilligramsPerLiterProducesMilligrams() {
        let component = MediumComponentAmount(type: .additive, name: "Test", amount: 100, unit: .milligramsPerLiter)
        let result = MediaRecipeCalculator.calculatedAmount(for: component, targetVolumeLiters: 2, molecularWeight: nil)
        guard case .success(let calculated) = result else { return XCTFail("expected success") }
        XCTAssertEqual(calculated.amount, 200, accuracy: 0.0001)
        XCTAssertEqual(calculated.unit, .milligram)
    }

    func testMicromolarConvertsToMassUsingMolecularWeight() {
        // 4.44 µM × 1 L × 225.25 g/mol (BAP) ≈ 1.0 mg.
        let component = MediumComponentAmount(type: .plantGrowthRegulator, name: "BAP", amount: 4.44, unit: .micromolar)
        let result = MediaRecipeCalculator.calculatedAmount(for: component, targetVolumeLiters: 1, molecularWeight: 225.25)
        guard case .success(let calculated) = result else { return XCTFail("expected success") }
        XCTAssertEqual(calculated.unit, .gram)
        XCTAssertEqual(calculated.amount, 0.001, accuracy: 0.0001)
    }

    func testMolarityWithoutMolecularWeightFailsRatherThanGuessing() {
        let component = MediumComponentAmount(type: .plantGrowthRegulator, name: "BAP", amount: 4.44, unit: .micromolar)
        let result = MediaRecipeCalculator.calculatedAmount(for: component, targetVolumeLiters: 1, molecularWeight: nil)
        XCTAssertEqual(result, .failure(.molecularWeightRequired))
    }

    func testConvertBetweenMassUnits() {
        XCTAssertEqual(MediaRecipeCalculator.convert(1000, from: .milligram, to: .gram) ?? -1, 1, accuracy: 0.0001)
        XCTAssertEqual(MediaRecipeCalculator.convert(1, from: .gram, to: .milligram) ?? -1, 1000, accuracy: 0.0001)
    }

    func testConvertRefusesMassToVolume() {
        XCTAssertNil(MediaRecipeCalculator.convert(1, from: .gram, to: .milliliter))
    }

    func testStockSolutionVolumeUsesSimpleDilutionRatio() {
        let stock = StockSolution(
            compound: nil, name: "BAP stock", concentration: 1000, concentrationUnit: .milligramsPerLiter, preparedVolumeLiters: 0.1
        )
        let volume = MediaRecipeCalculator.stockSolutionVolumeLiters(
            targetConcentration: 5, targetUnit: .milligramsPerLiter, targetVolumeLiters: 1, stock: stock
        )
        XCTAssertEqual(volume ?? -1, 0.005, accuracy: 0.000_001)
    }

    func testStockSolutionVolumeIsNilForIncompatibleUnitKinds() {
        let stock = StockSolution(
            compound: nil, name: "BAP stock", concentration: 1000, concentrationUnit: .milligramsPerLiter, preparedVolumeLiters: 0.1
        )
        let volume = MediaRecipeCalculator.stockSolutionVolumeLiters(
            targetConcentration: 5, targetUnit: .micromolar, targetVolumeLiters: 1, stock: stock
        )
        XCTAssertNil(volume)
    }
}
