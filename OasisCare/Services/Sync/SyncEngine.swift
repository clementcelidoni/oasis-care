import Foundation
import SwiftData
import Supabase

/// Pushes locally-pending changes to Supabase. Local-first: every write
/// already landed in SwiftData before this ever runs, so a slow or absent
/// network never blocks a user action — this only catches the cloud up in
/// the background, afterward.
///
/// Push-only for now: pulling another device's changes and resolving
/// conflicts aren't built yet (single-device use is fully covered). The
/// "import my local data" flow the spec calls for on first account
/// creation doesn't need separate code — every local record already
/// defaults to `.pendingCreate`, so a guest's very first sync after
/// signing in naturally pushes everything that already exists. Re-running
/// sync is safe: `upsert` keyed on the client-generated `id` never creates
/// a duplicate, it just re-writes the same row.
@MainActor
final class SyncEngine: ObservableObject {
    static let shared = SyncEngine()

    @Published private(set) var isSyncing = false
    @Published private(set) var lastSyncedAt: Date?
    @Published private(set) var lastSyncError: String?

    private init() {}

    func syncIfPossible(context: ModelContext) async {
        guard case .authenticated = AuthState.shared.status else { return }
        guard !isSyncing else { return }
        isSyncing = true
        defer { isSyncing = false }

        do {
            let workspaceID = try await fetchWorkspaceID()
            try await restoreFromCloudIfNeeded(context: context)
            try await pushGardens(workspaceID: workspaceID, context: context)
            try await pushZones(context: context)
            try await pushPlants(workspaceID: workspaceID, context: context)
            try await pushSchedules(context: context)
            try await pushEvents(context: context)
            try await pushPlantPhotos(workspaceID: workspaceID, context: context)
            try await pushAIAnalyses(context: context)
            try await pushPendingDeletions(context: context)
            try context.save()
            lastSyncError = nil
            lastSyncedAt = .now
        } catch {
            lastSyncError = error.localizedDescription
        }
    }

    /// Local records not yet confirmed synced, across every entity type —
    /// what Réglages shows as "N éléments en attente".
    func pendingCount(context: ModelContext) -> Int {
        let gardens = (try? context.fetch(FetchDescriptor<Garden>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let zones = (try? context.fetch(FetchDescriptor<GardenZone>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let plants = (try? context.fetch(FetchDescriptor<Plant>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let schedules = (try? context.fetch(FetchDescriptor<CareSchedule>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let events = (try? context.fetch(FetchDescriptor<CareEvent>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let photos = (try? context.fetch(FetchDescriptor<PlantPhoto>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let analyses = (try? context.fetch(FetchDescriptor<AIAnalysis>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let deletions = (try? context.fetchCount(FetchDescriptor<PendingDeletion>())) ?? 0
        return gardens + zones + plants + schedules + events + photos + analyses + deletions
    }

    private static let photoBucket = "plant-photos"

    private func uploadPhoto(_ data: Data, path: String) async throws {
        try await AuthService.client.storage
            .from(Self.photoBucket)
            .upload(path: path, file: data, options: FileOptions(contentType: "image/jpeg", upsert: true))
    }

    private func downloadPhoto(path: String) async throws -> Data {
        try await AuthService.client.storage.from(Self.photoBucket).download(path: path)
    }

    private func fetchWorkspaceID() async throws -> UUID {
        struct WorkspaceRow: Decodable {
            var id: UUID
        }
        let rows: [WorkspaceRow] = try await AuthService.client
            .from("workspaces")
            .select("id")
            .limit(1)
            .execute()
            .value
        guard let id = rows.first?.id else {
            throw SyncEngineError.noWorkspace
        }
        return id
    }

    // MARK: - Restore from cloud (new device)

    /// One-time recovery for validation criterion "récupérer mes données
    /// sur un nouvel appareil": if this device's local store has no
    /// gardens and no plants yet, treat that as a fresh install/new
    /// device under an existing account and pull everything the account
    /// already has in the cloud, rebuilding local objects with matching
    /// ids and `.synced` status.
    ///
    /// Deliberately NOT a general bidirectional/multi-device merge: if
    /// there is ANY local garden or plant already (e.g. guest data from
    /// before this sign-in), this does nothing and sync stays push-only,
    /// same as before — merging two non-empty data sets is a harder
    /// problem this phase doesn't attempt. `deleted_at` columns exist in
    /// the schema but nothing currently sets them (deletions are hard
    /// deletes — see pushPendingDeletions), so no extra filtering is
    /// needed here: a row coming back from SELECT is, by construction,
    /// not deleted.
    private func restoreFromCloudIfNeeded(context: ModelContext) async throws {
        let hasLocalGardens = ((try? context.fetchCount(FetchDescriptor<Garden>())) ?? 0) > 0
        let hasLocalPlants = ((try? context.fetchCount(FetchDescriptor<Plant>())) ?? 0) > 0
        guard !hasLocalGardens, !hasLocalPlants else { return }

        let remoteGardens: [GardenRow] = try await AuthService.client.from("gardens").select().execute().value
        guard !remoteGardens.isEmpty else { return }

        var gardensByID: [UUID: Garden] = [:]
        for row in remoteGardens {
            let garden = Garden(name: row.name, address: row.address, notes: row.notes, dateCreated: row.dateCreated)
            garden.id = row.id
            garden.syncStatus = .synced
            garden.updatedAt = row.updatedAt
            context.insert(garden)
            gardensByID[row.id] = garden
        }

        let remoteZones: [GardenZoneRow] = try await AuthService.client.from("garden_zones").select().execute().value
        var zonesByID: [UUID: GardenZone] = [:]
        for row in remoteZones {
            guard let garden = gardensByID[row.gardenId] else { continue }
            let zone = GardenZone(name: row.name, notes: row.notes, garden: garden)
            zone.id = row.id
            zone.syncStatus = .synced
            zone.updatedAt = row.updatedAt
            context.insert(zone)
            zonesByID[row.id] = zone
        }

        let remotePlants: [PlantRow] = try await AuthService.client.from("plants").select().execute().value
        var plantsByID: [UUID: Plant] = [:]
        for row in remotePlants {
            let plant = Plant(
                customName: row.customName, commonName: row.commonName, scientificName: row.scientificName,
                type: row.type, isIndoor: row.isIndoor, notes: row.notes, dateAdded: row.dateAdded,
                healthStatus: row.healthStatus, garden: row.gardenId.flatMap { gardensByID[$0] },
                zone: row.zoneId.flatMap { zonesByID[$0] }
            )
            plant.id = row.id
            plant.isArchived = row.isArchived
            plant.syncStatus = .synced
            plant.updatedAt = row.updatedAt
            if let path = row.photoStoragePath { plant.photoData = try? await downloadPhoto(path: path) }
            if let path = row.thumbnailStoragePath { plant.thumbnailData = try? await downloadPhoto(path: path) }
            context.insert(plant)
            plantsByID[row.id] = plant
        }

        let remoteSchedules: [CareScheduleRow] = try await AuthService.client.from("care_schedules").select().execute().value
        for row in remoteSchedules {
            guard let plant = plantsByID[row.plantId] else { continue }
            let schedule = CareSchedule(
                plant: plant, type: row.type, frequencyDays: row.frequencyDays, isActive: row.isActive,
                notes: row.notes, preferredTime: row.preferredTimeMinutes.map(Self.dateFromMinutesSinceMidnight),
                reminderEnabled: row.reminderEnabled
            )
            schedule.id = row.id
            schedule.lastCompletedDate = row.lastCompletedDate
            schedule.nextDueDate = row.nextDueDate
            schedule.syncStatus = .synced
            schedule.updatedAt = row.updatedAt
            context.insert(schedule)
        }

        let remoteEvents: [CareEventRow] = try await AuthService.client.from("care_events").select().execute().value
        for row in remoteEvents {
            guard let plant = plantsByID[row.plantId] else { continue }
            let event = CareEvent(
                plant: plant, type: row.type, date: row.date, notes: row.notes,
                quantity: row.quantity, unit: row.unit, product: row.product
            )
            event.id = row.id
            event.syncStatus = .synced
            context.insert(event)
        }

        let remotePhotos: [PlantPhotoRow] = try await AuthService.client.from("plant_photos").select().execute().value
        for row in remotePhotos {
            guard let plant = plantsByID[row.plantId] else { continue }
            guard let imageData = try? await downloadPhoto(path: row.storagePath),
                  let thumbnailData = try? await downloadPhoto(path: row.thumbnailStoragePath) else { continue }
            let photo = PlantPhoto(plant: plant, imageData: imageData, thumbnailData: thumbnailData, date: row.date, notes: row.notes)
            photo.id = row.id
            photo.syncStatus = .synced
            context.insert(photo)
        }

        let remoteAnalyses: [AIAnalysisRow] = try await AuthService.client.from("ai_analyses").select().execute().value
        for row in remoteAnalyses {
            guard let plant = plantsByID[row.plantId] else { continue }
            let analysis = AIAnalysis(
                plant: plant, type: row.type, date: row.date, summary: row.summary,
                structuredDataJSON: row.structuredData, provider: row.provider, model: row.model,
                confidence: row.confidence.flatMap(AIConfidence.init(rawValue:))
            )
            analysis.id = row.id
            analysis.syncStatus = .synced
            context.insert(analysis)
        }

        try context.save()
    }

    private static func dateFromMinutesSinceMidnight(_ minutes: Int) -> Date {
        let startOfDay = Calendar.current.startOfDay(for: .now)
        return Calendar.current.date(byAdding: .minute, value: minutes, to: startOfDay) ?? startOfDay
    }

    private struct GardenRow: Decodable {
        var id: UUID
        var name: String
        var address: String?
        var notes: String
        var dateCreated: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, name, address, notes
            case dateCreated = "date_created"
            case updatedAt = "updated_at"
        }
    }

    private struct GardenZoneRow: Decodable {
        var id: UUID
        var gardenId: UUID
        var name: String
        var notes: String
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case name, notes
            case updatedAt = "updated_at"
        }
    }

    private struct PlantRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var zoneId: UUID?
        var customName: String
        var commonName: String?
        var scientificName: String?
        var type: PlantType
        var isIndoor: Bool
        var notes: String
        var dateAdded: Date
        var healthStatus: HealthStatus
        var isArchived: Bool
        var photoStoragePath: String?
        var thumbnailStoragePath: String?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case zoneId = "zone_id"
            case customName = "custom_name"
            case commonName = "common_name"
            case scientificName = "scientific_name"
            case type
            case isIndoor = "is_indoor"
            case notes
            case dateAdded = "date_added"
            case healthStatus = "health_status"
            case isArchived = "is_archived"
            case photoStoragePath = "photo_storage_path"
            case thumbnailStoragePath = "thumbnail_storage_path"
            case updatedAt = "updated_at"
        }
    }

    private struct CareScheduleRow: Decodable {
        var id: UUID
        var plantId: UUID
        var type: CareEventType
        var isActive: Bool
        var frequencyDays: Int
        var lastCompletedDate: Date?
        var nextDueDate: Date?
        var notes: String
        var preferredTimeMinutes: Int?
        var reminderEnabled: Bool
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case type
            case isActive = "is_active"
            case frequencyDays = "frequency_days"
            case lastCompletedDate = "last_completed_date"
            case nextDueDate = "next_due_date"
            case notes
            case preferredTimeMinutes = "preferred_time_minutes"
            case reminderEnabled = "reminder_enabled"
            case updatedAt = "updated_at"
        }
    }

    private struct CareEventRow: Decodable {
        var id: UUID
        var plantId: UUID
        var type: CareEventType
        var date: Date
        var notes: String
        var quantity: Double?
        var unit: String?
        var product: String?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case type, date, notes, quantity, unit, product
        }
    }

    private struct PlantPhotoRow: Decodable {
        var id: UUID
        var plantId: UUID
        var storagePath: String
        var thumbnailStoragePath: String
        var date: Date
        var notes: String

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case storagePath = "storage_path"
            case thumbnailStoragePath = "thumbnail_storage_path"
            case date, notes
        }
    }

    private struct AIAnalysisRow: Decodable {
        var id: UUID
        var plantId: UUID
        var type: AIAnalysisType
        var date: Date
        var summary: String
        var structuredData: String?
        var provider: String
        var model: String?
        var confidence: String?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case type, date, summary
            case structuredData = "structured_data"
            case provider, model, confidence
        }
    }

    // MARK: - Gardens

    private struct GardenDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var name: String
        var address: String?
        var notes: String
        var dateCreated: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name, address, notes
            case dateCreated = "date_created"
            case updatedAt = "updated_at"
        }
    }

    private func pushGardens(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<Garden>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map {
            GardenDTO(
                id: $0.id, workspaceId: workspaceID, name: $0.name, address: $0.address,
                notes: $0.notes, dateCreated: $0.dateCreated, updatedAt: $0.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("gardens").upsert(dtos).execute()
        for garden in pending { garden.syncStatus = .synced }
    }

    // MARK: - Zones

    private struct GardenZoneDTO: Encodable {
        var id: UUID
        var gardenId: UUID
        var name: String
        var notes: String
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case name, notes
            case updatedAt = "updated_at"
        }
    }

    private func pushZones(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<GardenZone>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { zone -> GardenZoneDTO? in
            guard let gardenID = zone.garden?.id else { return nil }
            return GardenZoneDTO(id: zone.id, gardenId: gardenID, name: zone.name, notes: zone.notes, updatedAt: zone.updatedAt ?? .now)
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("garden_zones").upsert(dtos).execute()
        for zone in pending where zone.garden != nil { zone.syncStatus = .synced }
    }

    // MARK: - Plants

    private struct PlantDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var zoneId: UUID?
        var customName: String
        var commonName: String?
        var scientificName: String?
        var type: PlantType
        var isIndoor: Bool
        var notes: String
        var dateAdded: Date
        var healthStatus: HealthStatus
        var isArchived: Bool
        var photoStoragePath: String?
        var thumbnailStoragePath: String?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case zoneId = "zone_id"
            case customName = "custom_name"
            case commonName = "common_name"
            case scientificName = "scientific_name"
            case type
            case isIndoor = "is_indoor"
            case notes
            case dateAdded = "date_added"
            case healthStatus = "health_status"
            case isArchived = "is_archived"
            case photoStoragePath = "photo_storage_path"
            case thumbnailStoragePath = "thumbnail_storage_path"
            case updatedAt = "updated_at"
        }
    }

    private func pushPlants(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<Plant>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        var dtos: [PlantDTO] = []
        for plant in pending {
            var photoPath: String?
            var thumbnailPath: String?
            if let photoData = plant.photoData {
                let path = "\(workspaceID)/\(plant.id)/main.jpg"
                try await uploadPhoto(photoData, path: path)
                photoPath = path
            }
            if let thumbnailData = plant.thumbnailData {
                let path = "\(workspaceID)/\(plant.id)/main_thumb.jpg"
                try await uploadPhoto(thumbnailData, path: path)
                thumbnailPath = path
            }
            dtos.append(PlantDTO(
                id: plant.id, workspaceId: workspaceID, gardenId: plant.garden?.id, zoneId: plant.zone?.id,
                customName: plant.customName, commonName: plant.commonName, scientificName: plant.scientificName,
                type: plant.type, isIndoor: plant.isIndoor, notes: plant.notes, dateAdded: plant.dateAdded,
                healthStatus: plant.healthStatus, isArchived: plant.isArchived,
                photoStoragePath: photoPath, thumbnailStoragePath: thumbnailPath,
                updatedAt: plant.updatedAt ?? .now
            ))
        }
        try await AuthService.client.from("plants").upsert(dtos).execute()
        for plant in pending { plant.syncStatus = .synced }
    }

    // MARK: - Care schedules

    private struct CareScheduleDTO: Encodable {
        var id: UUID
        var plantId: UUID
        var type: CareEventType
        var isActive: Bool
        var frequencyDays: Int
        var lastCompletedDate: Date?
        var nextDueDate: Date?
        var notes: String
        var preferredTimeMinutes: Int?
        var reminderEnabled: Bool
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case type
            case isActive = "is_active"
            case frequencyDays = "frequency_days"
            case lastCompletedDate = "last_completed_date"
            case nextDueDate = "next_due_date"
            case notes
            case preferredTimeMinutes = "preferred_time_minutes"
            case reminderEnabled = "reminder_enabled"
            case updatedAt = "updated_at"
        }
    }

    private func pushSchedules(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<CareSchedule>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { schedule -> CareScheduleDTO? in
            guard let plantID = schedule.plant?.id else { return nil }
            return CareScheduleDTO(
                id: schedule.id, plantId: plantID, type: schedule.type, isActive: schedule.isActive,
                frequencyDays: schedule.frequencyDays, lastCompletedDate: schedule.lastCompletedDate,
                nextDueDate: schedule.nextDueDate, notes: schedule.notes,
                preferredTimeMinutes: schedule.preferredTime.map(Self.minutesSinceMidnight),
                reminderEnabled: schedule.reminderEnabled, updatedAt: schedule.updatedAt ?? .now
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("care_schedules").upsert(dtos).execute()
        for schedule in pending where schedule.plant != nil { schedule.syncStatus = .synced }
    }

    private static func minutesSinceMidnight(_ date: Date) -> Int {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (components.hour ?? 0) * 60 + (components.minute ?? 0)
    }

    // MARK: - Care events

    private struct CareEventDTO: Encodable {
        var id: UUID
        var plantId: UUID
        var type: CareEventType
        var date: Date
        var notes: String
        var quantity: Double?
        var unit: String?
        var product: String?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case type, date, notes, quantity, unit, product
        }
    }

    private func pushEvents(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<CareEvent>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { event -> CareEventDTO? in
            guard let plantID = event.plant?.id else { return nil }
            return CareEventDTO(
                id: event.id, plantId: plantID, type: event.type, date: event.date,
                notes: event.notes, quantity: event.quantity, unit: event.unit, product: event.product
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("care_events").upsert(dtos).execute()
        for event in pending where event.plant != nil { event.syncStatus = .synced }
    }

    // MARK: - Plant photos (Évolution gallery)

    private struct PlantPhotoDTO: Encodable {
        var id: UUID
        var plantId: UUID
        var storagePath: String
        var thumbnailStoragePath: String
        var date: Date
        var notes: String

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case storagePath = "storage_path"
            case thumbnailStoragePath = "thumbnail_storage_path"
            case date, notes
        }
    }

    private func pushPlantPhotos(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<PlantPhoto>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        var dtos: [PlantPhotoDTO] = []
        for photo in pending {
            guard let plantID = photo.plant?.id else { continue }
            let path = "\(workspaceID)/\(plantID)/\(photo.id).jpg"
            let thumbnailPath = "\(workspaceID)/\(plantID)/\(photo.id)_thumb.jpg"
            try await uploadPhoto(photo.imageData, path: path)
            try await uploadPhoto(photo.thumbnailData, path: thumbnailPath)
            dtos.append(PlantPhotoDTO(
                id: photo.id, plantId: plantID, storagePath: path,
                thumbnailStoragePath: thumbnailPath, date: photo.date, notes: photo.notes
            ))
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("plant_photos").upsert(dtos).execute()
        for photo in pending where photo.plant != nil { photo.syncStatus = .synced }
    }

    // MARK: - AI analysis history

    private struct AIAnalysisDTO: Encodable {
        var id: UUID
        var plantId: UUID
        var type: AIAnalysisType
        var date: Date
        var summary: String
        var structuredData: String?
        var provider: String
        var model: String?
        var confidence: AIConfidence?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case type, date, summary
            case structuredData = "structured_data"
            case provider, model, confidence
        }
    }

    private func pushAIAnalyses(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<AIAnalysis>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { analysis -> AIAnalysisDTO? in
            guard let plantID = analysis.plant?.id else { return nil }
            return AIAnalysisDTO(
                id: analysis.id, plantId: plantID, type: analysis.type, date: analysis.date,
                summary: analysis.summary, structuredData: analysis.structuredDataJSON,
                provider: analysis.provider, model: analysis.model, confidence: analysis.confidence
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("ai_analyses").upsert(dtos).execute()
        for analysis in pending where analysis.plant != nil { analysis.syncStatus = .synced }
    }

    // MARK: - Pending deletions

    private func pushPendingDeletions(context: ModelContext) async throws {
        let deletions = try context.fetch(FetchDescriptor<PendingDeletion>())
        for deletion in deletions {
            guard let type = DeletionService.EntityType(rawValue: deletion.entityType) else { continue }
            try await AuthService.client.from(type.rawValue).delete().eq("id", value: deletion.id.uuidString).execute()
            context.delete(deletion)
        }
    }
}

enum SyncEngineError: LocalizedError {
    case noWorkspace

    var errorDescription: String? {
        switch self {
        case .noWorkspace: return "Aucun espace de travail trouvé pour ce compte."
        }
    }
}
