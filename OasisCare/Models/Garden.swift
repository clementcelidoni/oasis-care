import Foundation
import SwiftData

@Model
final class Garden: Syncable {
    var id: UUID
    var name: String
    var address: String?
    var notes: String
    var dateCreated: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    /// Spec §16 — optional, manual entry or "use my location" (never
    /// requested automatically). weatherEnabled gates whether the
    /// dashboard tries to show a weather card for this garden at all,
    /// so a garden with coordinates set can still opt out.
    var latitude: Double?
    var longitude: Double?
    var locationName: String?
    // Inline default (not just in init) so SwiftData's automatic migration
    // recognizes this property on devices with pre-existing Garden rows —
    // an init-only default is invisible to migration inference and left
    // existing installs unable to open their store (Phase 4B regression).
    var weatherEnabled: Bool = false
    /// Spec Phase 6A — "le mode préféré est mémorisé par jardin." Inline
    /// default, same migration-safety reasoning as weatherEnabled above.
    /// The @Model macro needs the fully-qualified name here — plain
    /// `.oasisPlan` shorthand fails to compile with "A default value
    /// requires a fully qualified domain named value" (its macro
    /// expansion can't resolve implicit-member syntax the way normal
    /// type-inferred contexts can).
    var preferredMapMode: GardenMapMode = GardenMapMode.oasisPlan

    @Relationship(deleteRule: .cascade, inverse: \GardenZone.garden)
    var zones: [GardenZone] = []

    @Relationship(deleteRule: .nullify, inverse: \Plant.garden)
    var plants: [Plant] = []

    @Relationship(deleteRule: .cascade, inverse: \IrrigationZone.garden)
    var irrigationZones: [IrrigationZone] = []

    @Relationship(deleteRule: .cascade, inverse: \GardenCheckup.garden)
    var checkups: [GardenCheckup] = []

    @Relationship(deleteRule: .cascade, inverse: \Sensor.garden)
    var sensors: [Sensor] = []

    // .nullify, not .cascade like sensors above: a ConnectedDevice
    // represents a real physical accessory that keeps existing (and
    // stays visible via HomeKitService) even if its garden assignment
    // in Oasis Care is removed.
    @Relationship(deleteRule: .nullify, inverse: \ConnectedDevice.garden)
    var connectedDevices: [ConnectedDevice] = []

    @Relationship(deleteRule: .cascade, inverse: \Greenhouse.garden)
    var greenhouses: [Greenhouse] = []

    @Relationship(deleteRule: .cascade, inverse: \Pond.garden)
    var ponds: [Pond] = []

    @Relationship(deleteRule: .cascade, inverse: \OasisScene.garden)
    var scenes: [OasisScene] = []

    /// Spec Phase 6B — the plan's outline. To-one, not to-many: a
    /// garden has at most one boundary shape.
    @Relationship(deleteRule: .cascade, inverse: \GardenBoundary.garden)
    var boundary: GardenBoundary?

    /// Spec Phase 6C — placed items and drawn zones on OasisPlan.
    @Relationship(deleteRule: .cascade, inverse: \GardenMapObject.garden)
    var mapObjects: [GardenMapObject] = []

    @Relationship(deleteRule: .cascade, inverse: \GardenArea.garden)
    var areas: [GardenArea] = []

    /// Spec Phase 6D — the drawn irrigation network's pipes.
    @Relationship(deleteRule: .cascade, inverse: \IrrigationPipe.garden)
    var irrigationPipes: [IrrigationPipe] = []

    /// Spec Phase 6K — the imported plan image the user traces over.
    /// To-one like `boundary` above: at most one imported plan per
    /// garden, and importing a new one replaces it (see
    /// GardenMapEngine.importPlanImage).
    @Relationship(deleteRule: .cascade, inverse: \GardenPlanImage.garden)
    var planImage: GardenPlanImage?

    init(name: String, address: String? = nil, notes: String = "", dateCreated: Date = .now) {
        self.id = UUID()
        self.name = name
        self.address = address
        self.notes = notes
        self.dateCreated = dateCreated
        self.weatherEnabled = false
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var hasLocation: Bool { latitude != nil && longitude != nil }
}
