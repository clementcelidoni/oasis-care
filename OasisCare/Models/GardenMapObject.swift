import Foundation
import SwiftData

/// Spec Phase 6C — a generic placed item on OasisPlan: one of 23
/// catalogued types (GardenObjectType), positioned in local meters,
/// with rotation/footprint/stacking order, optionally linked to a real
/// Oasis record (spec: "chaque élément du plan peut être associé à une
/// vraie entité... toucher l'objet ouvre la vraie fiche") or left
/// standalone (spec's own examples: rocher, mur, banc, escalier —
/// "sans créer artificiellement un Plant").
///
/// `linkedEntityId`/`linkedEntityKind` are a plain UUID + discriminator
/// rather than a typed SwiftData relationship: this one object type
/// needs to point at any of several unrelated model types (Plant,
/// Sensor, ...), which `@Relationship` has no way to express — SwiftData
/// relationships are always to one concrete type. The tradeoff is that
/// a dangling reference (the linked record was deleted) has to be
/// handled gracefully at resolve time instead of SwiftData
/// automatically nullifying it — GardenMapEngine's `resolveLinkedPlant`/
/// `resolveLinkedSensor` do that by treating "lookup fails" as "not
/// linked," never as an error.
@Model
final class GardenMapObject: Syncable {
    var id: UUID
    var garden: Garden?
    var objectType: GardenObjectType
    var position: GardenCoordinate
    var rotationRadians: Double
    var widthMeters: Double
    var heightMeters: Double
    var zIndex: Int
    var label: String?

    var linkedEntityId: UUID?
    var linkedEntityKind: GardenObjectLinkKind?

    /// Spec Phase 6C — "le diamètre graphique du houppier doit être
    /// basé sur canopyDiameter si disponible" + "taille actuelle /
    /// taille adulte estimée." Only meaningful when objectType is
    /// vegetation; nil elsewhere. Both User-entered (Saisie
    /// utilisateur) unless a linked Plant's own measurement supplies
    /// the current one — never a measured value Oasis invented itself.
    var canopyDiameterMeters: Double?
    var estimatedAdultCanopyDiameterMeters: Double?
    /// Spec Phase 6G — GrowthSimulationService's rate assumption for
    /// this specific plant, Saisie utilisateur (see
    /// GardenObjectType.defaultYearsToMaturity for the starting default).
    var estimatedYearsToMaturity: Double?

    /// Spec Phase 6D — SprinklerMapObject's parameters, folded into the
    /// same shared model rather than a second one (same reasoning as
    /// canopy above): only meaningful when objectType == .sprinkler.
    /// Angles are degrees, 0 = east, increasing counter-clockwise,
    /// matching GardenCoordinate's own axis convention.
    var sprinklerRadiusMeters: Double?
    var sprinklerStartAngleDegrees: Double?
    var sprinklerEndAngleDegrees: Double?
    var sprinklerFlowRateLitersPerHour: Double?

    /// Spec Phase 6F — vertical height for shadow-casting, distinct
    /// from widthMeters/heightMeters above (which are the ground
    /// footprint, not elevation). Only meaningful for
    /// objectType.castsShadow; nil elsewhere.
    var structureHeightMeters: Double?

    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: SyncStatus?

    init(garden: Garden?, objectType: GardenObjectType, position: GardenCoordinate) {
        self.id = UUID()
        self.garden = garden
        self.objectType = objectType
        self.position = position
        self.rotationRadians = 0
        self.widthMeters = objectType.defaultWidthMeters
        self.heightMeters = objectType.defaultHeightMeters
        self.zIndex = 0
        if objectType == .sprinkler {
            self.sprinklerRadiusMeters = 4
            self.sprinklerStartAngleDegrees = 0
            self.sprinklerEndAngleDegrees = 360
        }
        self.structureHeightMeters = objectType.defaultStructureHeightMeters
        self.estimatedYearsToMaturity = objectType.defaultYearsToMaturity
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }
}
