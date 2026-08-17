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
            try await pushIrrigationZones(workspaceID: workspaceID, context: context)
            try await pushPlants(workspaceID: workspaceID, context: context)
            try await pushSchedules(context: context)
            try await pushEvents(context: context)
            try await pushPlantMeasurements(workspaceID: workspaceID, context: context)
            try await pushTreeInspections(workspaceID: workspaceID, context: context)
            try await pushGardenCheckups(workspaceID: workspaceID, context: context)
            try await pushGardenCheckupEntries(context: context)
            try await pushPlantPhotos(workspaceID: workspaceID, context: context)
            try await pushAIAnalyses(context: context)
            try await pushSmartTags(workspaceID: workspaceID, context: context)
            try await pushConnectedDevices(workspaceID: workspaceID, context: context)
            try await pushIrrigationEvents(context: context)
            try await pushDashboardPreferences(workspaceID: workspaceID, context: context)
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
        let preferences = (try? context.fetch(FetchDescriptor<DashboardPreferences>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let irrigationZones = (try? context.fetch(FetchDescriptor<IrrigationZone>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let irrigationEvents = (try? context.fetch(FetchDescriptor<IrrigationEvent>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let smartTags = (try? context.fetch(FetchDescriptor<SmartTag>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let connectedDevices = (try? context.fetch(FetchDescriptor<ConnectedDevice>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let measurements = (try? context.fetch(FetchDescriptor<PlantMeasurement>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let inspections = (try? context.fetch(FetchDescriptor<TreeInspection>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let checkups = (try? context.fetch(FetchDescriptor<GardenCheckup>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let checkupEntries = (try? context.fetch(FetchDescriptor<GardenCheckupEntry>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let deletions = (try? context.fetchCount(FetchDescriptor<PendingDeletion>())) ?? 0
        return gardens + zones + plants + schedules + events + photos + analyses + preferences + irrigationZones
            + irrigationEvents + smartTags + connectedDevices + measurements + inspections + checkups + checkupEntries + deletions
    }

    private static let photoBucket = "plant-photos"

    private func uploadPhoto(_ data: Data, path: String) async throws {
        try await AuthService.client.storage
            .from(Self.photoBucket)
            .upload(path, data: data, options: FileOptions(contentType: "image/jpeg", upsert: true))
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
            garden.latitude = row.latitude
            garden.longitude = row.longitude
            garden.locationName = row.locationName
            garden.weatherEnabled = row.weatherEnabled
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

        let remoteConnectedDevices: [ConnectedDeviceRow] = try await AuthService.client.from("connected_devices").select().execute().value
        for row in remoteConnectedDevices {
            let device = ConnectedDevice(
                provider: row.provider, providerDeviceId: row.providerDeviceId, name: row.name, category: row.category,
                capabilities: row.capabilities.compactMap(DeviceCapability.init(rawValue:)), manufacturer: row.manufacturer,
                model: row.model, firmwareVersion: row.firmwareVersion, online: row.online,
                garden: row.gardenId.flatMap { gardensByID[$0] }, zone: row.zoneId.flatMap { zonesByID[$0] }
            )
            device.id = row.id
            device.lastSeenAt = row.lastSeenAt
            device.syncStatus = .synced
            device.updatedAt = row.updatedAt
            context.insert(device)
        }

        let remoteIrrigationZones: [IrrigationZoneRow] = try await AuthService.client.from("irrigation_zones").select().execute().value
        var irrigationZonesByID: [UUID: IrrigationZone] = [:]
        for row in remoteIrrigationZones {
            guard let garden = gardensByID[row.gardenId] else { continue }
            let zone = IrrigationZone(
                name: row.name, type: row.type, flowRate: row.flowRate, flowRateUnit: row.flowRateUnit,
                durationMinutes: row.durationMinutes, active: row.active, notes: row.notes, garden: garden
            )
            zone.id = row.id
            zone.syncStatus = .synced
            zone.updatedAt = row.updatedAt
            context.insert(zone)
            irrigationZonesByID[row.id] = zone
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
            plant.latitude = row.latitude
            plant.longitude = row.longitude
            plant.mapPositionX = row.mapPositionX
            plant.mapPositionY = row.mapPositionY
            plant.positionSource = row.positionSource
            plant.irrigationZone = row.irrigationZoneId.flatMap { irrigationZonesByID[$0] }
            plant.emitterCount = row.emitterCount
            plant.emitterFlowRate = row.emitterFlowRate
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

        let remoteMeasurements: [PlantMeasurementRow] = try await AuthService.client.from("plant_measurements").select().execute().value
        for row in remoteMeasurements {
            guard let plant = plantsByID[row.plantId] else { continue }
            let measurement = PlantMeasurement(
                plant: plant, date: row.date, height: row.height, trunkCircumference: row.trunkCircumference,
                trunkDiameter: row.trunkDiameter, canopyDiameter: row.canopyDiameter,
                estimatedAge: row.estimatedAge, notes: row.notes
            )
            measurement.id = row.id
            measurement.syncStatus = .synced
            context.insert(measurement)
        }

        // Restored before plant_photos: a photo can reference the
        // inspection it was taken during, and that foreign key needs
        // the inspection row to already exist locally.
        let remoteInspections: [TreeInspectionRow] = try await AuthService.client.from("tree_inspections").select().execute().value
        var treeInspectionsByID: [UUID: TreeInspection] = [:]
        for row in remoteInspections {
            guard let plant = plantsByID[row.plantId] else { continue }
            let inspection = TreeInspection(
                plant: plant, date: row.date, generalCondition: row.generalCondition, stability: row.stability,
                deadWood: row.deadWood, cavities: row.cavities, fungi: row.fungi, parasites: row.parasites,
                trunkDefects: row.trunkDefects, canopyNotes: row.canopyNotes, notes: row.notes, result: row.result
            )
            inspection.id = row.id
            inspection.syncStatus = .synced
            inspection.updatedAt = row.updatedAt
            context.insert(inspection)
            treeInspectionsByID[row.id] = inspection
        }

        // Also restored before plant_photos, same FK reason as
        // tree_inspections above.
        let remoteCheckups: [GardenCheckupRow] = try await AuthService.client.from("garden_checkups").select().execute().value
        var checkupsByID: [UUID: GardenCheckup] = [:]
        for row in remoteCheckups {
            guard let garden = gardensByID[row.gardenId] else { continue }
            let checkup = GardenCheckup(garden: garden, filterCategory: row.filterCategory, filterZoneID: row.filterZoneId)
            checkup.id = row.id
            checkup.startedAt = row.startedAt
            checkup.completedAt = row.completedAt
            checkup.syncStatus = .synced
            checkup.updatedAt = row.updatedAt
            context.insert(checkup)
            checkupsByID[row.id] = checkup
        }

        let remoteCheckupEntries: [GardenCheckupEntryRow] = try await AuthService.client.from("garden_checkup_entries").select().execute().value
        var checkupEntriesByID: [UUID: GardenCheckupEntry] = [:]
        for row in remoteCheckupEntries {
            guard let checkup = checkupsByID[row.checkupId], let plant = plantsByID[row.plantId] else { continue }
            let entry = GardenCheckupEntry(checkup: checkup, plant: plant, result: row.result, notes: row.notes)
            entry.id = row.id
            entry.date = row.date
            entry.syncStatus = .synced
            context.insert(entry)
            checkupEntriesByID[row.id] = entry
        }

        let remotePhotos: [PlantPhotoRow] = try await AuthService.client.from("plant_photos").select().execute().value
        for row in remotePhotos {
            guard let plant = plantsByID[row.plantId] else { continue }
            guard let imageData = try? await downloadPhoto(path: row.storagePath),
                  let thumbnailData = try? await downloadPhoto(path: row.thumbnailStoragePath) else { continue }
            let photo = PlantPhoto(plant: plant, imageData: imageData, thumbnailData: thumbnailData, date: row.date, notes: row.notes)
            photo.id = row.id
            photo.treeInspection = row.treeInspectionId.flatMap { treeInspectionsByID[$0] }
            photo.checkupEntry = row.checkupEntryId.flatMap { checkupEntriesByID[$0] }
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

        let remoteSmartTags: [SmartTagRow] = try await AuthService.client.from("smart_tags").select().execute().value
        for row in remoteSmartTags {
            guard let plant = plantsByID[row.plantId] else { continue }
            let tag = SmartTag(plant: plant, type: row.type)
            tag.id = row.id
            // Must carry over the ORIGINAL token, not the fresh random
            // one the initializer just generated — physical QR/NFC tags
            // already have this token printed/written on them.
            tag.publicToken = row.publicToken
            tag.active = row.active
            tag.createdAt = row.createdAt
            tag.lastScannedAt = row.lastScannedAt
            tag.syncStatus = .synced
            tag.updatedAt = row.updatedAt
            context.insert(tag)
        }

        let remoteIrrigationEvents: [IrrigationEventRow] = try await AuthService.client.from("irrigation_events").select().execute().value
        for row in remoteIrrigationEvents {
            guard let zone = irrigationZonesByID[row.zoneId] else { continue }
            let event = IrrigationEvent(
                zone: zone, date: row.date, durationMinutes: row.durationMinutes,
                estimatedLiters: row.estimatedLiters, isAutomatic: row.isAutomatic, notes: row.notes
            )
            event.id = row.id
            event.syncStatus = .synced
            context.insert(event)
        }

        // Only pulled if this device has no local row yet — HomeView's
        // own DashboardService.preferences(in:) fetch-or-create can run
        // before this restore does, and skipping here (rather than
        // risking a second local row) is fine: the unique workspace_id
        // constraint means the next push just reconciles onto the same
        // cloud row regardless of which device "wins".
        let hasLocalPreferences = ((try? context.fetchCount(FetchDescriptor<DashboardPreferences>())) ?? 0) > 0
        if !hasLocalPreferences {
            let remotePreferences: [DashboardPreferencesRow] = try await AuthService.client.from("dashboard_preferences").select().execute().value
            if let row = remotePreferences.first {
                let prefs = DashboardPreferences()
                prefs.id = row.id
                prefs.showToday = row.showToday
                prefs.showAlerts = row.showAlerts
                prefs.showWeather = row.showWeather
                prefs.showOasisAI = row.showOasisAI
                prefs.showWater = row.showWater
                prefs.showRecentActivity = row.showRecentActivity
                prefs.showUpcoming = row.showUpcoming
                prefs.showHealth = row.showHealth
                prefs.showEvolution = row.showEvolution
                prefs.showConnectedHome = row.showConnectedHome
                prefs.syncStatus = .synced
                prefs.updatedAt = row.updatedAt
                context.insert(prefs)
            }
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
        var latitude: Double?
        var longitude: Double?
        var locationName: String?
        var weatherEnabled: Bool
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, name, address, notes
            case dateCreated = "date_created"
            case latitude, longitude
            case locationName = "location_name"
            case weatherEnabled = "weather_enabled"
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

    private struct IrrigationZoneRow: Decodable {
        var id: UUID
        var gardenId: UUID
        var name: String
        var type: IrrigationType
        var flowRate: Double?
        var flowRateUnit: String
        var durationMinutes: Int?
        var active: Bool
        var notes: String
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case name, type
            case flowRate = "flow_rate"
            case flowRateUnit = "flow_rate_unit"
            case durationMinutes = "duration_minutes"
            case active, notes
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
        var latitude: Double?
        var longitude: Double?
        var mapPositionX: Double?
        var mapPositionY: Double?
        var positionSource: String?
        var irrigationZoneId: UUID?
        var emitterCount: Int?
        var emitterFlowRate: Double?
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
            case latitude, longitude
            case mapPositionX = "map_position_x"
            case mapPositionY = "map_position_y"
            case irrigationZoneId = "irrigation_zone_id"
            case emitterCount = "emitter_count"
            case emitterFlowRate = "emitter_flow_rate"
            case positionSource = "position_source"
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

    private struct PlantMeasurementRow: Decodable {
        var id: UUID
        var plantId: UUID
        var date: Date
        var height: Double?
        var trunkCircumference: Double?
        var trunkDiameter: Double?
        var canopyDiameter: Double?
        var estimatedAge: Int?
        var notes: String

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case date, height, notes
            case trunkCircumference = "trunk_circumference"
            case trunkDiameter = "trunk_diameter"
            case canopyDiameter = "canopy_diameter"
            case estimatedAge = "estimated_age"
        }
    }

    private struct TreeInspectionRow: Decodable {
        var id: UUID
        var plantId: UUID
        var date: Date
        var generalCondition: String
        var stability: String
        var deadWood: String
        var cavities: String
        var fungi: String
        var parasites: String
        var trunkDefects: String
        var canopyNotes: String
        var notes: String
        var result: TreeInspectionResult
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case date, notes, result
            case generalCondition = "general_condition"
            case stability
            case deadWood = "dead_wood"
            case cavities, fungi, parasites
            case trunkDefects = "trunk_defects"
            case canopyNotes = "canopy_notes"
            case updatedAt = "updated_at"
        }
    }

    private struct GardenCheckupRow: Decodable {
        var id: UUID
        var gardenId: UUID
        var startedAt: Date
        var completedAt: Date?
        var filterCategory: GardenCheckupFilter
        var filterZoneId: UUID?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case startedAt = "started_at"
            case completedAt = "completed_at"
            case filterCategory = "filter_category"
            case filterZoneId = "filter_zone_id"
            case updatedAt = "updated_at"
        }
    }

    private struct GardenCheckupEntryRow: Decodable {
        var id: UUID
        var checkupId: UUID
        var plantId: UUID
        var date: Date
        var result: TreeInspectionResult
        var notes: String

        enum CodingKeys: String, CodingKey {
            case id
            case checkupId = "checkup_id"
            case plantId = "plant_id"
            case date, result, notes
        }
    }

    private struct PlantPhotoRow: Decodable {
        var id: UUID
        var plantId: UUID
        var storagePath: String
        var thumbnailStoragePath: String
        var date: Date
        var notes: String
        var treeInspectionId: UUID?
        var checkupEntryId: UUID?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case storagePath = "storage_path"
            case thumbnailStoragePath = "thumbnail_storage_path"
            case date, notes
            case treeInspectionId = "tree_inspection_id"
            case checkupEntryId = "checkup_entry_id"
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

    private struct SmartTagRow: Decodable {
        var id: UUID
        var plantId: UUID
        var type: SmartTagType
        var publicToken: String
        var active: Bool
        var createdAt: Date
        var lastScannedAt: Date?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case type
            case publicToken = "public_token"
            case active
            case createdAt = "created_at"
            case lastScannedAt = "last_scanned_at"
            case updatedAt = "updated_at"
        }
    }

    private struct ConnectedDeviceRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var zoneId: UUID?
        var provider: DeviceProvider
        var providerDeviceId: String
        var name: String
        var category: String
        var manufacturer: String?
        var model: String?
        var firmwareVersion: String?
        var capabilities: [String]
        var online: Bool
        var lastSeenAt: Date?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case zoneId = "zone_id"
            case provider
            case providerDeviceId = "provider_device_id"
            case name, category, manufacturer, model
            case firmwareVersion = "firmware_version"
            case capabilities, online
            case lastSeenAt = "last_seen_at"
            case updatedAt = "updated_at"
        }
    }

    private struct IrrigationEventRow: Decodable {
        var id: UUID
        var zoneId: UUID
        var date: Date
        var durationMinutes: Int
        var estimatedLiters: Double
        var isAutomatic: Bool
        var notes: String

        enum CodingKeys: String, CodingKey {
            case id
            case zoneId = "zone_id"
            case date
            case durationMinutes = "duration_minutes"
            case estimatedLiters = "estimated_liters"
            case isAutomatic = "is_automatic"
            case notes
        }
    }

    private struct DashboardPreferencesRow: Decodable {
        var id: UUID
        var showToday: Bool
        var showAlerts: Bool
        var showWeather: Bool
        var showOasisAI: Bool
        var showWater: Bool
        var showRecentActivity: Bool
        var showUpcoming: Bool
        var showHealth: Bool
        var showEvolution: Bool
        var showConnectedHome: Bool
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case showToday = "show_today"
            case showAlerts = "show_alerts"
            case showWeather = "show_weather"
            case showOasisAI = "show_oasis_ai"
            case showWater = "show_water"
            case showRecentActivity = "show_recent_activity"
            case showUpcoming = "show_upcoming"
            case showHealth = "show_health"
            case showEvolution = "show_evolution"
            case showConnectedHome = "show_connected_home"
            case updatedAt = "updated_at"
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
        var latitude: Double?
        var longitude: Double?
        var locationName: String?
        var weatherEnabled: Bool
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name, address, notes
            case dateCreated = "date_created"
            case latitude, longitude
            case locationName = "location_name"
            case weatherEnabled = "weather_enabled"
            case updatedAt = "updated_at"
        }
    }

    private func pushGardens(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<Garden>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map {
            GardenDTO(
                id: $0.id, workspaceId: workspaceID, name: $0.name, address: $0.address,
                notes: $0.notes, dateCreated: $0.dateCreated, latitude: $0.latitude, longitude: $0.longitude,
                locationName: $0.locationName, weatherEnabled: $0.weatherEnabled, updatedAt: $0.updatedAt ?? .now
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

    // MARK: - Irrigation zones
    // Pushed before plants: a plant can reference an irrigation zone by
    // id, and that foreign key needs the zone row to already exist.

    private struct IrrigationZoneDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID
        var name: String
        var type: IrrigationType
        var flowRate: Double?
        var flowRateUnit: String
        var durationMinutes: Int?
        var active: Bool
        var notes: String
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case name, type
            case flowRate = "flow_rate"
            case flowRateUnit = "flow_rate_unit"
            case durationMinutes = "duration_minutes"
            case active, notes
            case updatedAt = "updated_at"
        }
    }

    private func pushIrrigationZones(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<IrrigationZone>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { zone -> IrrigationZoneDTO? in
            guard let gardenID = zone.garden?.id else { return nil }
            return IrrigationZoneDTO(
                id: zone.id, workspaceId: workspaceID, gardenId: gardenID, name: zone.name, type: zone.type,
                flowRate: zone.flowRate, flowRateUnit: zone.flowRateUnit, durationMinutes: zone.durationMinutes,
                active: zone.active, notes: zone.notes, updatedAt: zone.updatedAt ?? .now
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("irrigation_zones").upsert(dtos).execute()
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
        var latitude: Double?
        var longitude: Double?
        var mapPositionX: Double?
        var mapPositionY: Double?
        var positionSource: String?
        var irrigationZoneId: UUID?
        var emitterCount: Int?
        var emitterFlowRate: Double?
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
            case latitude, longitude
            case mapPositionX = "map_position_x"
            case mapPositionY = "map_position_y"
            case positionSource = "position_source"
            case irrigationZoneId = "irrigation_zone_id"
            case emitterCount = "emitter_count"
            case emitterFlowRate = "emitter_flow_rate"
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
                latitude: plant.latitude, longitude: plant.longitude,
                mapPositionX: plant.mapPositionX, mapPositionY: plant.mapPositionY,
                positionSource: plant.positionSource,
                irrigationZoneId: plant.irrigationZone?.id, emitterCount: plant.emitterCount,
                emitterFlowRate: plant.emitterFlowRate,
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

    // MARK: - Plant measurements

    private struct PlantMeasurementDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var plantId: UUID
        var date: Date
        var height: Double?
        var trunkCircumference: Double?
        var trunkDiameter: Double?
        var canopyDiameter: Double?
        var estimatedAge: Int?
        var notes: String

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case plantId = "plant_id"
            case date, height, notes
            case trunkCircumference = "trunk_circumference"
            case trunkDiameter = "trunk_diameter"
            case canopyDiameter = "canopy_diameter"
            case estimatedAge = "estimated_age"
        }
    }

    private func pushPlantMeasurements(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<PlantMeasurement>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { measurement -> PlantMeasurementDTO? in
            guard let plantID = measurement.plant?.id else { return nil }
            return PlantMeasurementDTO(
                id: measurement.id, workspaceId: workspaceID, plantId: plantID, date: measurement.date,
                height: measurement.height, trunkCircumference: measurement.trunkCircumference,
                trunkDiameter: measurement.trunkDiameter, canopyDiameter: measurement.canopyDiameter,
                estimatedAge: measurement.estimatedAge, notes: measurement.notes
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("plant_measurements").upsert(dtos).execute()
        for measurement in pending where measurement.plant != nil { measurement.syncStatus = .synced }
    }

    // MARK: - Tree inspections
    // Pushed before plant photos: a photo can reference the inspection
    // it was taken during, and that foreign key needs the inspection
    // row to already exist.

    private struct TreeInspectionDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var plantId: UUID
        var date: Date
        var generalCondition: String
        var stability: String
        var deadWood: String
        var cavities: String
        var fungi: String
        var parasites: String
        var trunkDefects: String
        var canopyNotes: String
        var notes: String
        var result: TreeInspectionResult
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case plantId = "plant_id"
            case date, notes, result
            case generalCondition = "general_condition"
            case stability
            case deadWood = "dead_wood"
            case cavities, fungi, parasites
            case trunkDefects = "trunk_defects"
            case canopyNotes = "canopy_notes"
            case updatedAt = "updated_at"
        }
    }

    private func pushTreeInspections(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<TreeInspection>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { inspection -> TreeInspectionDTO? in
            guard let plantID = inspection.plant?.id else { return nil }
            return TreeInspectionDTO(
                id: inspection.id, workspaceId: workspaceID, plantId: plantID, date: inspection.date,
                generalCondition: inspection.generalCondition, stability: inspection.stability,
                deadWood: inspection.deadWood, cavities: inspection.cavities, fungi: inspection.fungi,
                parasites: inspection.parasites, trunkDefects: inspection.trunkDefects,
                canopyNotes: inspection.canopyNotes, notes: inspection.notes, result: inspection.result,
                updatedAt: inspection.updatedAt ?? .now
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("tree_inspections").upsert(dtos).execute()
        for inspection in pending where inspection.plant != nil { inspection.syncStatus = .synced }
    }

    // MARK: - Garden checkups
    // Both pushed before plant photos: a photo can reference the
    // checkup entry it was taken during, and that foreign key needs
    // the entry row (which itself needs its checkup row) to already
    // exist.

    private struct GardenCheckupDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID
        var startedAt: Date
        var completedAt: Date?
        var filterCategory: GardenCheckupFilter
        var filterZoneId: UUID?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case startedAt = "started_at"
            case completedAt = "completed_at"
            case filterCategory = "filter_category"
            case filterZoneId = "filter_zone_id"
            case updatedAt = "updated_at"
        }
    }

    private func pushGardenCheckups(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<GardenCheckup>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { checkup -> GardenCheckupDTO? in
            guard let gardenID = checkup.garden?.id else { return nil }
            return GardenCheckupDTO(
                id: checkup.id, workspaceId: workspaceID, gardenId: gardenID, startedAt: checkup.startedAt,
                completedAt: checkup.completedAt, filterCategory: checkup.filterCategory,
                filterZoneId: checkup.filterZoneID, updatedAt: checkup.updatedAt ?? .now
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("garden_checkups").upsert(dtos).execute()
        for checkup in pending where checkup.garden != nil { checkup.syncStatus = .synced }
    }

    private struct GardenCheckupEntryDTO: Encodable {
        var id: UUID
        var checkupId: UUID
        var plantId: UUID
        var date: Date
        var result: TreeInspectionResult
        var notes: String

        enum CodingKeys: String, CodingKey {
            case id
            case checkupId = "checkup_id"
            case plantId = "plant_id"
            case date, result, notes
        }
    }

    private func pushGardenCheckupEntries(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<GardenCheckupEntry>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { entry -> GardenCheckupEntryDTO? in
            guard let checkupID = entry.checkup?.id, let plantID = entry.plant?.id else { return nil }
            return GardenCheckupEntryDTO(
                id: entry.id, checkupId: checkupID, plantId: plantID, date: entry.date,
                result: entry.result, notes: entry.notes
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("garden_checkup_entries").upsert(dtos).execute()
        for entry in pending where entry.checkup != nil && entry.plant != nil { entry.syncStatus = .synced }
    }

    // MARK: - Plant photos (Évolution gallery)

    private struct PlantPhotoDTO: Encodable {
        var id: UUID
        var plantId: UUID
        var storagePath: String
        var thumbnailStoragePath: String
        var date: Date
        var notes: String
        var treeInspectionId: UUID?
        var checkupEntryId: UUID?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case storagePath = "storage_path"
            case thumbnailStoragePath = "thumbnail_storage_path"
            case date, notes
            case treeInspectionId = "tree_inspection_id"
            case checkupEntryId = "checkup_entry_id"
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
                thumbnailStoragePath: thumbnailPath, date: photo.date, notes: photo.notes,
                treeInspectionId: photo.treeInspection?.id, checkupEntryId: photo.checkupEntry?.id
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

    // MARK: - Smart tags

    private struct SmartTagDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var plantId: UUID
        var type: SmartTagType
        var publicToken: String
        var active: Bool
        var createdAt: Date
        var lastScannedAt: Date?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case plantId = "plant_id"
            case type
            case publicToken = "public_token"
            case active
            case createdAt = "created_at"
            case lastScannedAt = "last_scanned_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushSmartTags(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<SmartTag>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { tag -> SmartTagDTO? in
            guard let plantID = tag.plant?.id else { return nil }
            return SmartTagDTO(
                id: tag.id, workspaceId: workspaceID, plantId: plantID, type: tag.type,
                publicToken: tag.publicToken, active: tag.active, createdAt: tag.createdAt,
                lastScannedAt: tag.lastScannedAt, updatedAt: tag.updatedAt ?? .now
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("smart_tags").upsert(dtos).execute()
        for tag in pending where tag.plant != nil { tag.syncStatus = .synced }
    }

    // MARK: - Connected devices

    private struct ConnectedDeviceDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var zoneId: UUID?
        var provider: DeviceProvider
        var providerDeviceId: String
        var name: String
        var category: String
        var manufacturer: String?
        var model: String?
        var firmwareVersion: String?
        var capabilities: [String]
        var online: Bool
        var lastSeenAt: Date?
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case zoneId = "zone_id"
            case provider
            case providerDeviceId = "provider_device_id"
            case name, category, manufacturer, model
            case firmwareVersion = "firmware_version"
            case capabilities, online
            case lastSeenAt = "last_seen_at"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushConnectedDevices(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<ConnectedDevice>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { device in
            ConnectedDeviceDTO(
                id: device.id, workspaceId: workspaceID, gardenId: device.garden?.id, zoneId: device.zone?.id,
                provider: device.provider, providerDeviceId: device.providerDeviceId, name: device.name,
                category: device.category, manufacturer: device.manufacturer, model: device.model,
                firmwareVersion: device.firmwareVersion, capabilities: device.capabilitiesRaw, online: device.online,
                lastSeenAt: device.lastSeenAt, createdAt: device.createdAt, updatedAt: device.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("connected_devices").upsert(dtos).execute()
        for device in pending { device.syncStatus = .synced }
    }

    // MARK: - Irrigation events

    private struct IrrigationEventDTO: Encodable {
        var id: UUID
        var zoneId: UUID
        var date: Date
        var durationMinutes: Int
        var estimatedLiters: Double
        var isAutomatic: Bool
        var notes: String

        enum CodingKeys: String, CodingKey {
            case id
            case zoneId = "zone_id"
            case date
            case durationMinutes = "duration_minutes"
            case estimatedLiters = "estimated_liters"
            case isAutomatic = "is_automatic"
            case notes
        }
    }

    private func pushIrrigationEvents(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<IrrigationEvent>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { event -> IrrigationEventDTO? in
            guard let zoneID = event.zone?.id else { return nil }
            return IrrigationEventDTO(
                id: event.id, zoneId: zoneID, date: event.date, durationMinutes: event.durationMinutes,
                estimatedLiters: event.estimatedLiters, isAutomatic: event.isAutomatic, notes: event.notes
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("irrigation_events").upsert(dtos).execute()
        for event in pending where event.zone != nil { event.syncStatus = .synced }
    }

    // MARK: - Dashboard preferences

    private struct DashboardPreferencesDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var showToday: Bool
        var showAlerts: Bool
        var showWeather: Bool
        var showOasisAI: Bool
        var showWater: Bool
        var showRecentActivity: Bool
        var showUpcoming: Bool
        var showHealth: Bool
        var showEvolution: Bool
        var showConnectedHome: Bool
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case showToday = "show_today"
            case showAlerts = "show_alerts"
            case showWeather = "show_weather"
            case showOasisAI = "show_oasis_ai"
            case showWater = "show_water"
            case showRecentActivity = "show_recent_activity"
            case showUpcoming = "show_upcoming"
            case showHealth = "show_health"
            case showEvolution = "show_evolution"
            case showConnectedHome = "show_connected_home"
            case updatedAt = "updated_at"
        }
    }

    /// Upserts on workspace_id (unique in the schema), not id — so no
    /// matter which device pushes first, later pushes for the same
    /// workspace update that one row instead of creating a duplicate.
    private func pushDashboardPreferences(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<DashboardPreferences>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { prefs in
            DashboardPreferencesDTO(
                id: prefs.id, workspaceId: workspaceID, showToday: prefs.showToday, showAlerts: prefs.showAlerts,
                showWeather: prefs.showWeather, showOasisAI: prefs.showOasisAI, showWater: prefs.showWater,
                showRecentActivity: prefs.showRecentActivity, showUpcoming: prefs.showUpcoming,
                showHealth: prefs.showHealth, showEvolution: prefs.showEvolution,
                showConnectedHome: prefs.showConnectedHome, updatedAt: prefs.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("dashboard_preferences").upsert(dtos, onConflict: "workspace_id").execute()
        for prefs in pending { prefs.syncStatus = .synced }
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
