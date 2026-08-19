import Foundation
import SwiftData

/// Spec Phase 6C — "une zone est un polygone éditable": a typed,
/// colored region (pelouse, massif, zone interdite...), edited with the
/// exact same point/handle/snap/undo mechanics GardenMapEngine already
/// applies to GardenBoundary — the only difference is which points
/// array is being edited. Unlike GardenBoundary, a garden has many of
/// these, so it's independently user-deletable (see
/// DeletionService.EntityType.gardenArea).
@Model
final class GardenArea: Syncable {
    var id: UUID
    var garden: Garden?
    var areaType: GardenAreaType
    var name: String
    var points: [GardenCoordinate]

    /// Spec Phase 6F — GardenMicroclimate's descriptive fields (see
    /// MicroclimateDescriptors.swift's own doc comment for why these
    /// live here rather than a separate model). All Saisie utilisateur
    /// — the temperature delta itself isn't stored here at all, since
    /// it's Calculée fresh from current sensor readings when available
    /// rather than a figure that could go stale (see
    /// GardenAreasSheet.microclimateTemperatureDelta).
    var microclimateSunLevel: MicroclimateSunLevel?
    var microclimateWindLevel: MicroclimateWindLevel?
    var microclimateSoilLevel: MicroclimateSoilLevel?
    var microclimateNotes: String?

    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: SyncStatus?

    init(garden: Garden?, areaType: GardenAreaType, name: String = "", points: [GardenCoordinate] = []) {
        self.id = UUID()
        self.garden = garden
        self.areaType = areaType
        self.name = name
        self.points = points
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }

    /// Calculée (shoelace formula) from the drawn points — never a
    /// separate figure to keep in sync by hand.
    var areaSquareMeters: Double {
        GardenGeometry.areaSquareMeters(of: points)
    }
}
