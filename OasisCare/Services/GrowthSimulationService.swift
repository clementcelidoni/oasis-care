import Foundation

/// Spec Phase 6G — "GardenTimeline... mode futur: GrowthSimulationService.
/// Utiliser espèce, taille actuelle, croissance indicative, taille
/// adulte. Simulation prudente." Exponential approach to the adult
/// size — the shape spec's own worked example implies (equal time
/// steps show a shrinking size delta: +1,3 m then +1,0 m over two
/// equal five-year spans), matching how real trees grow fastest while
/// young and slow down approaching mature size, not linear growth,
/// which would keep adding the same amount forever.
enum GrowthSimulationService {
    /// `yearsToMaturity` is Saisie utilisateur
    /// (GardenMapObject.estimatedYearsToMaturity) — this app has no
    /// species-specific growth-rate database, so the rate constant is
    /// chosen so ~90% of the total growth completes by that user-given
    /// year: a conservative, explainable assumption ("simulation
    /// prudente"), not a claim of botanical precision.
    static func projectedCanopyDiameterMeters(currentMeters: Double, adultMeters: Double, yearsFromNow: Double, yearsToMaturity: Double) -> Double {
        guard adultMeters > currentMeters, yearsToMaturity > 0, yearsFromNow > 0 else { return currentMeters }
        let rateConstant = log(10) / yearsToMaturity
        let projected = adultMeters - (adultMeters - currentMeters) * exp(-rateConstant * yearsFromNow)
        return max(projected, currentMeters)
    }

    struct CollisionWarning {
        var firstObjectId: UUID
        var secondObjectId: UUID
        var overlapMeters: Double
    }

    /// Spec: "ces deux végétaux pourraient se chevaucher fortement à
    /// maturité." A circle-overlap test on projected canopy diameters
    /// — not shape-accurate (real canopies aren't circles), but
    /// consistent with how every canopy is already drawn on the plan.
    static func detectCollisions(objects: [(id: UUID, position: GardenCoordinate, projectedDiameterMeters: Double)]) -> [CollisionWarning] {
        var warnings: [CollisionWarning] = []
        for i in 0..<objects.count {
            for j in (i + 1)..<objects.count {
                let first = objects[i]
                let second = objects[j]
                let distance = first.position.distance(to: second.position)
                let combinedRadii = first.projectedDiameterMeters / 2 + second.projectedDiameterMeters / 2
                let overlap = combinedRadii - distance
                // "fortement" (significantly) — require more than a
                // token graze before flagging, so two canopies just
                // barely touching don't trigger a warning for something
                // gardeners routinely allow.
                if overlap > min(first.projectedDiameterMeters, second.projectedDiameterMeters) * 0.2 {
                    warnings.append(CollisionWarning(firstObjectId: first.id, secondObjectId: second.id, overlapMeters: overlap))
                }
            }
        }
        return warnings
    }

    struct ProximityWarning {
        var objectId: UUID
        var structureId: UUID
        var clearanceMeters: Double
    }

    /// Spec: "taille adulte estimée proche du mur... ne pas transformer
    /// cela en recommandation structurelle absolue." A distance flag
    /// only — never a claim about root damage, foundation risk, or
    /// anything else this app has no basis to assess.
    static func detectStructureProximity(
        vegetation: [(id: UUID, position: GardenCoordinate, projectedDiameterMeters: Double)],
        structures: [(id: UUID, position: GardenCoordinate, widthMeters: Double)],
        thresholdMeters: Double = 1.0
    ) -> [ProximityWarning] {
        var warnings: [ProximityWarning] = []
        for plant in vegetation {
            for structure in structures {
                let distance = plant.position.distance(to: structure.position)
                let clearance = distance - plant.projectedDiameterMeters / 2 - structure.widthMeters / 2
                if clearance < thresholdMeters {
                    warnings.append(ProximityWarning(objectId: plant.id, structureId: structure.id, clearanceMeters: max(clearance, 0)))
                }
            }
        }
        return warnings
    }
}
