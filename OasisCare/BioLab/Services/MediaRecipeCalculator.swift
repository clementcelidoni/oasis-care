import Foundation

/// Enhancement "GÉNÉRATEUR AUTOMATIQUE DE RECETTE" — pure, deterministic
/// unit conversion. Never guesses: a molarity-based unit (µM/mM/M)
/// refuses to produce a mass without a real `molecularWeight` (§13 "NE
/// PAS INVENTER"), and a mass↔volume conversion is refused outright
/// since it would need a density this app has no source for.
enum MediaRecipeCalculator {
    enum CalculationError: Error, Equatable {
        case molecularWeightRequired
        case incompatibleUnits
    }

    struct CalculatedAmount: Equatable {
        var amount: Double
        var unit: AmountUnit
    }

    /// §10-11: the absolute amount of one recipe component needed for
    /// `targetVolumeLiters` of final medium. `molecularWeight` is looked
    /// up by the caller (typically from the linked `LabCompound`) since
    /// this function stays free of any SwiftData/model-fetch concern.
    static func calculatedAmount(
        for component: MediumComponentAmount, targetVolumeLiters: Double, molecularWeight: Double?
    ) -> Result<CalculatedAmount, CalculationError> {
        let unit = component.unit
        if unit.requiresMolecularWeight {
            guard let molecularWeight, molecularWeight > 0 else { return .failure(.molecularWeightRequired) }
            guard let molarityScale = molarityScale(unit) else { return .failure(.incompatibleUnits) }
            let moles = component.amount * molarityScale * targetVolumeLiters
            return .success(CalculatedAmount(amount: moles * molecularWeight, unit: .gram))
        }
        guard let naturalUnit = naturalAmountUnit(unit) else { return .failure(.incompatibleUnits) }
        return .success(CalculatedAmount(amount: component.amount * targetVolumeLiters, unit: naturalUnit))
    }

    /// Re-expresses an amount in a different unit of the *same* kind
    /// (mass↔mass or volume↔volume only) — nil for a mass↔volume
    /// request rather than inventing a density.
    static func convert(_ amount: Double, from: AmountUnit, to: AmountUnit) -> Double? {
        guard from.isMass == to.isMass else { return nil }
        return amount * from.baseUnitsPerUnit / to.baseUnitsPerUnit
    }

    /// §14 "CALCUL AUTOMATIQUE" — volume of `stock` needed to deliver
    /// `targetConcentration targetUnit` into `targetVolumeLiters` of
    /// final medium (simple C₁V₁ = C₂V₂ dilution). nil when the two
    /// concentrations aren't the same physical kind (one molar, one
    /// mass-based, etc.) rather than a nonsensical ratio.
    static func stockSolutionVolumeLiters(
        targetConcentration: Double, targetUnit: ConcentrationUnit, targetVolumeLiters: Double, stock: StockSolution
    ) -> Double? {
        guard targetUnit.requiresMolecularWeight == stock.concentrationUnit.requiresMolecularWeight,
              targetUnit.isVolumeBased == stock.concentrationUnit.isVolumeBased,
              stock.concentration > 0 else { return nil }
        guard let targetBase = baseRate(targetConcentration, targetUnit),
              let stockBase = baseRate(stock.concentration, stock.concentrationUnit) else { return nil }
        return (targetBase * targetVolumeLiters) / stockBase
    }

    private static func molarityScale(_ unit: ConcentrationUnit) -> Double? {
        switch unit {
        case .molar: return 1
        case .millimolar: return 0.001
        case .micromolar: return 0.000_001
        case .gramsPerLiter, .milligramsPerLiter, .microgramsPerLiter, .millilitersPerLiter, .microlitersPerLiter: return nil
        }
    }

    private static func naturalAmountUnit(_ unit: ConcentrationUnit) -> AmountUnit? {
        switch unit {
        case .gramsPerLiter: return .gram
        case .milligramsPerLiter: return .milligram
        case .microgramsPerLiter: return .microgram
        case .millilitersPerLiter: return .milliliter
        case .microlitersPerLiter: return .microliter
        case .molar, .millimolar, .micromolar: return nil
        }
    }

    /// Normalizes a concentration to one fixed base rate per physical
    /// kind (g/L for mass-based units, mol/L for molarity, L/L for
    /// volume-based units), so two same-kind concentrations become
    /// directly comparable by division regardless of their original
    /// scale (mg vs g, µM vs M...).
    private static func baseRate(_ value: Double, _ unit: ConcentrationUnit) -> Double? {
        switch unit {
        case .gramsPerLiter: return value
        case .milligramsPerLiter: return value * 0.001
        case .microgramsPerLiter: return value * 0.000_001
        case .millilitersPerLiter: return value * 0.001
        case .microlitersPerLiter: return value * 0.000_001
        case .molar: return value
        case .millimolar: return value * 0.001
        case .micromolar: return value * 0.000_001
        }
    }
}
