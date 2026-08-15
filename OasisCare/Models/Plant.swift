import Foundation
import SwiftData

@Model
final class Plant {
    var id: UUID
    var customName: String
    var commonName: String?
    var scientificName: String?
    var type: PlantType
    var isIndoor: Bool
    var notes: String
    var dateAdded: Date
    var healthStatus: HealthStatus
    var isArchived: Bool

    var garden: Garden?
    var zone: GardenZone?

    @Relationship(deleteRule: .cascade, inverse: \CareEvent.plant)
    var careEvents: [CareEvent] = []

    @Relationship(deleteRule: .cascade, inverse: \CareSchedule.plant)
    var careSchedules: [CareSchedule] = []

    init(
        customName: String,
        commonName: String? = nil,
        scientificName: String? = nil,
        type: PlantType = .houseplant,
        isIndoor: Bool = true,
        notes: String = "",
        dateAdded: Date = .now,
        healthStatus: HealthStatus = .healthy,
        garden: Garden? = nil,
        zone: GardenZone? = nil
    ) {
        self.id = UUID()
        self.customName = customName
        self.commonName = commonName
        self.scientificName = scientificName
        self.type = type
        self.isIndoor = isIndoor
        self.notes = notes
        self.dateAdded = dateAdded
        self.healthStatus = healthStatus
        self.isArchived = false
        self.garden = garden
        self.zone = zone
    }

    /// Care history, most recent first.
    var sortedCareEvents: [CareEvent] {
        careEvents.sorted { $0.date > $1.date }
    }

    func schedule(for type: CareEventType) -> CareSchedule? {
        careSchedules.first { $0.type == type }
    }
}
