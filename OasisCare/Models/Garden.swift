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
