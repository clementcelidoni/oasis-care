import Foundation
import SwiftData

/// Calls the propose-irrigation Edge Function and turns an accepted
/// proposal into real sprinkler GardenMapObjects (spec Phase 6D:
/// "l'utilisateur doit confirmer"). Mirrors AutomationAIService's shape
/// (Phase 5J) — this is the ONLY place that turns an IrrigationProposal
/// into real objects, and it only runs from the reviewed-proposal
/// sheet's own explicit "Créer" button.
enum IrrigationAIService {
    struct ZoneContext: Encodable {
        var zoneTypeLabel: String
        var points: [GardenCoordinate]
        var widthMeters: Double
        var heightMeters: Double
        var areaSquareMeters: Double
        var vegetationSummary: String?
        var availableFlowRateLitersPerHour: Double?
    }

    static func propose(zone: GardenArea, garden: Garden, availableFlowRateLitersPerHour: Double?) async throws -> IrrigationProposal {
        struct RequestBody: Encodable {
            var context: ZoneContext
        }
        return try await AIBackend.invoke(
            "propose-irrigation",
            body: RequestBody(context: buildContext(zone: zone, garden: garden, availableFlowRateLitersPerHour: availableFlowRateLitersPerHour))
        )
    }

    private static func buildContext(zone: GardenArea, garden: Garden, availableFlowRateLitersPerHour: Double?) -> ZoneContext {
        let boundingSize = GardenGeometry.boundingSize(of: zone.points)
        return ZoneContext(
            zoneTypeLabel: zone.areaType.label,
            points: zone.points,
            widthMeters: boundingSize.widthMeters,
            heightMeters: boundingSize.heightMeters,
            areaSquareMeters: zone.areaSquareMeters,
            vegetationSummary: vegetationSummary(in: zone, garden: garden),
            availableFlowRateLitersPerHour: availableFlowRateLitersPerHour
        )
    }

    private static func vegetationSummary(in zone: GardenArea, garden: Garden) -> String? {
        let vegetationObjects = garden.mapObjects.filter {
            $0.objectType.isVegetation && GardenGeometry.contains($0.position, polygon: zone.points)
        }
        guard !vegetationObjects.isEmpty else { return nil }
        let counts = Dictionary(grouping: vegetationObjects, by: { $0.objectType.label }).mapValues(\.count)
        return counts.map { "\($0.value) \($0.key.lowercased())" }.sorted().joined(separator: ", ")
    }

    /// Spec Phase 6D's "l'utilisateur doit confirmer": calling this at
    /// all — from the reviewed-proposal sheet's own explicit "Créer"
    /// button — is that confirmation step.
    @discardableResult
    static func createSprinklers(from proposal: IrrigationProposal, garden: Garden, engine: GardenMapEngine, context: ModelContext) -> [GardenMapObject] {
        proposal.sprinklers.map { sprinklerProposal in
            let object = engine.addObject(
                type: .sprinkler,
                at: GardenCoordinate(xMeters: sprinklerProposal.xMeters, yMeters: sprinklerProposal.yMeters),
                context: context
            )
            engine.setSprinklerParameters(
                object, radiusMeters: sprinklerProposal.radiusMeters,
                startAngleDegrees: sprinklerProposal.startAngleDegrees, endAngleDegrees: sprinklerProposal.endAngleDegrees,
                flowRateLitersPerHour: nil, context: context
            )
            engine.renameObject(object, label: sprinklerProposal.kind, context: context)
            return object
        }
    }
}
