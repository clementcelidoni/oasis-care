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
    var photoData: Data?
    var thumbnailData: Data?

    var garden: Garden?
    var zone: GardenZone?

    @Relationship(deleteRule: .cascade, inverse: \CareEvent.plant)
    var careEvents: [CareEvent] = []

    @Relationship(deleteRule: .cascade, inverse: \CareSchedule.plant)
    var careSchedules: [CareSchedule] = []

    @Relationship(deleteRule: .cascade, inverse: \PlantPhoto.plant)
    var photos: [PlantPhoto] = []

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
        zone: GardenZone? = nil,
        photoData: Data? = nil,
        thumbnailData: Data? = nil
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
        self.photoData = photoData
        self.thumbnailData = thumbnailData
    }

    /// Care history, most recent first.
    var sortedCareEvents: [CareEvent] {
        careEvents.sorted { $0.date > $1.date }
    }

    /// Photo history, most recent first.
    var sortedPhotos: [PlantPhoto] {
        photos.sorted { $0.date > $1.date }
    }

    func schedule(for type: CareEventType) -> CareSchedule? {
        careSchedules.first { $0.type == type }
    }
}
