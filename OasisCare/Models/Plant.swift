import Foundation
import SwiftData

@Model
final class Plant: Syncable {
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
    /// Nil means "created before Phase 3B sync existed" — treat as
    /// .pendingCreate. Optional purely for lightweight-migration safety on
    /// already-persisted rows; always set explicitly for new objects.
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var garden: Garden?
    var zone: GardenZone?
    var speciesProfile: SpeciesProfile?

    /// Spec §24 — all optional, "les coordonnées restent facultatives."
    /// latitude/longitude place the plant on the real MapKit map.
    /// mapPositionX/Y are a reserved, currently-unused seam for a
    /// future custom garden-plan-image overlay (spec §30: "conserver
    /// également... pour permettre plus tard d'utiliser un plan/image
    /// du jardin" — no drawing tool built now, just the columns).
    var latitude: Double?
    var longitude: Double?
    var mapPositionX: Double?
    var mapPositionY: Double?
    var positionSource: String?

    /// Spec §34 — per-plant emitters within its irrigation zone.
    var irrigationZone: IrrigationZone?
    var emitterCount: Int?
    var emitterFlowRate: Double?

    @Relationship(deleteRule: .cascade, inverse: \CareEvent.plant)
    var careEvents: [CareEvent] = []

    @Relationship(deleteRule: .cascade, inverse: \CareSchedule.plant)
    var careSchedules: [CareSchedule] = []

    @Relationship(deleteRule: .cascade, inverse: \PlantPhoto.plant)
    var photos: [PlantPhoto] = []

    @Relationship(deleteRule: .cascade, inverse: \AIAnalysis.plant)
    var aiAnalyses: [AIAnalysis] = []

    @Relationship(deleteRule: .cascade, inverse: \SmartTag.plant)
    var smartTags: [SmartTag] = []

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
        speciesProfile: SpeciesProfile? = nil,
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
        self.speciesProfile = speciesProfile
        self.photoData = photoData
        self.thumbnailData = thumbnailData
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
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

    var hasMapPosition: Bool { latitude != nil && longitude != nil }
}
