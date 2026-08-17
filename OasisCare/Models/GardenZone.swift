import Foundation
import SwiftData

@Model
final class GardenZone: Syncable {
    var id: UUID
    var name: String
    var notes: String
    var garden: Garden?
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    @Relationship(deleteRule: .nullify, inverse: \Plant.zone)
    var plants: [Plant] = []

    @Relationship(deleteRule: .nullify, inverse: \ConnectedDevice.zone)
    var connectedDevices: [ConnectedDevice] = []

    init(name: String, notes: String = "", garden: Garden? = nil) {
        self.id = UUID()
        self.name = name
        self.notes = notes
        self.garden = garden
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
