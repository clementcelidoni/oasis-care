import Foundation

/// Enhancement "INTÉGRATION INVENTAIRE" — "proposer de déduire du
/// stock... ne pas déduire avant confirmation." Pure proposal-building
/// logic; the actual deduction only ever happens where the caller has
/// already gotten an explicit yes (see GuidedMediaPreparationView).
enum InventoryDeductionService {
    struct Proposal: Identifiable {
        var id: UUID { lot.id }
        var lot: InventoryLot
        var compoundName: String
        var amountToDeduct: Double
        var unit: AmountUnit
    }

    /// One proposal per ingredient that both names a compound and has
    /// at least one non-expired lot with remaining quantity in a
    /// compatible unit — an ingredient with no matching lot is simply
    /// not proposed, never a forced/blocked preparation.
    static func proposals(for batch: MediumBatch, lots: [InventoryLot]) -> [Proposal] {
        guard let components = batch.recipeVersion?.components else { return [] }
        let componentsByID = Dictionary(uniqueKeysWithValues: components.map { ($0.id, $0) })

        return batch.compoundLots.compactMap { ingredient -> Proposal? in
            let amount = ingredient.actualAmount ?? ingredient.targetAmount
            guard let component = componentsByID[ingredient.ingredientId], let compoundId = component.compoundId else { return nil }
            let candidateLot = lots.first { lot in
                lot.compound?.id == compoundId && !lot.isExpired && lot.quantityRemaining > 0 && lot.unit.isMass == ingredient.amountUnit.isMass
            }
            guard let candidateLot, let converted = MediaRecipeCalculator.convert(amount, from: ingredient.amountUnit, to: candidateLot.unit) else { return nil }
            return Proposal(lot: candidateLot, compoundName: component.name, amountToDeduct: converted, unit: candidateLot.unit)
        }
    }

    /// Only ever called after explicit user confirmation. Clamped at 0
    /// rather than going negative — a lot reading "0 restant" is a real
    /// signal to reorder, not a broken number.
    static func apply(_ proposal: Proposal) {
        proposal.lot.quantityRemaining = max(0, proposal.lot.quantityRemaining - proposal.amountToDeduct)
        proposal.lot.markDirty()
    }
}
