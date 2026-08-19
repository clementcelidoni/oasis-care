import Foundation
import SwiftData

/// Spec Phase 6D — "créer IrrigationPipe : diameter, material, length,
/// startNode, endNode." A drawn polyline (2+ points, so a pipe can
/// bend) rather than a straight line between two fixed nodes — the
/// spec's own editor description ("puis dessine") implies a drawn
/// path, not just an A-to-B segment. startNode/endNode are optional
/// GardenMapObject ids (typically a valve/waterSource/sprinkler/pump at
/// each end) resolved the same lookup way as GardenMapObject's own
/// linkedEntityId — see GardenMapEngine.resolvedPipeNode.
@Model
final class IrrigationPipe: Syncable {
    var id: UUID
    var garden: Garden?
    var points: [GardenCoordinate]
    var diameterMM: Double
    var material: PipeMaterial
    var lineType: PipeLineType
    var startNodeObjectId: UUID?
    var endNodeObjectId: UUID?
    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: SyncStatus?

    /// Spec Phase 6D — "afficher : Longueur : 12,4 m." Computed from the
    /// actual drawn points rather than stored, so it can never drift out
    /// of sync with the shape the user drew (Mesurée, from the plan's
    /// own coordinates — not a separate figure to keep in sync by hand).
    var totalLengthMeters: Double {
        guard points.count >= 2 else { return 0 }
        var total = 0.0
        for index in 1..<points.count {
            total += points[index].distance(to: points[index - 1])
        }
        return total
    }

    init(garden: Garden?, lineType: PipeLineType, diameterMM: Double = 25, material: PipeMaterial = .pe, points: [GardenCoordinate] = []) {
        self.id = UUID()
        self.garden = garden
        self.points = points
        self.diameterMM = diameterMM
        self.material = material
        self.lineType = lineType
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }
}
