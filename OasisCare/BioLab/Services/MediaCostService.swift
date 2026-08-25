import Foundation

/// Enhancement "COÛT DES RECETTES" + §20 "COÛT PAR PLANTULE VIABLE."
/// Pure calculation over already-resolved per-compound unit costs (the
/// caller decides how to reduce a compound's `InventoryLot`s to one
/// `costPerBaseUnit` — most recent lot, average, cheapest... a business
/// choice this service shouldn't bake in) — no SwiftData access here.
enum MediaCostService {
    struct Estimate {
        var totalCost: Double
        /// §20 "Toujours préciser Estimation si tous les coûts ne sont
        /// pas renseignés" — false whenever at least one ingredient's
        /// cost was unknown, so the caller can label the number as a
        /// partial estimate rather than a complete total.
        var isComplete: Bool
        var missingIngredientCount: Int
    }

    /// `costPerBaseUnitByCompoundId` — cost per gram (mass compounds) or
    /// per liter (volume compounds), i.e. already normalized to
    /// `AmountUnit.baseUnitsPerUnit == 1`. An ingredient with no
    /// `compoundId`, or a compound with no known cost, is simply
    /// excluded from the total rather than guessed at — see
    /// `Estimate.isComplete`. Returns nil only when *nothing* could be
    /// costed at all, since a "total" with zero real inputs isn't a
    /// partial estimate, it's no information.
    static func estimatedCost(
        for components: [MediumComponentAmount], targetVolumeLiters: Double,
        molecularWeightByCompoundId: [UUID: Double], costPerBaseUnitByCompoundId: [UUID: Double]
    ) -> Estimate? {
        var totalCost = 0.0
        var costedCount = 0
        var missingCount = 0

        for component in components {
            guard let compoundId = component.compoundId, let costPerBaseUnit = costPerBaseUnitByCompoundId[compoundId] else {
                missingCount += 1
                continue
            }
            let result = MediaRecipeCalculator.calculatedAmount(
                for: component, targetVolumeLiters: targetVolumeLiters, molecularWeight: molecularWeightByCompoundId[compoundId]
            )
            guard case .success(let calculated) = result else {
                missingCount += 1
                continue
            }
            totalCost += calculated.amount * calculated.unit.baseUnitsPerUnit * costPerBaseUnit
            costedCount += 1
        }

        guard costedCount > 0 else { return nil }
        return Estimate(totalCost: totalCost, isComplete: missingCount == 0, missingIngredientCount: missingCount)
    }

    static func costPerLiter(_ estimate: Estimate, targetVolumeLiters: Double) -> Double? {
        guard targetVolumeLiters > 0 else { return nil }
        return estimate.totalCost / targetVolumeLiters
    }

    /// §20 — only when a real, positive viable-plantlet count is known;
    /// never divides by an assumed count.
    static func costPerViablePlantlet(_ estimate: Estimate, viablePlantletCount: Int) -> Double? {
        guard viablePlantletCount > 0 else { return nil }
        return estimate.totalCost / Double(viablePlantletCount)
    }
}
