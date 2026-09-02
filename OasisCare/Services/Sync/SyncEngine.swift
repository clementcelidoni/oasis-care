import Foundation
import SwiftData
import Supabase

/// Pushes locally-pending changes to Supabase. Local-first: every write
/// already landed in SwiftData before this ever runs, so a slow or absent
/// network never blocks a user action — this only catches the cloud up in
/// the background, afterward.
///
/// Essentiellement push : la synchronisation descendante générale
/// (fusionner les modifications d'un autre appareil sur les 54 modèles)
/// n'existe toujours pas. Depuis la Phase 11, `pullDigitalTwin` fait
/// exception et redescend les entités du Digital Twin, parce
/// qu'Oasis Care Pro Web écrit dans ces mêmes tables et qu'un plan
/// modifié sur ordinateur doit se voir sur le téléphone. The
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
            try await pushConnectedDevices(workspaceID: workspaceID, context: context)
            // This whole BioLab chain must run before pushSensors: Phase 7F
            // gave Sensor an optional bioreactor_id foreign key, and
            // Greenhouse/Pond below (which Sensor must in turn precede —
            // they hold their own sensor_id foreign keys) already fixes
            // Sensor's position relative to them, so the chain that Sensor
            // now depends on has to move up here instead of staying next
            // to the rest of the BioLab pushes further down.
            // Recipes/versions before batches: a batch can reference a
            // brand-new version created in the same session, and
            // medium_recipe_version_id is a real foreign key — pushing
            // it first means that key always already exists remotely
            // by the time a batch referencing it is upserted.
            // Enhancement — Smart Media foundation. No dependency on
            // anything upstream; LabCompound pushes first since
            // StockSolution/InventoryLot reference it.
            try await pushLabCompounds(workspaceID: workspaceID, context: context)
            try await pushStockSolutions(workspaceID: workspaceID, context: context)
            try await pushInventoryLots(workspaceID: workspaceID, context: context)
            try await pushBioLabAuditEntries(workspaceID: workspaceID, context: context)
            try await pushMediumRecipes(workspaceID: workspaceID, context: context)
            try await pushMediumRecipeVersions(workspaceID: workspaceID, context: context)
            // Programs/versions moved up here (Phase 7K) so
            // ExperimentGroup, which needs a program version to already
            // exist remotely, can in turn push before CultureBatches —
            // CultureBatch.experimentGroupId is a real foreign key.
            // Bioreactors themselves still push after CultureBatches
            // (currentBatchId), so only Programs/Versions move, not
            // Bioreactors.
            try await pushBioreactorPrograms(workspaceID: workspaceID, context: context)
            try await pushBioreactorProgramVersions(workspaceID: workspaceID, context: context)
            try await pushBioLabExperiments(workspaceID: workspaceID, context: context)
            try await pushExperimentGroups(workspaceID: workspaceID, context: context)
            try await pushCultureBatches(workspaceID: workspaceID, context: context)
            try await pushMediumBatches(workspaceID: workspaceID, context: context)
            try await pushAcclimatizationBatches(workspaceID: workspaceID, context: context)
            try await pushLabInventoryItems(workspaceID: workspaceID, context: context)
            try await pushBioreactors(workspaceID: workspaceID, context: context)
            // Moved here (spec's "QR / NFC" section) from its original
            // position right after pushAIAnalyses: SmartTag can now
            // reference Bioreactor/CultureBatch/MediumRecipeVersion/
            // AcclimatizationBatch too, all of which must already exist
            // remotely — Plant (its one original target) already pushed
            // long before this point either way.
            try await pushSmartTags(workspaceID: workspaceID, context: context)
            try await pushBioreactorDeviceBindings(workspaceID: workspaceID, context: context)
            try await pushBioreactorInspections(workspaceID: workspaceID, context: context)
            try await pushBioLabInspectionPhotos(workspaceID: workspaceID, context: context)
            try await pushSensors(workspaceID: workspaceID, context: context)
            try await pushSensorReadings(context: context)
            try await pushDeviceCommandLogs(workspaceID: workspaceID, context: context)
            try await pushAutomationRules(workspaceID: workspaceID, context: context)
            try await pushAutomationConditions(context: context)
            try await pushAutomationActions(context: context)
            try await pushAutomationExecutions(context: context)
            try await pushGreenhouses(workspaceID: workspaceID, context: context)
            try await pushPonds(workspaceID: workspaceID, context: context)
            try await pushScenes(workspaceID: workspaceID, context: context)
            try await pushSceneActions(context: context)
            try await pushIrrigationEvents(context: context)
            try await pushDashboardPreferences(workspaceID: workspaceID, context: context)
            try await pushSmartModeSettings(workspaceID: workspaceID, context: context)
            try await pushGardenBoundaries(workspaceID: workspaceID, context: context)
            try await pushGardenMapObjects(workspaceID: workspaceID, context: context)
            try await pushGardenAreas(workspaceID: workspaceID, context: context)
            try await pushIrrigationPipes(workspaceID: workspaceID, context: context)
            try await pushBioreactorMaintenanceEvents(workspaceID: workspaceID, context: context)
            try await pushBioreactorCycleExecutions(workspaceID: workspaceID, context: context)
            try await pushBioLabAlerts(workspaceID: workspaceID, context: context)
            try await pushPendingDeletions(context: context)
            // APRÈS les pushes, jamais avant : on envoie d'abord ce qui a
            // été fait ici, puis on récupère ce qui a été fait ailleurs.
            // L'inverse écraserait le travail local par une version
            // serveur qui l'ignore encore.
            try await pullDigitalTwin(context: context)
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
        let sensors = (try? context.fetch(FetchDescriptor<Sensor>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let sensorReadings = (try? context.fetch(FetchDescriptor<SensorReading>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let commandLogs = (try? context.fetch(FetchDescriptor<DeviceCommandLog>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let automationRules = (try? context.fetch(FetchDescriptor<AutomationRule>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let automationExecutions = (try? context.fetch(FetchDescriptor<AutomationExecution>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let greenhouses = (try? context.fetch(FetchDescriptor<Greenhouse>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let ponds = (try? context.fetch(FetchDescriptor<Pond>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let measurements = (try? context.fetch(FetchDescriptor<PlantMeasurement>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let inspections = (try? context.fetch(FetchDescriptor<TreeInspection>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let checkups = (try? context.fetch(FetchDescriptor<GardenCheckup>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let checkupEntries = (try? context.fetch(FetchDescriptor<GardenCheckupEntry>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let smartModeSettings = (try? context.fetch(FetchDescriptor<SmartModeSettings>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let scenes = (try? context.fetch(FetchDescriptor<OasisScene>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let deletions = (try? context.fetchCount(FetchDescriptor<PendingDeletion>())) ?? 0
        // These four (Phase 6B-6D) were never added here when they were
        // built — found while adding CultureBatch below and fixed in
        // passing, since it's the same aggregate this new type belongs
        // in. Cosmetic-only gap (an undercounted "pending" display in
        // Réglages, not a sync failure — push/restore for all four were
        // already correct), unlike the SwiftData schema-registration
        // incident from the same phase.
        let boundaries = (try? context.fetch(FetchDescriptor<GardenBoundary>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let mapObjects = (try? context.fetch(FetchDescriptor<GardenMapObject>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let areas = (try? context.fetch(FetchDescriptor<GardenArea>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let pipes = (try? context.fetch(FetchDescriptor<IrrigationPipe>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let cultureBatches = (try? context.fetch(FetchDescriptor<CultureBatch>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let mediumRecipes = (try? context.fetch(FetchDescriptor<MediumRecipe>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let mediumVersions = (try? context.fetch(FetchDescriptor<MediumRecipeVersion>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let mediumBatches = (try? context.fetch(FetchDescriptor<MediumBatch>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let bioreactors = (try? context.fetch(FetchDescriptor<Bioreactor>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let maintenanceEvents = (try? context.fetch(FetchDescriptor<BioreactorMaintenanceEvent>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let bioreactorPrograms = (try? context.fetch(FetchDescriptor<BioreactorProgram>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let bioreactorProgramVersions = (try? context.fetch(FetchDescriptor<BioreactorProgramVersion>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let cycleExecutions = (try? context.fetch(FetchDescriptor<BioreactorCycleExecution>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let biolabAlerts = (try? context.fetch(FetchDescriptor<BioLabAlert>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let deviceBindings = (try? context.fetch(FetchDescriptor<BioreactorDeviceBinding>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let bioreactorInspections = (try? context.fetch(FetchDescriptor<BioreactorInspection>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let inspectionPhotos = (try? context.fetch(FetchDescriptor<BioLabInspectionPhoto>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let bioLabExperiments = (try? context.fetch(FetchDescriptor<BioLabExperiment>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let experimentGroups = (try? context.fetch(FetchDescriptor<ExperimentGroup>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let acclimatizationBatches = (try? context.fetch(FetchDescriptor<AcclimatizationBatch>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let labInventoryItems = (try? context.fetch(FetchDescriptor<LabInventoryItem>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let labCompounds = (try? context.fetch(FetchDescriptor<LabCompound>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let stockSolutions = (try? context.fetch(FetchDescriptor<StockSolution>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let inventoryLots = (try? context.fetch(FetchDescriptor<InventoryLot>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        let auditEntries = (try? context.fetch(FetchDescriptor<BioLabAuditEntry>()))?.filter { $0.syncStatus != .synced }.count ?? 0
        return gardens + zones + plants + schedules + events + photos + analyses + preferences + irrigationZones
            + irrigationEvents + smartTags + connectedDevices + sensors + sensorReadings + commandLogs
            + automationRules + automationExecutions + greenhouses + ponds + measurements + inspections + checkups
            + checkupEntries + smartModeSettings + scenes + deletions
            + boundaries + mapObjects + areas + pipes + cultureBatches
            + mediumRecipes + mediumVersions + mediumBatches + bioreactors + maintenanceEvents
            + bioreactorPrograms + bioreactorProgramVersions + cycleExecutions + biolabAlerts + deviceBindings
            + bioreactorInspections + inspectionPhotos + bioLabExperiments + experimentGroups
            + acclimatizationBatches + labInventoryItems + labCompounds + stockSolutions + inventoryLots + auditEntries
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

    /// L'espace de travail PERSONNEL du compte.
    ///
    /// Il y en avait un seul jusqu'à la Phase 11 ;
    /// `create_professional_organization` en crée un second, dont le
    /// compte est aussi membre. `limit(1)` sans filtre ni tri rendait
    /// donc l'un ou l'autre selon l'ordre physique des lignes — et cet
    /// identifiant sert à estampiller tout ce que le téléphone envoie.
    ///
    /// Dans un sens, les plantes et les carnets privés basculaient dans
    /// l'espace de l'entreprise et devenaient lisibles par tout salarié.
    /// Dans l'autre, les jardins clients quittaient l'entreprise.
    ///
    /// On demande donc explicitement le personnel, avec un tri qui rend
    /// le résultat reproductible même si un jour il y en avait deux.
    private func fetchWorkspaceID() async throws -> UUID {
        struct WorkspaceRow: Decodable {
            var id: UUID
        }
        let rows: [WorkspaceRow] = try await AuthService.client
            .from("workspaces")
            .select("id")
            .eq("is_personal", value: true)
            .order("created_at", ascending: true)
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
    /// problem this phase doesn't attempt. Voir `pullDigitalTwin`, qui
    /// couvre depuis la Phase 11 le cas d'un appareil déjà rempli, pour
    /// les seules entités que l'application web modifie.
    ///
    /// Les `select` filtrent `deleted_at`. Ce n'était pas le cas au
    /// départ, et le commentaire d'origine expliquait que rien ne
    /// posait jamais cette colonne — c'était vrai tant qu'iOS était
    /// seul, puisqu'il supprime en dur. Oasis Care Pro Web supprime en
    /// douceur, donc sans ce filtre un appareil neuf ressusciterait tout
    /// ce qui a été supprimé depuis l'ordinateur.
    private func restoreFromCloudIfNeeded(context: ModelContext) async throws {
        let hasLocalGardens = ((try? context.fetchCount(FetchDescriptor<Garden>())) ?? 0) > 0
        let hasLocalPlants = ((try? context.fetchCount(FetchDescriptor<Plant>())) ?? 0) > 0
        guard !hasLocalGardens, !hasLocalPlants else { return }

        let remoteGardens: [GardenRow] = try await AuthService.client.from("gardens").select().is("deleted_at", value: nil).execute().value
        guard !remoteGardens.isEmpty else { return }

        var gardensByID: [UUID: Garden] = [:]
        for row in remoteGardens {
            let garden = Garden(name: row.name, address: row.address, notes: row.notes, dateCreated: row.dateCreated)
            garden.id = row.id
            garden.latitude = row.latitude
            garden.longitude = row.longitude
            garden.locationName = row.locationName
            garden.weatherEnabled = row.weatherEnabled
            garden.preferredMapMode = row.preferredMapMode ?? .oasisPlan
            garden.syncStatus = .synced
            garden.updatedAt = row.updatedAt
            // Sur un appareil neuf aussi : sans cette ligne, le premier
            // envoi renverrait tous les jardins de l'entreprise dans
            // l'espace personnel du salarié qui vient d'installer l'app.
            garden.remoteWorkspaceID = row.workspaceId
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
        var connectedDevicesByID: [UUID: ConnectedDevice] = [:]
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
            connectedDevicesByID[row.id] = device
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
            zone.valveDevice = row.valveDeviceId.flatMap { connectedDevicesByID[$0] }
            zone.pumpDevice = row.pumpDeviceId.flatMap { connectedDevicesByID[$0] }
            // soilSensor/flowSensor can't resolve yet at this point in the
            // restore — Sensor restoration runs after Plants (Sensor can
            // reference Plant, Plant can reference IrrigationZone), so
            // sensorsByID doesn't exist yet here. Wired in a second pass
            // right after Sensor restoration instead — see below.
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

        // Phase 7B — two passes: parentBatch can reference another
        // batch from this same remote array, which may not exist as a
        // local object yet on a first pass (same pattern already used
        // for IrrigationZone.soilSensor/flowSensor in Phase 5E).
        let remoteBatches: [CultureBatchRow] = try await AuthService.client.from("culture_batches").select().execute().value
        var batchesByID: [UUID: CultureBatch] = [:]
        for row in remoteBatches {
            let batch = CultureBatch(
                batchCode: row.batchCode, speciesName: row.speciesName, cultureStage: row.cultureStage,
                initialExplantCount: row.initialExplantCount, motherPlant: row.motherPlantId.flatMap { plantsByID[$0] }
            )
            batch.id = row.id
            batch.status = row.status
            batch.startedAt = row.startedAt
            batch.expectedEndAt = row.expectedEndAt
            batch.currentCount = row.currentCount
            batch.notes = row.notes
            batch.cultivar = row.cultivar
            batch.explantType = row.explantType
            batch.cultureSystem = row.cultureSystem
            batch.createdAt = row.createdAt
            batch.syncStatus = .synced
            batch.updatedAt = row.updatedAt
            context.insert(batch)
            batchesByID[row.id] = batch
        }
        for row in remoteBatches {
            guard let parentId = row.parentBatchId else { continue }
            batchesByID[row.id]?.parentBatch = batchesByID[parentId]
        }
        // Phase 7L — Plant was restored before CultureBatch existed to
        // link back to.
        for row in remotePlants {
            guard let originBatchId = row.originBatchId else { continue }
            plantsByID[row.id]?.originBatch = batchesByID[originBatchId]
        }

        let remoteAcclimatizationBatches: [AcclimatizationBatchRow] = try await AuthService.client.from("acclimatization_batches").select().execute().value
        var acclimatizationBatchesByID: [UUID: AcclimatizationBatch] = [:]
        for row in remoteAcclimatizationBatches {
            let batch = AcclimatizationBatch(
                cultureBatch: row.cultureBatchId.flatMap { batchesByID[$0] }, initialPlantletCount: row.initialPlantletCount,
                substrate: row.substrate, humidityProgram: row.humidityProgram, temperature: row.temperature,
                location: row.location, notes: row.notes
            )
            batch.id = row.id
            batch.startedAt = row.startedAt
            batch.currentSurvivorCount = row.currentSurvivorCount
            batch.status = row.status
            batch.steps = row.steps
            batch.plantsCreated = row.plantsCreated
            batch.createdAt = row.createdAt
            batch.syncStatus = .synced
            batch.updatedAt = row.updatedAt
            context.insert(batch)
            batch.cultureBatch?.acclimatizationBatches.append(batch)
            acclimatizationBatchesByID[row.id] = batch
        }

        let remoteLabInventoryItems: [LabInventoryItemRow] = try await AuthService.client.from("lab_inventory_items").select().execute().value
        for row in remoteLabInventoryItems {
            let item = LabInventoryItem(
                name: row.name, category: row.category, currentQuantity: row.currentQuantity,
                minimumThreshold: row.minimumThreshold, unit: row.unit, supplier: row.supplier,
                lotNumber: row.lotNumber, expiryDate: row.expiryDate, notes: row.notes
            )
            item.id = row.id
            item.createdAt = row.createdAt
            item.syncStatus = .synced
            item.updatedAt = row.updatedAt
            context.insert(item)
        }

        // Enhancement — Smart Media foundation. No dependency on
        // anything else, so restored before the recipe chain that will
        // reference these compounds via a plain UUID stored inside
        // MediumComponentAmount (not a live relationship, so no
        // resolution needed there) and via the two real relationships
        // below (StockSolution/InventoryLot.compound).
        let remoteLabCompounds: [LabCompoundRow] = try await AuthService.client.from("lab_compounds").select().execute().value
        var labCompoundsByID: [UUID: LabCompound] = [:]
        for row in remoteLabCompounds {
            let compound = LabCompound(
                name: row.name, shortName: row.shortName, category: row.category, molecularWeight: row.molecularWeight,
                defaultUnit: row.defaultUnit, supplier: row.supplier, catalogNumber: row.catalogNumber, notes: row.notes
            )
            compound.id = row.id
            compound.isHidden = row.isHidden
            compound.createdAt = row.createdAt
            compound.syncStatus = .synced
            compound.updatedAt = row.updatedAt
            context.insert(compound)
            labCompoundsByID[row.id] = compound
        }

        let remoteStockSolutions: [StockSolutionRow] = try await AuthService.client.from("stock_solutions").select().execute().value
        for row in remoteStockSolutions {
            let solution = StockSolution(
                compound: row.compoundId.flatMap { labCompoundsByID[$0] }, name: row.name, concentration: row.concentration,
                concentrationUnit: row.concentrationUnit, preparedVolumeLiters: row.preparedVolumeLiters,
                storageLocation: row.storageLocation, expiresAt: row.expiresAt, lotNumber: row.lotNumber, notes: row.notes
            )
            solution.id = row.id
            solution.remainingVolumeLiters = row.remainingVolumeLiters
            solution.preparedAt = row.preparedAt
            solution.createdAt = row.createdAt
            solution.syncStatus = .synced
            solution.updatedAt = row.updatedAt
            context.insert(solution)
        }

        let remoteInventoryLots: [InventoryLotRow] = try await AuthService.client.from("inventory_lots").select().execute().value
        for row in remoteInventoryLots {
            let lot = InventoryLot(
                compound: row.compoundId.flatMap { labCompoundsByID[$0] }, lotNumber: row.lotNumber,
                quantityReceived: row.quantityReceived, unit: row.unit, supplier: row.supplier,
                expiresAt: row.expiresAt, costTotal: row.costTotal, notes: row.notes
            )
            lot.id = row.id
            lot.quantityRemaining = row.quantityRemaining
            lot.receivedAt = row.receivedAt
            lot.createdAt = row.createdAt
            lot.syncStatus = .synced
            lot.updatedAt = row.updatedAt
            context.insert(lot)
        }

        // Enhancement Phase 7T — entityId is a plain UUID, not a live
        // relationship, so this has no ordering dependency on anything.
        let remoteAuditEntries: [BioLabAuditEntryRow] = try await AuthService.client.from("biolab_audit_entries").select().execute().value
        for row in remoteAuditEntries {
            let entry = BioLabAuditEntry(
                entityType: row.entityType, entityId: row.entityId, action: row.action, detail: row.detail, performedBy: row.performedBy
            )
            entry.id = row.id
            entry.occurredAt = row.occurredAt
            entry.syncStatus = .synced
            entry.updatedAt = row.updatedAt
            context.insert(entry)
        }

        // Phase 7C.
        let remoteRecipes: [MediumRecipeRow] = try await AuthService.client.from("medium_recipes").select().execute().value
        var recipesByID: [UUID: MediumRecipe] = [:]
        for row in remoteRecipes {
            let recipe = MediumRecipe(name: row.name, speciesName: row.speciesName, notes: row.notes)
            recipe.id = row.id
            recipe.createdAt = row.createdAt
            recipe.syncStatus = .synced
            recipe.updatedAt = row.updatedAt
            context.insert(recipe)
            recipesByID[row.id] = recipe
        }

        let remoteVersions: [MediumRecipeVersionRow] = try await AuthService.client.from("medium_recipe_versions").select().execute().value
        var versionsByID: [UUID: MediumRecipeVersion] = [:]
        for row in remoteVersions {
            guard let recipe = recipesByID[row.recipeId] else { continue }
            let version = MediumRecipeVersion(
                recipe: recipe, versionNumber: row.versionNumber, targetPH: row.targetPH,
                components: row.components, notes: row.notes
            )
            version.id = row.id
            version.measuredPH = row.measuredPH
            version.changeReason = row.changeReason
            version.createdAt = row.createdAt
            version.syncStatus = .synced
            version.updatedAt = row.updatedAt
            context.insert(version)
            recipe.versions.append(version)
            versionsByID[row.id] = version
        }
        // Same two-pass shape as CultureBatch.parentBatch — a parent
        // version may not exist locally yet on the first pass.
        for row in remoteVersions {
            guard let parentId = row.parentVersionId else { continue }
            versionsByID[row.id]?.parentVersion = versionsByID[parentId]
        }
        // Deferred until here: CultureBatch's own restore ran before
        // recipe versions existed to link to.
        for row in remoteBatches {
            guard let versionId = row.mediumRecipeVersionId else { continue }
            batchesByID[row.id]?.mediumRecipeVersion = versionsByID[versionId]
        }

        let remoteMediumBatches: [MediumBatchRow] = try await AuthService.client.from("medium_batches").select().execute().value
        for row in remoteMediumBatches {
            let mediumBatch = MediumBatch(
                code: row.code, recipeVersion: row.recipeVersionId.flatMap { versionsByID[$0] },
                volumeLiters: row.volumeLiters, notes: row.notes
            )
            mediumBatch.id = row.id
            mediumBatch.preparedAt = row.preparedAt
            mediumBatch.targetVolumeLiters = row.targetVolumeLiters
            mediumBatch.preparedBy = row.preparedBy
            mediumBatch.measuredPH = row.measuredPH
            mediumBatch.compoundLots = row.compoundLots
            mediumBatch.createdAt = row.createdAt
            mediumBatch.syncStatus = .synced
            mediumBatch.updatedAt = row.updatedAt
            context.insert(mediumBatch)
        }

        // Phase 7D.
        let remoteBioreactors: [BioreactorRow] = try await AuthService.client.from("bioreactors").select().execute().value
        var bioreactorsByID: [UUID: Bioreactor] = [:]
        for row in remoteBioreactors {
            let bioreactor = Bioreactor(
                name: row.name, code: row.code, bioreactorType: row.bioreactorType, totalVolumeLiters: row.totalVolumeLiters,
                workingVolumeLiters: row.workingVolumeLiters, componentTypes: row.componentTypes, location: row.location
            )
            bioreactor.id = row.id
            bioreactor.status = row.status
            bioreactor.currentBatch = row.currentBatchId.flatMap { batchesByID[$0] }
            bioreactor.automationEnabled = row.automationEnabled
            bioreactor.scheduleResumedAt = row.scheduleResumedAt
            bioreactor.createdAt = row.createdAt
            bioreactor.syncStatus = .synced
            bioreactor.updatedAt = row.updatedAt
            context.insert(bioreactor)
            bioreactorsByID[row.id] = bioreactor
        }

        let remoteMaintenanceEvents: [BioreactorMaintenanceEventRow] = try await AuthService.client.from("bioreactor_maintenance").select().execute().value
        for row in remoteMaintenanceEvents {
            guard let bioreactor = bioreactorsByID[row.bioreactorId] else { continue }
            let event = BioreactorMaintenanceEvent(bioreactor: bioreactor, eventType: row.eventType, notes: row.notes)
            event.id = row.id
            event.date = row.date
            event.syncStatus = .synced
            event.updatedAt = row.updatedAt
            context.insert(event)
            bioreactor.maintenanceEvents.append(event)
        }

        // Phase 7G — ConnectedDevice was already restored earlier (Sensor's
        // own device references above already depend on it), so
        // connectedDevicesByID is safe to read here.
        let remoteDeviceBindings: [BioreactorDeviceBindingRow] = try await AuthService.client.from("bioreactor_device_bindings").select().execute().value
        for row in remoteDeviceBindings {
            guard let bioreactor = bioreactorsByID[row.bioreactorId] else { continue }
            let binding = BioreactorDeviceBinding(
                bioreactor: bioreactor, role: row.role, device: row.deviceId.flatMap { connectedDevicesByID[$0] }
            )
            binding.id = row.id
            binding.createdAt = row.createdAt
            binding.syncStatus = .synced
            binding.updatedAt = row.updatedAt
            context.insert(binding)
            bioreactor.deviceBindings.append(binding)
        }

        // Spec's "QR / NFC" section — moved here from right after
        // AIAnalysis (its original position, when Plant was the only
        // possible target): a tag can now also reference Bioreactor,
        // the last of its five possible targets to become available
        // during restore (Plant/CultureBatch/MediumRecipeVersion/
        // AcclimatizationBatch all exist earlier already).
        let remoteSmartTags: [SmartTagRow] = try await AuthService.client.from("smart_tags").select().execute().value
        for row in remoteSmartTags {
            let tag = SmartTag(
                plant: row.plantId.flatMap { plantsByID[$0] }, type: row.type,
                bioreactor: row.bioreactorId.flatMap { bioreactorsByID[$0] },
                cultureBatch: row.cultureBatchId.flatMap { batchesByID[$0] },
                mediumRecipeVersion: row.mediumRecipeVersionId.flatMap { versionsByID[$0] },
                acclimatizationBatch: row.acclimatizationBatchId.flatMap { acclimatizationBatchesByID[$0] },
                rackLabel: row.rackLabel
            )
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

        // Phase 7H.
        let remoteBioreactorInspections: [BioreactorInspectionRow] = try await AuthService.client.from("bioreactor_inspections").select().execute().value
        var inspectionsByID: [UUID: BioreactorInspection] = [:]
        for row in remoteBioreactorInspections {
            let batch = row.cultureBatchId.flatMap { batchesByID[$0] }
            let inspection = BioreactorInspection(
                cultureBatch: batch, bioreactor: row.bioreactorId.flatMap { bioreactorsByID[$0] }, date: row.date,
                cultureAppearance: row.cultureAppearance, contaminationStatus: row.contaminationStatus,
                hyperhydricityStatus: row.hyperhydricityStatus, necrosisStatus: row.necrosisStatus,
                browningStatus: row.browningStatus, growthStatus: row.growthStatus,
                estimatedCount: row.estimatedCount, notes: row.notes
            )
            inspection.id = row.id
            inspection.createdAt = row.createdAt
            inspection.syncStatus = .synced
            inspection.updatedAt = row.updatedAt
            context.insert(inspection)
            batch?.inspections.append(inspection)
            inspectionsByID[row.id] = inspection
        }

        let remoteInspectionPhotos: [BioLabInspectionPhotoRow] = try await AuthService.client.from("biolab_inspection_photos").select().execute().value
        for row in remoteInspectionPhotos {
            guard let inspection = inspectionsByID[row.inspectionId] else { continue }
            guard let imageData = try? await downloadPhoto(path: row.storagePath),
                  let thumbnailData = try? await downloadPhoto(path: row.thumbnailStoragePath) else { continue }
            let photo = BioLabInspectionPhoto(
                inspection: inspection, imageData: imageData, thumbnailData: thumbnailData,
                category: row.category, date: row.date
            )
            photo.id = row.id
            photo.syncStatus = .synced
            context.insert(photo)
            inspection.photos.append(photo)
        }

        // Phase 7E.
        let remotePrograms: [BioreactorProgramRow] = try await AuthService.client.from("bioreactor_programs").select().execute().value
        var programsByID: [UUID: BioreactorProgram] = [:]
        for row in remotePrograms {
            let program = BioreactorProgram(name: row.name)
            program.id = row.id
            program.createdAt = row.createdAt
            program.syncStatus = .synced
            program.updatedAt = row.updatedAt
            context.insert(program)
            programsByID[row.id] = program
        }

        let remoteProgramVersions: [BioreactorProgramVersionRow] = try await AuthService.client.from("bioreactor_program_versions").select().execute().value
        var programVersionsByID: [UUID: BioreactorProgramVersion] = [:]
        for row in remoteProgramVersions {
            guard let program = programsByID[row.programId] else { continue }
            let version = BioreactorProgramVersion(
                program: program, versionNumber: row.versionNumber,
                immersionEnabled: row.immersionEnabled, immersionDurationSeconds: row.immersionDurationSeconds,
                immersionIntervalMinutes: row.immersionIntervalMinutes, aerationEnabled: row.aerationEnabled,
                aerationDurationSeconds: row.aerationDurationSeconds, aerationIntervalMinutes: row.aerationIntervalMinutes,
                photoperiodEnabled: row.photoperiodEnabled, lightStartMinutesSinceMidnight: row.lightStartMinutesSinceMidnight,
                lightEndMinutesSinceMidnight: row.lightEndMinutesSinceMidnight, targetTemperature: row.targetTemperature,
                maxImmersionDurationSeconds: row.maxImmersionDurationSeconds, maxAerationDurationSeconds: row.maxAerationDurationSeconds,
                notes: row.notes
            )
            version.id = row.id
            version.createdAt = row.createdAt
            version.syncStatus = .synced
            version.updatedAt = row.updatedAt
            context.insert(version)
            program.versions.append(version)
            programVersionsByID[row.id] = version
        }
        // Deferred: Bioreactor was restored before program versions existed.
        for row in remoteBioreactors {
            guard let versionId = row.activeProgramVersionId else { continue }
            bioreactorsByID[row.id]?.activeProgramVersion = programVersionsByID[versionId]
        }

        // Phase 7K — ExperimentGroup needs programVersionsByID above, so
        // this has to sit here rather than nearer CultureBatch's own
        // restore. CultureBatch.experimentGroup is deferred a second
        // time for the same reason as its mediumRecipeVersion above.
        let remoteBioLabExperiments: [BioLabExperimentRow] = try await AuthService.client.from("bio_lab_experiments").select().execute().value
        var bioLabExperimentsByID: [UUID: BioLabExperiment] = [:]
        for row in remoteBioLabExperiments {
            let experiment = BioLabExperiment(
                code: row.code, question: row.question, independentVariables: row.independentVariables,
                controlledVariables: row.controlledVariables, outcomes: row.outcomes, notes: row.notes, startedAt: row.startedAt
            )
            experiment.id = row.id
            experiment.createdAt = row.createdAt
            experiment.syncStatus = .synced
            experiment.updatedAt = row.updatedAt
            context.insert(experiment)
            bioLabExperimentsByID[row.id] = experiment
        }

        let remoteExperimentGroups: [ExperimentGroupRow] = try await AuthService.client.from("experiment_groups").select().execute().value
        var experimentGroupsByID: [UUID: ExperimentGroup] = [:]
        for row in remoteExperimentGroups {
            guard let experiment = bioLabExperimentsByID[row.experimentId] else { continue }
            let group = ExperimentGroup(
                experiment: experiment, name: row.name, programVersion: row.programVersionId.flatMap { programVersionsByID[$0] }
            )
            group.id = row.id
            group.createdAt = row.createdAt
            group.syncStatus = .synced
            group.updatedAt = row.updatedAt
            context.insert(group)
            experiment.groups.append(group)
            experimentGroupsByID[row.id] = group
        }

        for row in remoteBatches {
            guard let groupId = row.experimentGroupId else { continue }
            batchesByID[row.id]?.experimentGroup = experimentGroupsByID[groupId]
        }

        let remoteCycleExecutions: [BioreactorCycleExecutionRow] = try await AuthService.client.from("bioreactor_cycle_executions").select().execute().value
        for row in remoteCycleExecutions {
            guard let bioreactor = bioreactorsByID[row.bioreactorId] else { continue }
            let execution = BioreactorCycleExecution(
                bioreactor: bioreactor, programVersion: row.programVersionId.flatMap { programVersionsByID[$0] },
                cycleType: row.cycleType, plannedStart: row.plannedStart, expectedDurationSeconds: row.expectedDurationSeconds
            )
            execution.id = row.id
            execution.actualStart = row.actualStart
            execution.actualEnd = row.actualEnd
            execution.actualDurationSeconds = row.actualDurationSeconds
            execution.status = row.status
            execution.failureReason = row.failureReason
            execution.sensorSnapshotBefore = row.sensorSnapshotBefore
            execution.sensorSnapshotAfter = row.sensorSnapshotAfter
            execution.syncStatus = .synced
            execution.updatedAt = row.updatedAt
            context.insert(execution)
        }

        let remoteAlerts: [BioLabAlertRow] = try await AuthService.client.from("biolab_alerts").select().execute().value
        for row in remoteAlerts {
            let alert = BioLabAlert(
                alertType: row.alertType, priority: row.priority, message: row.message,
                bioreactor: row.bioreactorId.flatMap { bioreactorsByID[$0] }, cultureBatch: row.cultureBatchId.flatMap { batchesByID[$0] }
            )
            alert.id = row.id
            alert.createdAt = row.createdAt
            alert.resolvedAt = row.resolvedAt
            alert.syncStatus = .synced
            alert.updatedAt = row.updatedAt
            context.insert(alert)
        }

        let remoteSensors: [SensorRow] = try await AuthService.client.from("sensors").select().execute().value
        var sensorsByID: [UUID: Sensor] = [:]
        for row in remoteSensors {
            let sensor = Sensor(
                name: row.name, type: row.type, unit: row.unit, enabled: row.enabled, source: row.source,
                minimumExpected: row.minimumExpected, maximumExpected: row.maximumExpected,
                plant: row.plantId.flatMap { plantsByID[$0] }, garden: row.gardenId.flatMap { gardensByID[$0] },
                zone: row.zoneId.flatMap { zonesByID[$0] }, device: row.deviceId.flatMap { connectedDevicesByID[$0] },
                bioreactor: row.bioreactorId.flatMap { bioreactorsByID[$0] }
            )
            sensor.id = row.id
            sensor.createdAt = row.createdAt
            sensor.syncStatus = .synced
            sensor.updatedAt = row.updatedAt
            context.insert(sensor)
            sensorsByID[row.id] = sensor
        }

        let remoteSensorReadings: [SensorReadingRow] = try await AuthService.client.from("sensor_readings").select().execute().value
        for row in remoteSensorReadings {
            guard let sensor = sensorsByID[row.sensorId] else { continue }
            let reading = SensorReading(
                sensor: sensor, timestamp: row.timestamp, value: row.value, unit: row.unit,
                quality: row.quality, source: row.source
            )
            reading.id = row.id
            reading.syncStatus = .synced
            context.insert(reading)
        }

        // Second pass over the irrigation zones restored earlier, now that
        // sensorsByID actually exists — see that loop's own comment for
        // why this can't happen in one pass.
        for row in remoteIrrigationZones {
            guard let zone = irrigationZonesByID[row.id] else { continue }
            zone.soilSensor = row.soilSensorId.flatMap { sensorsByID[$0] }
            zone.flowSensor = row.flowSensorId.flatMap { sensorsByID[$0] }
        }

        var automationRulesByID: [UUID: AutomationRule] = [:]
        let remoteAutomationRules: [AutomationRuleRow] = try await AuthService.client.from("automation_rules").select().execute().value
        for row in remoteAutomationRules {
            let rule = AutomationRule(
                name: row.name, mode: row.mode, scopeGarden: row.scopeGardenId.flatMap { gardensByID[$0] },
                scopeZone: row.scopeZoneId.flatMap { zonesByID[$0] }, scopePlant: row.scopePlantId.flatMap { plantsByID[$0] }
            )
            rule.id = row.id
            rule.enabled = row.enabled
            rule.maxDurationSeconds = row.maxDurationSeconds
            rule.maxVolumeLiters = row.maxVolumeLiters
            rule.maxRunsPerDay = row.maxRunsPerDay
            rule.minimumDelayBetweenRunsMinutes = row.minimumDelayBetweenRunsMinutes
            rule.createdAt = row.createdAt
            rule.lastTriggeredAt = row.lastTriggeredAt
            rule.syncStatus = .synced
            rule.updatedAt = row.updatedAt
            context.insert(rule)
            automationRulesByID[row.id] = rule
        }

        let remoteAutomationConditions: [AutomationConditionRow] = try await AuthService.client.from("automation_conditions").select().execute().value
        for row in remoteAutomationConditions {
            guard let rule = automationRulesByID[row.ruleId] else { continue }
            let condition = AutomationCondition(type: row.type, order: row.order)
            condition.id = row.id
            condition.numericThreshold = row.numericThreshold
            condition.hoursThreshold = row.hoursThreshold
            condition.timeRangeStartMinutes = row.timeRangeStartMinutes
            condition.timeRangeEndMinutes = row.timeRangeEndMinutes
            condition.daysOfWeek = row.daysOfWeek
            condition.sensor = row.sensorId.flatMap { sensorsByID[$0] }
            condition.device = row.deviceId.flatMap { connectedDevicesByID[$0] }
            condition.rule = rule
            context.insert(condition)
        }

        let remoteAutomationActions: [AutomationActionRow] = try await AuthService.client.from("automation_actions").select().execute().value
        for row in remoteAutomationActions {
            guard let rule = automationRulesByID[row.ruleId] else { continue }
            let action = AutomationAction(
                type: row.type, device: row.deviceId.flatMap { connectedDevicesByID[$0] },
                durationSeconds: row.durationSeconds, message: row.message, order: row.order
            )
            action.id = row.id
            action.rule = rule
            context.insert(action)
        }

        var greenhousesByID: [UUID: Greenhouse] = [:]
        let remoteGreenhouses: [GreenhouseRow] = try await AuthService.client.from("greenhouses").select().execute().value
        for row in remoteGreenhouses {
            let greenhouse = Greenhouse(
                name: row.name, garden: row.gardenId.flatMap { gardensByID[$0] }, zone: row.zoneId.flatMap { zonesByID[$0] }
            )
            greenhouse.id = row.id
            greenhouse.targetTemperatureMin = row.targetTemperatureMin
            greenhouse.targetTemperatureMax = row.targetTemperatureMax
            greenhouse.targetHumidityMin = row.targetHumidityMin
            greenhouse.targetHumidityMax = row.targetHumidityMax
            greenhouse.targetLightMin = row.targetLightMin
            greenhouse.targetLightMax = row.targetLightMax
            greenhouse.climateControlEnabled = row.climateControlEnabled
            greenhouse.temperatureSensor = row.temperatureSensorId.flatMap { sensorsByID[$0] }
            greenhouse.humiditySensor = row.humiditySensorId.flatMap { sensorsByID[$0] }
            greenhouse.lightSensor = row.lightSensorId.flatMap { sensorsByID[$0] }
            greenhouse.soilSensor = row.soilSensorId.flatMap { sensorsByID[$0] }
            greenhouse.heaterDevice = row.heaterDeviceId.flatMap { connectedDevicesByID[$0] }
            greenhouse.fanDevice = row.fanDeviceId.flatMap { connectedDevicesByID[$0] }
            greenhouse.misterDevice = row.misterDeviceId.flatMap { connectedDevicesByID[$0] }
            greenhouse.lightDevice = row.lightDeviceId.flatMap { connectedDevicesByID[$0] }
            greenhouse.valveDevice = row.valveDeviceId.flatMap { connectedDevicesByID[$0] }
            greenhouse.syncStatus = .synced
            greenhouse.updatedAt = row.updatedAt
            context.insert(greenhouse)
            greenhousesByID[row.id] = greenhouse
        }

        let remotePonds: [PondRow] = try await AuthService.client.from("ponds").select().execute().value
        for row in remotePonds {
            let pond = Pond(name: row.name, garden: row.gardenId.flatMap { gardensByID[$0] })
            pond.id = row.id
            pond.volumeLiters = row.volumeLiters
            pond.targetTemperatureMin = row.targetTemperatureMin
            pond.targetTemperatureMax = row.targetTemperatureMax
            pond.targetWaterLevelPercent = row.targetWaterLevelPercent
            pond.waterTemperatureSensor = row.waterTemperatureSensorId.flatMap { sensorsByID[$0] }
            pond.waterLevelSensor = row.waterLevelSensorId.flatMap { sensorsByID[$0] }
            pond.flowSensor = row.flowSensorId.flatMap { sensorsByID[$0] }
            pond.phSensor = row.phSensorId.flatMap { sensorsByID[$0] }
            pond.conductivitySensor = row.conductivitySensorId.flatMap { sensorsByID[$0] }
            pond.pumpDevice = row.pumpDeviceId.flatMap { connectedDevicesByID[$0] }
            pond.filtrationDevice = row.filtrationDeviceId.flatMap { connectedDevicesByID[$0] }
            pond.uvDevice = row.uvDeviceId.flatMap { connectedDevicesByID[$0] }
            pond.lastFiltrationCleanedAt = row.lastFiltrationCleanedAt
            pond.uvLampInstalledAt = row.uvLampInstalledAt
            pond.uvLampReminderAfterDays = row.uvLampReminderAfterDays
            pond.syncStatus = .synced
            pond.updatedAt = row.updatedAt
            context.insert(pond)
        }

        let remoteBoundaries: [GardenBoundaryRow] = try await AuthService.client.from("garden_boundaries").select().is("deleted_at", value: nil).execute().value
        for row in remoteBoundaries {
            let garden = row.gardenId.flatMap { gardensByID[$0] }
            let boundary = GardenBoundary(garden: garden, points: row.points)
            boundary.id = row.id
            boundary.syncStatus = .synced
            boundary.updatedAt = row.updatedAt
            context.insert(boundary)
            garden?.boundary = boundary
        }

        let remoteMapObjects: [GardenMapObjectRow] = try await AuthService.client.from("garden_map_objects").select().is("deleted_at", value: nil).execute().value
        for row in remoteMapObjects {
            let garden = row.gardenId.flatMap { gardensByID[$0] }
            let object = GardenMapObject(
                garden: garden, objectType: row.objectType,
                position: GardenCoordinate(xMeters: row.positionXMeters, yMeters: row.positionYMeters)
            )
            object.id = row.id
            object.rotationRadians = row.rotationRadians
            object.widthMeters = row.widthMeters
            object.heightMeters = row.heightMeters
            object.zIndex = row.zIndex
            object.label = row.label
            object.linkedEntityId = row.linkedEntityId
            object.linkedEntityKind = row.linkedEntityKind
            object.canopyDiameterMeters = row.canopyDiameterMeters
            object.estimatedAdultCanopyDiameterMeters = row.estimatedAdultCanopyDiameterMeters
            object.sprinklerRadiusMeters = row.sprinklerRadiusMeters
            object.sprinklerStartAngleDegrees = row.sprinklerStartAngleDegrees
            object.sprinklerEndAngleDegrees = row.sprinklerEndAngleDegrees
            object.sprinklerFlowRateLitersPerHour = row.sprinklerFlowRateLitersPerHour
            object.structureHeightMeters = row.structureHeightMeters
            object.estimatedYearsToMaturity = row.estimatedYearsToMaturity
            object.syncStatus = .synced
            object.updatedAt = row.updatedAt
            context.insert(object)
        }

        let remoteAreas: [GardenAreaRow] = try await AuthService.client.from("garden_areas").select().is("deleted_at", value: nil).execute().value
        for row in remoteAreas {
            let garden = row.gardenId.flatMap { gardensByID[$0] }
            let area = GardenArea(garden: garden, areaType: row.areaType, name: row.name, points: row.points)
            area.id = row.id
            area.microclimateSunLevel = row.microclimateSunLevel
            area.microclimateWindLevel = row.microclimateWindLevel
            area.microclimateSoilLevel = row.microclimateSoilLevel
            area.microclimateNotes = row.microclimateNotes
            area.syncStatus = .synced
            area.updatedAt = row.updatedAt
            context.insert(area)
        }

        let remotePipes: [IrrigationPipeRow] = try await AuthService.client.from("irrigation_pipes").select().is("deleted_at", value: nil).execute().value
        for row in remotePipes {
            let garden = row.gardenId.flatMap { gardensByID[$0] }
            let pipe = IrrigationPipe(garden: garden, lineType: row.lineType, diameterMM: row.diameterMM, material: row.material, points: row.points)
            pipe.id = row.id
            pipe.startNodeObjectId = row.startNodeObjectId
            pipe.endNodeObjectId = row.endNodeObjectId
            pipe.syncStatus = .synced
            pipe.updatedAt = row.updatedAt
            context.insert(pipe)
        }

        var scenesByID: [UUID: OasisScene] = [:]
        let remoteScenes: [OasisSceneRow] = try await AuthService.client.from("scenes").select().execute().value
        for row in remoteScenes {
            let scene = OasisScene(name: row.name, icon: row.icon, garden: row.gardenId.flatMap { gardensByID[$0] })
            scene.id = row.id
            scene.greenhouse = row.greenhouseId.flatMap { greenhousesByID[$0] }
            scene.setClimateControlEnabled = row.setClimateControlEnabled
            scene.syncStatus = .synced
            scene.updatedAt = row.updatedAt
            context.insert(scene)
            scenesByID[row.id] = scene
        }

        let remoteSceneActions: [OasisSceneActionRow] = try await AuthService.client.from("scene_actions").select().execute().value
        for row in remoteSceneActions {
            guard let scene = scenesByID[row.sceneId] else { continue }
            let action = OasisSceneAction(
                device: row.deviceId.flatMap { connectedDevicesByID[$0] }, capability: row.capability,
                targetOn: row.targetOn, order: row.order
            )
            action.id = row.id
            action.scene = scene
            context.insert(action)
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

        let remoteIrrigationEvents: [IrrigationEventRow] = try await AuthService.client.from("irrigation_events").select().execute().value
        for row in remoteIrrigationEvents {
            guard let zone = irrigationZonesByID[row.zoneId] else { continue }
            let event = IrrigationEvent(
                zone: zone, date: row.date, durationMinutes: row.durationMinutes,
                estimatedLiters: row.estimatedLiters, isAutomatic: row.isAutomatic, notes: row.notes,
                soilMoistureBefore: row.soilMoistureBefore, soilMoistureAfter: row.soilMoistureAfter,
                measuredLiters: row.measuredLiters
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
                prefs.showDeviceHealth = row.showDeviceHealth
                prefs.syncStatus = .synced
                prefs.updatedAt = row.updatedAt
                context.insert(prefs)
            }
        }

        let hasLocalSmartModeSettings = ((try? context.fetchCount(FetchDescriptor<SmartModeSettings>())) ?? 0) > 0
        if !hasLocalSmartModeSettings {
            let remoteSmartModeSettings: [SmartModeSettingsRow] = try await AuthService.client.from("smart_mode_settings").select().execute().value
            if let row = remoteSmartModeSettings.first {
                let settings = SmartModeSettings()
                settings.id = row.id
                settings.vacationModeEnabled = row.vacationModeEnabled
                settings.vacationStartDate = row.vacationStartDate
                settings.vacationEndDate = row.vacationEndDate
                settings.winterModeEnabled = row.winterModeEnabled
                settings.waterSavingModeEnabled = row.waterSavingModeEnabled
                settings.syncStatus = .synced
                settings.updatedAt = row.updatedAt
                context.insert(settings)
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
        var workspaceId: UUID
        var name: String
        var address: String?
        var notes: String
        var dateCreated: Date
        var latitude: Double?
        var longitude: Double?
        var locationName: String?
        var weatherEnabled: Bool
        var preferredMapMode: GardenMapMode?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, name, address, notes
            case workspaceId = "workspace_id"
            case dateCreated = "date_created"
            case latitude, longitude
            case locationName = "location_name"
            case weatherEnabled = "weather_enabled"
            case preferredMapMode = "preferred_map_mode"
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
        var valveDeviceId: UUID?
        var pumpDeviceId: UUID?
        var soilSensorId: UUID?
        var flowSensorId: UUID?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case name, type
            case flowRate = "flow_rate"
            case flowRateUnit = "flow_rate_unit"
            case durationMinutes = "duration_minutes"
            case active, notes
            case updatedAt = "updated_at"
            case valveDeviceId = "valve_device_id"
            case pumpDeviceId = "pump_device_id"
            case soilSensorId = "soil_sensor_id"
            case flowSensorId = "flow_sensor_id"
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
        var originBatchId: UUID?
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
            case originBatchId = "origin_batch_id"
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
        var plantId: UUID?
        var bioreactorId: UUID?
        var cultureBatchId: UUID?
        var mediumRecipeVersionId: UUID?
        var acclimatizationBatchId: UUID?
        var rackLabel: String?
        var type: SmartTagType
        var publicToken: String
        var active: Bool
        var createdAt: Date
        var lastScannedAt: Date?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case bioreactorId = "bioreactor_id"
            case cultureBatchId = "culture_batch_id"
            case mediumRecipeVersionId = "medium_recipe_version_id"
            case acclimatizationBatchId = "acclimatization_batch_id"
            case rackLabel = "rack_label"
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

    private struct GreenhouseRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var zoneId: UUID?
        var name: String
        var targetTemperatureMin: Double?
        var targetTemperatureMax: Double?
        var targetHumidityMin: Double?
        var targetHumidityMax: Double?
        var targetLightMin: Double?
        var targetLightMax: Double?
        var climateControlEnabled: Bool
        var temperatureSensorId: UUID?
        var humiditySensorId: UUID?
        var lightSensorId: UUID?
        var soilSensorId: UUID?
        var heaterDeviceId: UUID?
        var fanDeviceId: UUID?
        var misterDeviceId: UUID?
        var lightDeviceId: UUID?
        var valveDeviceId: UUID?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case zoneId = "zone_id"
            case name
            case targetTemperatureMin = "target_temperature_min"
            case targetTemperatureMax = "target_temperature_max"
            case targetHumidityMin = "target_humidity_min"
            case targetHumidityMax = "target_humidity_max"
            case targetLightMin = "target_light_min"
            case targetLightMax = "target_light_max"
            case climateControlEnabled = "climate_control_enabled"
            case temperatureSensorId = "temperature_sensor_id"
            case humiditySensorId = "humidity_sensor_id"
            case lightSensorId = "light_sensor_id"
            case soilSensorId = "soil_sensor_id"
            case heaterDeviceId = "heater_device_id"
            case fanDeviceId = "fan_device_id"
            case misterDeviceId = "mister_device_id"
            case lightDeviceId = "light_device_id"
            case valveDeviceId = "valve_device_id"
            case updatedAt = "updated_at"
        }
    }

    private struct CultureBatchRow: Decodable {
        var id: UUID
        var batchCode: String
        var speciesName: String
        var cultivar: String?
        var explantType: String?
        var cultureSystem: CultureSystem?
        var cultureStage: CultureStage
        var status: CultureBatchStatus
        var startedAt: Date
        var expectedEndAt: Date?
        var initialExplantCount: Int
        var currentCount: Int
        var notes: String
        var createdAt: Date
        var motherPlantId: UUID?
        var parentBatchId: UUID?
        var mediumRecipeVersionId: UUID?
        var experimentGroupId: UUID?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case batchCode = "batch_code"
            case speciesName = "species_name"
            case cultivar
            case explantType = "explant_type"
            case cultureSystem = "culture_system"
            case cultureStage = "culture_stage"
            case status
            case startedAt = "started_at"
            case expectedEndAt = "expected_end_at"
            case initialExplantCount = "initial_explant_count"
            case currentCount = "current_count"
            case notes
            case createdAt = "created_at"
            case motherPlantId = "mother_plant_id"
            case parentBatchId = "parent_batch_id"
            case mediumRecipeVersionId = "medium_recipe_version_id"
            case experimentGroupId = "experiment_group_id"
            case updatedAt = "updated_at"
        }
    }

    private struct BioLabExperimentRow: Decodable {
        var id: UUID
        var code: String
        var question: String
        var independentVariables: String
        var controlledVariables: String
        var outcomes: String
        var notes: String
        var startedAt: Date
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, code, question
            case independentVariables = "independent_variables"
            case controlledVariables = "controlled_variables"
            case outcomes, notes
            case startedAt = "started_at"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct ExperimentGroupRow: Decodable {
        var id: UUID
        var experimentId: UUID
        var name: String
        var programVersionId: UUID?
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case experimentId = "experiment_id"
            case name
            case programVersionId = "program_version_id"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct MediumRecipeRow: Decodable {
        var id: UUID
        var name: String
        var speciesName: String
        var notes: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case name
            case speciesName = "species_name"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct MediumRecipeVersionRow: Decodable {
        var id: UUID
        var recipeId: UUID
        var versionNumber: Int
        var targetPH: Double
        var measuredPH: Double?
        var components: [MediumComponentAmount]
        var changeReason: String
        var parentVersionId: UUID?
        var notes: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case recipeId = "recipe_id"
            case versionNumber = "version_number"
            case targetPH = "target_ph"
            case measuredPH = "measured_ph"
            case components
            case changeReason = "change_reason"
            case parentVersionId = "parent_version_id"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct MediumBatchRow: Decodable {
        var id: UUID
        var code: String
        var recipeVersionId: UUID?
        var volumeLiters: Double
        var targetVolumeLiters: Double?
        var preparedAt: Date
        var preparedBy: String?
        var measuredPH: Double?
        var compoundLots: [MediumBatchIngredient]
        var notes: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case code
            case recipeVersionId = "recipe_version_id"
            case volumeLiters = "volume_liters"
            case targetVolumeLiters = "target_volume_liters"
            case preparedAt = "prepared_at"
            case preparedBy = "prepared_by"
            case measuredPH = "measured_ph"
            case compoundLots = "compound_lots"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct AcclimatizationBatchRow: Decodable {
        var id: UUID
        var cultureBatchId: UUID?
        var startedAt: Date
        var initialPlantletCount: Int
        var currentSurvivorCount: Int
        var substrate: String
        var humidityProgram: String
        var temperature: Double?
        var location: String
        var status: AcclimatizationStatus
        var steps: [AcclimatizationStep]
        var notes: String
        var plantsCreated: Bool
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case cultureBatchId = "culture_batch_id"
            case startedAt = "started_at"
            case initialPlantletCount = "initial_plantlet_count"
            case currentSurvivorCount = "current_survivor_count"
            case substrate
            case humidityProgram = "humidity_program"
            case temperature, location, status, steps, notes
            case plantsCreated = "plants_created"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct LabInventoryItemRow: Decodable {
        var id: UUID
        var name: String
        var category: LabInventoryCategory
        var currentQuantity: Int
        var minimumThreshold: Int?
        var unit: String
        var supplier: String?
        var lotNumber: String?
        var expiryDate: Date?
        var notes: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, name, category
            case currentQuantity = "current_quantity"
            case minimumThreshold = "minimum_threshold"
            case unit, supplier
            case lotNumber = "lot_number"
            case expiryDate = "expiry_date"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct LabCompoundRow: Decodable {
        var id: UUID
        var name: String
        var shortName: String
        var category: LabCompoundCategory
        var molecularWeight: Double?
        var defaultUnit: ConcentrationUnit
        var supplier: String?
        var catalogNumber: String?
        var notes: String
        var isHidden: Bool
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id, name
            case shortName = "short_name"
            case category
            case molecularWeight = "molecular_weight"
            case defaultUnit = "default_unit"
            case supplier
            case catalogNumber = "catalog_number"
            case notes
            case isHidden = "is_hidden"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct StockSolutionRow: Decodable {
        var id: UUID
        var compoundId: UUID?
        var name: String
        var concentration: Double
        var concentrationUnit: ConcentrationUnit
        var preparedVolumeLiters: Double
        var remainingVolumeLiters: Double
        var preparedAt: Date
        var expiresAt: Date?
        var storageLocation: String
        var lotNumber: String?
        var notes: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case compoundId = "compound_id"
            case name, concentration
            case concentrationUnit = "concentration_unit"
            case preparedVolumeLiters = "prepared_volume_liters"
            case remainingVolumeLiters = "remaining_volume_liters"
            case preparedAt = "prepared_at"
            case expiresAt = "expires_at"
            case storageLocation = "storage_location"
            case lotNumber = "lot_number"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct InventoryLotRow: Decodable {
        var id: UUID
        var compoundId: UUID?
        var lotNumber: String
        var quantityReceived: Double
        var quantityRemaining: Double
        var unit: AmountUnit
        var receivedAt: Date
        var expiresAt: Date?
        var supplier: String?
        var costTotal: Double?
        var notes: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case compoundId = "compound_id"
            case lotNumber = "lot_number"
            case quantityReceived = "quantity_received"
            case quantityRemaining = "quantity_remaining"
            case unit
            case receivedAt = "received_at"
            case expiresAt = "expires_at"
            case supplier
            case costTotal = "cost_total"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct BioLabAuditEntryRow: Decodable {
        var id: UUID
        var entityType: String
        var entityId: UUID
        var action: String
        var detail: String
        var performedBy: String?
        var occurredAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case entityType = "entity_type"
            case entityId = "entity_id"
            case action, detail
            case performedBy = "performed_by"
            case occurredAt = "occurred_at"
            case updatedAt = "updated_at"
        }
    }

    private struct BioreactorRow: Decodable {
        var id: UUID
        var name: String
        var code: String
        var bioreactorType: BioreactorType
        var totalVolumeLiters: Double
        var workingVolumeLiters: Double
        var status: BioreactorStatus
        var componentTypes: [BioreactorComponentType]
        var location: String
        var currentBatchId: UUID?
        var activeProgramVersionId: UUID?
        var automationEnabled: Bool
        var scheduleResumedAt: Date?
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case name
            case code
            case bioreactorType = "bioreactor_type"
            case totalVolumeLiters = "total_volume_liters"
            case workingVolumeLiters = "working_volume_liters"
            case status
            case componentTypes = "component_types"
            case location
            case currentBatchId = "current_batch_id"
            case activeProgramVersionId = "active_program_version_id"
            case automationEnabled = "automation_enabled"
            case scheduleResumedAt = "schedule_resumed_at"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct BioreactorDeviceBindingRow: Decodable {
        var id: UUID
        var bioreactorId: UUID
        var role: BioreactorDeviceRole
        var deviceId: UUID?
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case bioreactorId = "bioreactor_id"
            case role
            case deviceId = "device_id"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct BioreactorInspectionRow: Decodable {
        var id: UUID
        var cultureBatchId: UUID?
        var bioreactorId: UUID?
        var date: Date
        var cultureAppearance: String
        var contaminationStatus: ContaminationStatus
        var hyperhydricityStatus: ObservedSeverity
        var necrosisStatus: ObservedSeverity
        var browningStatus: ObservedSeverity
        var growthStatus: String
        var estimatedCount: Int?
        var notes: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case cultureBatchId = "culture_batch_id"
            case bioreactorId = "bioreactor_id"
            case date
            case cultureAppearance = "culture_appearance"
            case contaminationStatus = "contamination_status"
            case hyperhydricityStatus = "hyperhydricity_status"
            case necrosisStatus = "necrosis_status"
            case browningStatus = "browning_status"
            case growthStatus = "growth_status"
            case estimatedCount = "estimated_count"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct BioLabInspectionPhotoRow: Decodable {
        var id: UUID
        var inspectionId: UUID
        var storagePath: String
        var thumbnailStoragePath: String
        var category: BioLabPhotoCategory
        var date: Date

        enum CodingKeys: String, CodingKey {
            case id
            case inspectionId = "inspection_id"
            case storagePath = "storage_path"
            case thumbnailStoragePath = "thumbnail_storage_path"
            case category, date
        }
    }

    private struct BioreactorMaintenanceEventRow: Decodable {
        var id: UUID
        var bioreactorId: UUID
        var date: Date
        var eventType: MaintenanceEventType
        var notes: String
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case bioreactorId = "bioreactor_id"
            case date
            case eventType = "event_type"
            case notes
            case updatedAt = "updated_at"
        }
    }

    private struct BioreactorProgramRow: Decodable {
        var id: UUID
        var name: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case name
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct BioreactorProgramVersionRow: Decodable {
        var id: UUID
        var programId: UUID
        var versionNumber: Int
        var immersionEnabled: Bool
        var immersionDurationSeconds: Int
        var immersionIntervalMinutes: Int
        var aerationEnabled: Bool
        var aerationDurationSeconds: Int
        var aerationIntervalMinutes: Int
        var photoperiodEnabled: Bool
        var lightStartMinutesSinceMidnight: Int?
        var lightEndMinutesSinceMidnight: Int?
        var targetTemperature: Double?
        var maxImmersionDurationSeconds: Int
        var maxAerationDurationSeconds: Int
        var notes: String
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case programId = "program_id"
            case versionNumber = "version_number"
            case immersionEnabled = "immersion_enabled"
            case immersionDurationSeconds = "immersion_duration_seconds"
            case immersionIntervalMinutes = "immersion_interval_minutes"
            case aerationEnabled = "aeration_enabled"
            case aerationDurationSeconds = "aeration_duration_seconds"
            case aerationIntervalMinutes = "aeration_interval_minutes"
            case photoperiodEnabled = "photoperiod_enabled"
            case lightStartMinutesSinceMidnight = "light_start_minutes"
            case lightEndMinutesSinceMidnight = "light_end_minutes"
            case targetTemperature = "target_temperature"
            case maxImmersionDurationSeconds = "max_immersion_duration_seconds"
            case maxAerationDurationSeconds = "max_aeration_duration_seconds"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct BioreactorCycleExecutionRow: Decodable {
        var id: UUID
        var bioreactorId: UUID
        var programVersionId: UUID?
        var cycleType: BioreactorCycleType
        var plannedStart: Date
        var actualStart: Date?
        var actualEnd: Date?
        var expectedDurationSeconds: Int
        var actualDurationSeconds: Int?
        var status: CycleExecutionStatus
        var failureReason: String?
        var sensorSnapshotBefore: String?
        var sensorSnapshotAfter: String?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case bioreactorId = "bioreactor_id"
            case programVersionId = "program_version_id"
            case cycleType = "cycle_type"
            case plannedStart = "planned_start"
            case actualStart = "actual_start"
            case actualEnd = "actual_end"
            case expectedDurationSeconds = "expected_duration_seconds"
            case actualDurationSeconds = "actual_duration_seconds"
            case status
            case failureReason = "failure_reason"
            case sensorSnapshotBefore = "sensor_snapshot_before"
            case sensorSnapshotAfter = "sensor_snapshot_after"
            case updatedAt = "updated_at"
        }
    }

    private struct BioLabAlertRow: Decodable {
        var id: UUID
        var alertType: BioLabAlertType
        var priority: BioLabAlertPriority
        var message: String
        var bioreactorId: UUID?
        var cultureBatchId: UUID?
        var createdAt: Date
        var resolvedAt: Date?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case alertType = "alert_type"
            case priority
            case message
            case bioreactorId = "bioreactor_id"
            case cultureBatchId = "culture_batch_id"
            case createdAt = "created_at"
            case resolvedAt = "resolved_at"
            case updatedAt = "updated_at"
        }
    }

    private struct GardenBoundaryRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var points: [GardenCoordinate]
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case points
            case updatedAt = "updated_at"
        }
    }

    private struct GardenMapObjectRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var objectType: GardenObjectType
        var positionXMeters: Double
        var positionYMeters: Double
        var rotationRadians: Double
        var widthMeters: Double
        var heightMeters: Double
        var zIndex: Int
        var label: String?
        var linkedEntityId: UUID?
        var linkedEntityKind: GardenObjectLinkKind?
        var canopyDiameterMeters: Double?
        var estimatedAdultCanopyDiameterMeters: Double?
        var sprinklerRadiusMeters: Double?
        var sprinklerStartAngleDegrees: Double?
        var sprinklerEndAngleDegrees: Double?
        var sprinklerFlowRateLitersPerHour: Double?
        var structureHeightMeters: Double?
        var estimatedYearsToMaturity: Double?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case objectType = "object_type"
            case positionXMeters = "position_x_meters"
            case positionYMeters = "position_y_meters"
            case rotationRadians = "rotation_radians"
            case widthMeters = "width_meters"
            case heightMeters = "height_meters"
            case zIndex = "z_index"
            case label
            case linkedEntityId = "linked_entity_id"
            case linkedEntityKind = "linked_entity_kind"
            case canopyDiameterMeters = "canopy_diameter_meters"
            case estimatedAdultCanopyDiameterMeters = "estimated_adult_canopy_diameter_meters"
            case sprinklerRadiusMeters = "sprinkler_radius_meters"
            case sprinklerStartAngleDegrees = "sprinkler_start_angle_degrees"
            case sprinklerEndAngleDegrees = "sprinkler_end_angle_degrees"
            case sprinklerFlowRateLitersPerHour = "sprinkler_flow_rate_liters_per_hour"
            case structureHeightMeters = "structure_height_meters"
            case estimatedYearsToMaturity = "estimated_years_to_maturity"
            case updatedAt = "updated_at"
        }
    }

    private struct GardenAreaRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var areaType: GardenAreaType
        var name: String
        var points: [GardenCoordinate]
        var microclimateSunLevel: MicroclimateSunLevel?
        var microclimateWindLevel: MicroclimateWindLevel?
        var microclimateSoilLevel: MicroclimateSoilLevel?
        var microclimateNotes: String?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case areaType = "area_type"
            case name
            case points
            case microclimateSunLevel = "microclimate_sun_level"
            case microclimateWindLevel = "microclimate_wind_level"
            case microclimateSoilLevel = "microclimate_soil_level"
            case microclimateNotes = "microclimate_notes"
            case updatedAt = "updated_at"
        }
    }

    private struct IrrigationPipeRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var points: [GardenCoordinate]
        var diameterMM: Double
        var material: PipeMaterial
        var lineType: PipeLineType
        var startNodeObjectId: UUID?
        var endNodeObjectId: UUID?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case points
            case diameterMM = "diameter_mm"
            case material
            case lineType = "line_type"
            case startNodeObjectId = "start_node_object_id"
            case endNodeObjectId = "end_node_object_id"
            case updatedAt = "updated_at"
        }
    }

    private struct PondRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var name: String
        var volumeLiters: Double?
        var targetTemperatureMin: Double?
        var targetTemperatureMax: Double?
        var targetWaterLevelPercent: Double?
        var waterTemperatureSensorId: UUID?
        var waterLevelSensorId: UUID?
        var flowSensorId: UUID?
        var phSensorId: UUID?
        var conductivitySensorId: UUID?
        var pumpDeviceId: UUID?
        var filtrationDeviceId: UUID?
        var uvDeviceId: UUID?
        var lastFiltrationCleanedAt: Date?
        var uvLampInstalledAt: Date?
        var uvLampReminderAfterDays: Int?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case name
            case volumeLiters = "volume_liters"
            case targetTemperatureMin = "target_temperature_min"
            case targetTemperatureMax = "target_temperature_max"
            case targetWaterLevelPercent = "target_water_level_percent"
            case waterTemperatureSensorId = "water_temperature_sensor_id"
            case waterLevelSensorId = "water_level_sensor_id"
            case flowSensorId = "flow_sensor_id"
            case phSensorId = "ph_sensor_id"
            case conductivitySensorId = "conductivity_sensor_id"
            case pumpDeviceId = "pump_device_id"
            case filtrationDeviceId = "filtration_device_id"
            case uvDeviceId = "uv_device_id"
            case lastFiltrationCleanedAt = "last_filtration_cleaned_at"
            case uvLampInstalledAt = "uv_lamp_installed_at"
            case uvLampReminderAfterDays = "uv_lamp_reminder_after_days"
            case updatedAt = "updated_at"
        }
    }

    private struct OasisSceneRow: Decodable {
        var id: UUID
        var gardenId: UUID?
        var name: String
        var icon: String
        var greenhouseId: UUID?
        var setClimateControlEnabled: Bool?
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case gardenId = "garden_id"
            case name
            case icon
            case greenhouseId = "greenhouse_id"
            case setClimateControlEnabled = "set_climate_control_enabled"
            case updatedAt = "updated_at"
        }
    }

    private struct OasisSceneActionRow: Decodable {
        var id: UUID
        var sceneId: UUID
        var deviceId: UUID?
        var capability: DeviceCapability
        var targetOn: Bool
        var order: Int

        enum CodingKeys: String, CodingKey {
            case id
            case sceneId = "scene_id"
            case deviceId = "device_id"
            case capability
            case targetOn = "target_on"
            case order
        }
    }

    private struct AutomationRuleRow: Decodable {
        var id: UUID
        var name: String
        var enabled: Bool
        var mode: AutomationMode
        var scopeGardenId: UUID?
        var scopeZoneId: UUID?
        var scopePlantId: UUID?
        var maxDurationSeconds: Double?
        var maxVolumeLiters: Double?
        var maxRunsPerDay: Int?
        var minimumDelayBetweenRunsMinutes: Int?
        var createdAt: Date
        var updatedAt: Date?
        var lastTriggeredAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case name, enabled, mode
            case scopeGardenId = "scope_garden_id"
            case scopeZoneId = "scope_zone_id"
            case scopePlantId = "scope_plant_id"
            case maxDurationSeconds = "max_duration_seconds"
            case maxVolumeLiters = "max_volume_liters"
            case maxRunsPerDay = "max_runs_per_day"
            case minimumDelayBetweenRunsMinutes = "minimum_delay_between_runs_minutes"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
            case lastTriggeredAt = "last_triggered_at"
        }
    }

    private struct AutomationConditionRow: Decodable {
        var id: UUID
        var ruleId: UUID
        var type: AutomationConditionType
        var order: Int
        var numericThreshold: Double?
        var hoursThreshold: Double?
        var timeRangeStartMinutes: Int?
        var timeRangeEndMinutes: Int?
        var daysOfWeek: [Int]
        var sensorId: UUID?
        var deviceId: UUID?

        enum CodingKeys: String, CodingKey {
            case id
            case ruleId = "rule_id"
            case type, order
            case numericThreshold = "numeric_threshold"
            case hoursThreshold = "hours_threshold"
            case timeRangeStartMinutes = "time_range_start_minutes"
            case timeRangeEndMinutes = "time_range_end_minutes"
            case daysOfWeek = "days_of_week"
            case sensorId = "sensor_id"
            case deviceId = "device_id"
        }
    }

    private struct AutomationActionRow: Decodable {
        var id: UUID
        var ruleId: UUID
        var type: AutomationActionType
        var deviceId: UUID?
        var durationSeconds: Double?
        var message: String?
        var order: Int

        enum CodingKeys: String, CodingKey {
            case id
            case ruleId = "rule_id"
            case type
            case deviceId = "device_id"
            case durationSeconds = "duration_seconds"
            case message, order
        }
    }

    private struct SensorRow: Decodable {
        var id: UUID
        var plantId: UUID?
        var gardenId: UUID?
        var zoneId: UUID?
        var deviceId: UUID?
        var bioreactorId: UUID?
        var name: String
        var type: SensorType
        var unit: String
        var enabled: Bool
        var source: SensorSource
        var minimumExpected: Double?
        var maximumExpected: Double?
        var createdAt: Date
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case plantId = "plant_id"
            case gardenId = "garden_id"
            case zoneId = "zone_id"
            case deviceId = "device_id"
            case bioreactorId = "bioreactor_id"
            case name, type, unit, enabled, source
            case minimumExpected = "minimum_expected"
            case maximumExpected = "maximum_expected"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private struct SensorReadingRow: Decodable {
        var id: UUID
        var sensorId: UUID
        var timestamp: Date
        var value: Double
        var unit: String
        var quality: SensorReadingQuality
        var source: SensorSource

        enum CodingKeys: String, CodingKey {
            case id
            case sensorId = "sensor_id"
            case timestamp, value, unit, quality, source
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
        var soilMoistureBefore: Double?
        var soilMoistureAfter: Double?
        var measuredLiters: Double?

        enum CodingKeys: String, CodingKey {
            case id
            case zoneId = "zone_id"
            case date
            case durationMinutes = "duration_minutes"
            case estimatedLiters = "estimated_liters"
            case isAutomatic = "is_automatic"
            case notes
            case soilMoistureBefore = "soil_moisture_before"
            case soilMoistureAfter = "soil_moisture_after"
            case measuredLiters = "measured_liters"
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
        var showDeviceHealth: Bool
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
            case showDeviceHealth = "show_device_health"
            case updatedAt = "updated_at"
        }
    }

    private struct SmartModeSettingsRow: Decodable {
        var id: UUID
        var vacationModeEnabled: Bool
        var vacationStartDate: Date?
        var vacationEndDate: Date?
        var winterModeEnabled: Bool
        var waterSavingModeEnabled: Bool
        var updatedAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case vacationModeEnabled = "vacation_mode_enabled"
            case vacationStartDate = "vacation_start_date"
            case vacationEndDate = "vacation_end_date"
            case winterModeEnabled = "winter_mode_enabled"
            case waterSavingModeEnabled = "water_saving_mode_enabled"
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
        var preferredMapMode: GardenMapMode
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name, address, notes
            case dateCreated = "date_created"
            case latitude, longitude
            case locationName = "location_name"
            case weatherEnabled = "weather_enabled"
            case preferredMapMode = "preferred_map_mode"
            case updatedAt = "updated_at"
        }
    }

    private func pushGardens(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<Garden>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map {
            GardenDTO(
                // L'ESPACE D'ORIGINE D'ABORD. Un jardin descendu de
                // l'espace de l'entreprise doit y retourner ; seul un
                // jardin créé sur ce téléphone n'en a pas encore et
                // reçoit l'espace personnel.
                id: $0.id, workspaceId: $0.remoteWorkspaceID ?? workspaceID,
                name: $0.name, address: $0.address,
                notes: $0.notes, dateCreated: $0.dateCreated, latitude: $0.latitude, longitude: $0.longitude,
                locationName: $0.locationName, weatherEnabled: $0.weatherEnabled,
                preferredMapMode: $0.preferredMapMode, updatedAt: $0.updatedAt ?? .now
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
        var valveDeviceId: UUID?
        var pumpDeviceId: UUID?
        var soilSensorId: UUID?
        var flowSensorId: UUID?

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
            case valveDeviceId = "valve_device_id"
            case pumpDeviceId = "pump_device_id"
            case soilSensorId = "soil_sensor_id"
            case flowSensorId = "flow_sensor_id"
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
                active: zone.active, notes: zone.notes, updatedAt: zone.updatedAt ?? .now,
                valveDeviceId: zone.valveDevice?.id, pumpDeviceId: zone.pumpDevice?.id,
                soilSensorId: zone.soilSensor?.id, flowSensorId: zone.flowSensor?.id
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
        var originBatchId: UUID?
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
            case originBatchId = "origin_batch_id"
            case updatedAt = "updated_at"
        }
    }

    /// Plant pushes very early (many other types depend on it existing
    /// remotely first) — well before pushCultureBatches. Plant.originBatch
    /// (Phase 7L) is the one exception where Plant depends on something
    /// that pushes later, an intentional cross-table cycle with
    /// CultureBatch.motherPlant. Rather than reordering Plant's push
    /// (which would risk every one of its many existing dependents),
    /// originBatchId is only sent once that specific batch is confirmed
    /// `.synced`; until then the plant itself is left `.pendingUpdate`
    /// (not `.synced`) so a later sync call retries it once the batch
    /// has caught up — self-healing across sync calls, never a
    /// permanently dropped link. In realistic use this never triggers:
    /// an origin batch is always old enough (created, multiplied, rooted,
    /// acclimatized) to have already synced by the time it produces
    /// Plant records.
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
            let originBatchResolved = plant.originBatch == nil || plant.originBatch?.syncStatus == .synced
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
                originBatchId: originBatchResolved ? plant.originBatch?.id : nil,
                updatedAt: plant.updatedAt ?? .now
            ))
        }
        try await AuthService.client.from("plants").upsert(dtos).execute()
        for plant in pending {
            let originBatchResolved = plant.originBatch == nil || plant.originBatch?.syncStatus == .synced
            plant.syncStatus = originBatchResolved ? .synced : .pendingUpdate
        }
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
        var plantId: UUID?
        var bioreactorId: UUID?
        var cultureBatchId: UUID?
        var mediumRecipeVersionId: UUID?
        var acclimatizationBatchId: UUID?
        var rackLabel: String?
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
            case bioreactorId = "bioreactor_id"
            case cultureBatchId = "culture_batch_id"
            case mediumRecipeVersionId = "medium_recipe_version_id"
            case acclimatizationBatchId = "acclimatization_batch_id"
            case rackLabel = "rack_label"
            case type
            case publicToken = "public_token"
            case active
            case createdAt = "created_at"
            case lastScannedAt = "last_scanned_at"
            case updatedAt = "updated_at"
        }
    }

    /// No longer skips a tag just for lacking a plant — spec's later
    /// "QR / NFC" section means a tag can point at any one of six things
    /// (five real entities plus a plain rack label), so "has no plant"
    /// is no longer the same as "not ready to sync."
    private func pushSmartTags(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<SmartTag>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { tag in
            SmartTagDTO(
                id: tag.id, workspaceId: workspaceID, plantId: tag.plant?.id, bioreactorId: tag.bioreactor?.id,
                cultureBatchId: tag.cultureBatch?.id, mediumRecipeVersionId: tag.mediumRecipeVersion?.id,
                acclimatizationBatchId: tag.acclimatizationBatch?.id, rackLabel: tag.rackLabel, type: tag.type,
                publicToken: tag.publicToken, active: tag.active, createdAt: tag.createdAt,
                lastScannedAt: tag.lastScannedAt, updatedAt: tag.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("smart_tags").upsert(dtos).execute()
        for tag in pending { tag.syncStatus = .synced }
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

    // MARK: - Sensors

    private struct SensorDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var plantId: UUID?
        var gardenId: UUID?
        var zoneId: UUID?
        var deviceId: UUID?
        var bioreactorId: UUID?
        var name: String
        var type: SensorType
        var unit: String
        var enabled: Bool
        var source: SensorSource
        var minimumExpected: Double?
        var maximumExpected: Double?
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case plantId = "plant_id"
            case gardenId = "garden_id"
            case zoneId = "zone_id"
            case deviceId = "device_id"
            case bioreactorId = "bioreactor_id"
            case name, type, unit, enabled, source
            case minimumExpected = "minimum_expected"
            case maximumExpected = "maximum_expected"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushSensors(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<Sensor>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { sensor in
            SensorDTO(
                id: sensor.id, workspaceId: workspaceID, plantId: sensor.plant?.id, gardenId: sensor.garden?.id,
                zoneId: sensor.zone?.id, deviceId: sensor.device?.id, bioreactorId: sensor.bioreactor?.id,
                name: sensor.name, type: sensor.type,
                unit: sensor.unit, enabled: sensor.enabled, source: sensor.source,
                minimumExpected: sensor.minimumExpected, maximumExpected: sensor.maximumExpected,
                createdAt: sensor.createdAt, updatedAt: sensor.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("sensors").upsert(dtos).execute()
        for sensor in pending { sensor.syncStatus = .synced }
    }

    private struct SensorReadingDTO: Encodable {
        var id: UUID
        var sensorId: UUID
        var timestamp: Date
        var value: Double
        var unit: String
        var quality: SensorReadingQuality
        var source: SensorSource

        enum CodingKeys: String, CodingKey {
            case id
            case sensorId = "sensor_id"
            case timestamp, value, unit, quality, source
        }
    }

    private func pushSensorReadings(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<SensorReading>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { reading -> SensorReadingDTO? in
            guard let sensorID = reading.sensor?.id else { return nil }
            return SensorReadingDTO(
                id: reading.id, sensorId: sensorID, timestamp: reading.timestamp, value: reading.value,
                unit: reading.unit, quality: reading.quality, source: reading.source
            )
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("sensor_readings").upsert(dtos).execute()
        for reading in pending where reading.sensor != nil { reading.syncStatus = .synced }
    }

    // MARK: - Device command audit log

    private struct DeviceCommandLogDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var deviceId: UUID?
        var command: DeviceCommandKind
        var trigger: DeviceCommandTriggerKind
        var triggerRuleId: UUID?
        var requestedAt: Date
        var succeeded: Bool
        var errorMessage: String?
        var requestedDurationSeconds: Double?

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case deviceId = "device_id"
            case command, trigger
            case triggerRuleId = "trigger_rule_id"
            case requestedAt = "requested_at"
            case succeeded
            case errorMessage = "error_message"
            case requestedDurationSeconds = "requested_duration_seconds"
        }
    }

    private func pushDeviceCommandLogs(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<DeviceCommandLog>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { log in
            DeviceCommandLogDTO(
                id: log.id, workspaceId: workspaceID, deviceId: log.device?.id, command: log.command,
                trigger: log.trigger, triggerRuleId: log.triggerRuleID, requestedAt: log.requestedAt,
                succeeded: log.succeeded, errorMessage: log.errorMessage,
                requestedDurationSeconds: log.requestedDurationSeconds
            )
        }
        try await AuthService.client.from("device_commands").upsert(dtos).execute()
        for log in pending { log.syncStatus = .synced }
    }

    // MARK: - Automation

    private struct AutomationRuleDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var name: String
        var enabled: Bool
        var mode: AutomationMode
        var scopeGardenId: UUID?
        var scopeZoneId: UUID?
        var scopePlantId: UUID?
        var maxDurationSeconds: Double?
        var maxVolumeLiters: Double?
        var maxRunsPerDay: Int?
        var minimumDelayBetweenRunsMinutes: Int?
        var createdAt: Date
        var updatedAt: Date
        var lastTriggeredAt: Date?

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name, enabled, mode
            case scopeGardenId = "scope_garden_id"
            case scopeZoneId = "scope_zone_id"
            case scopePlantId = "scope_plant_id"
            case maxDurationSeconds = "max_duration_seconds"
            case maxVolumeLiters = "max_volume_liters"
            case maxRunsPerDay = "max_runs_per_day"
            case minimumDelayBetweenRunsMinutes = "minimum_delay_between_runs_minutes"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
            case lastTriggeredAt = "last_triggered_at"
        }
    }

    /// AutomationCondition/AutomationAction have no syncStatus of their
    /// own (they're small configuration children of a rule, not
    /// accumulating history) — pushed in full alongside pending rules
    /// rather than individually dirty-tracked; upsert makes re-sending
    /// unchanged ones harmless.
    private func pushAutomationRules(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<AutomationRule>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { rule in
            AutomationRuleDTO(
                id: rule.id, workspaceId: workspaceID, name: rule.name, enabled: rule.enabled, mode: rule.mode,
                scopeGardenId: rule.scopeGarden?.id, scopeZoneId: rule.scopeZone?.id, scopePlantId: rule.scopePlant?.id,
                maxDurationSeconds: rule.maxDurationSeconds, maxVolumeLiters: rule.maxVolumeLiters,
                maxRunsPerDay: rule.maxRunsPerDay, minimumDelayBetweenRunsMinutes: rule.minimumDelayBetweenRunsMinutes,
                createdAt: rule.createdAt, updatedAt: rule.updatedAt ?? .now, lastTriggeredAt: rule.lastTriggeredAt
            )
        }
        try await AuthService.client.from("automation_rules").upsert(dtos).execute()
        for rule in pending { rule.syncStatus = .synced }
    }

    private struct AutomationConditionDTO: Encodable {
        var id: UUID
        var ruleId: UUID
        var type: AutomationConditionType
        var order: Int
        var numericThreshold: Double?
        var hoursThreshold: Double?
        var timeRangeStartMinutes: Int?
        var timeRangeEndMinutes: Int?
        var daysOfWeek: [Int]
        var sensorId: UUID?
        var deviceId: UUID?

        enum CodingKeys: String, CodingKey {
            case id
            case ruleId = "rule_id"
            case type, order
            case numericThreshold = "numeric_threshold"
            case hoursThreshold = "hours_threshold"
            case timeRangeStartMinutes = "time_range_start_minutes"
            case timeRangeEndMinutes = "time_range_end_minutes"
            case daysOfWeek = "days_of_week"
            case sensorId = "sensor_id"
            case deviceId = "device_id"
        }
    }

    private func pushAutomationConditions(context: ModelContext) async throws {
        let conditions = try context.fetch(FetchDescriptor<AutomationCondition>()).filter { $0.rule != nil }
        guard !conditions.isEmpty else { return }
        let dtos = conditions.compactMap { condition -> AutomationConditionDTO? in
            guard let ruleID = condition.rule?.id else { return nil }
            return AutomationConditionDTO(
                id: condition.id, ruleId: ruleID, type: condition.type, order: condition.order,
                numericThreshold: condition.numericThreshold, hoursThreshold: condition.hoursThreshold,
                timeRangeStartMinutes: condition.timeRangeStartMinutes, timeRangeEndMinutes: condition.timeRangeEndMinutes,
                daysOfWeek: condition.daysOfWeek, sensorId: condition.sensor?.id, deviceId: condition.device?.id
            )
        }
        try await AuthService.client.from("automation_conditions").upsert(dtos).execute()
    }

    private struct AutomationActionDTO: Encodable {
        var id: UUID
        var ruleId: UUID
        var type: AutomationActionType
        var deviceId: UUID?
        var durationSeconds: Double?
        var message: String?
        var order: Int

        enum CodingKeys: String, CodingKey {
            case id
            case ruleId = "rule_id"
            case type
            case deviceId = "device_id"
            case durationSeconds = "duration_seconds"
            case message, order
        }
    }

    private func pushAutomationActions(context: ModelContext) async throws {
        let actions = try context.fetch(FetchDescriptor<AutomationAction>()).filter { $0.rule != nil }
        guard !actions.isEmpty else { return }
        let dtos = actions.compactMap { action -> AutomationActionDTO? in
            guard let ruleID = action.rule?.id else { return nil }
            return AutomationActionDTO(
                id: action.id, ruleId: ruleID, type: action.type, deviceId: action.device?.id,
                durationSeconds: action.durationSeconds, message: action.message, order: action.order
            )
        }
        try await AuthService.client.from("automation_actions").upsert(dtos).execute()
    }

    private struct AutomationExecutionDTO: Encodable {
        var id: UUID
        var ruleId: UUID?
        var date: Date
        var conditionsSummary: String
        var decision: Bool
        var actionSummary: String?
        var succeeded: Bool
        var errorMessage: String?

        enum CodingKeys: String, CodingKey {
            case id
            case ruleId = "rule_id"
            case date
            case conditionsSummary = "conditions_summary"
            case decision
            case actionSummary = "action_summary"
            case succeeded
            case errorMessage = "error_message"
        }
    }

    private func pushAutomationExecutions(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<AutomationExecution>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { execution in
            AutomationExecutionDTO(
                id: execution.id, ruleId: execution.rule?.id, date: execution.date,
                conditionsSummary: execution.conditionsSummary, decision: execution.decision,
                actionSummary: execution.actionSummary, succeeded: execution.succeeded, errorMessage: execution.errorMessage
            )
        }
        try await AuthService.client.from("automation_executions").upsert(dtos).execute()
        for execution in pending { execution.syncStatus = .synced }
    }

    // MARK: - Greenhouses

    private struct GreenhouseDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var zoneId: UUID?
        var name: String
        var targetTemperatureMin: Double?
        var targetTemperatureMax: Double?
        var targetHumidityMin: Double?
        var targetHumidityMax: Double?
        var targetLightMin: Double?
        var targetLightMax: Double?
        var climateControlEnabled: Bool
        var temperatureSensorId: UUID?
        var humiditySensorId: UUID?
        var lightSensorId: UUID?
        var soilSensorId: UUID?
        var heaterDeviceId: UUID?
        var fanDeviceId: UUID?
        var misterDeviceId: UUID?
        var lightDeviceId: UUID?
        var valveDeviceId: UUID?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case zoneId = "zone_id"
            case name
            case targetTemperatureMin = "target_temperature_min"
            case targetTemperatureMax = "target_temperature_max"
            case targetHumidityMin = "target_humidity_min"
            case targetHumidityMax = "target_humidity_max"
            case targetLightMin = "target_light_min"
            case targetLightMax = "target_light_max"
            case climateControlEnabled = "climate_control_enabled"
            case temperatureSensorId = "temperature_sensor_id"
            case humiditySensorId = "humidity_sensor_id"
            case lightSensorId = "light_sensor_id"
            case soilSensorId = "soil_sensor_id"
            case heaterDeviceId = "heater_device_id"
            case fanDeviceId = "fan_device_id"
            case misterDeviceId = "mister_device_id"
            case lightDeviceId = "light_device_id"
            case valveDeviceId = "valve_device_id"
            case updatedAt = "updated_at"
        }
    }

    private func pushGreenhouses(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<Greenhouse>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { greenhouse in
            GreenhouseDTO(
                id: greenhouse.id, workspaceId: workspaceID, gardenId: greenhouse.garden?.id, zoneId: greenhouse.zone?.id,
                name: greenhouse.name, targetTemperatureMin: greenhouse.targetTemperatureMin,
                targetTemperatureMax: greenhouse.targetTemperatureMax, targetHumidityMin: greenhouse.targetHumidityMin,
                targetHumidityMax: greenhouse.targetHumidityMax, targetLightMin: greenhouse.targetLightMin,
                targetLightMax: greenhouse.targetLightMax, climateControlEnabled: greenhouse.climateControlEnabled,
                temperatureSensorId: greenhouse.temperatureSensor?.id, humiditySensorId: greenhouse.humiditySensor?.id,
                lightSensorId: greenhouse.lightSensor?.id, soilSensorId: greenhouse.soilSensor?.id,
                heaterDeviceId: greenhouse.heaterDevice?.id, fanDeviceId: greenhouse.fanDevice?.id,
                misterDeviceId: greenhouse.misterDevice?.id, lightDeviceId: greenhouse.lightDevice?.id,
                valveDeviceId: greenhouse.valveDevice?.id, updatedAt: greenhouse.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("greenhouses").upsert(dtos).execute()
        for greenhouse in pending { greenhouse.syncStatus = .synced }
    }

    // MARK: - Ponds

    private struct PondDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var name: String
        var volumeLiters: Double?
        var targetTemperatureMin: Double?
        var targetTemperatureMax: Double?
        var targetWaterLevelPercent: Double?
        var waterTemperatureSensorId: UUID?
        var waterLevelSensorId: UUID?
        var flowSensorId: UUID?
        var phSensorId: UUID?
        var conductivitySensorId: UUID?
        var pumpDeviceId: UUID?
        var filtrationDeviceId: UUID?
        var uvDeviceId: UUID?
        var lastFiltrationCleanedAt: Date?
        var uvLampInstalledAt: Date?
        var uvLampReminderAfterDays: Int?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case name
            case volumeLiters = "volume_liters"
            case targetTemperatureMin = "target_temperature_min"
            case targetTemperatureMax = "target_temperature_max"
            case targetWaterLevelPercent = "target_water_level_percent"
            case waterTemperatureSensorId = "water_temperature_sensor_id"
            case waterLevelSensorId = "water_level_sensor_id"
            case flowSensorId = "flow_sensor_id"
            case phSensorId = "ph_sensor_id"
            case conductivitySensorId = "conductivity_sensor_id"
            case pumpDeviceId = "pump_device_id"
            case filtrationDeviceId = "filtration_device_id"
            case uvDeviceId = "uv_device_id"
            case lastFiltrationCleanedAt = "last_filtration_cleaned_at"
            case uvLampInstalledAt = "uv_lamp_installed_at"
            case uvLampReminderAfterDays = "uv_lamp_reminder_after_days"
            case updatedAt = "updated_at"
        }
    }

    private func pushPonds(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<Pond>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { pond in
            PondDTO(
                id: pond.id, workspaceId: workspaceID, gardenId: pond.garden?.id, name: pond.name,
                volumeLiters: pond.volumeLiters, targetTemperatureMin: pond.targetTemperatureMin,
                targetTemperatureMax: pond.targetTemperatureMax, targetWaterLevelPercent: pond.targetWaterLevelPercent,
                waterTemperatureSensorId: pond.waterTemperatureSensor?.id, waterLevelSensorId: pond.waterLevelSensor?.id,
                flowSensorId: pond.flowSensor?.id, phSensorId: pond.phSensor?.id,
                conductivitySensorId: pond.conductivitySensor?.id, pumpDeviceId: pond.pumpDevice?.id,
                filtrationDeviceId: pond.filtrationDevice?.id, uvDeviceId: pond.uvDevice?.id,
                lastFiltrationCleanedAt: pond.lastFiltrationCleanedAt, uvLampInstalledAt: pond.uvLampInstalledAt,
                uvLampReminderAfterDays: pond.uvLampReminderAfterDays, updatedAt: pond.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("ponds").upsert(dtos).execute()
        for pond in pending { pond.syncStatus = .synced }
    }

    // MARK: - Garden boundary (Phase 6B)

    // MARK: - BioLab culture batches (Phase 7B)

    private struct CultureBatchDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var batchCode: String
        var speciesName: String
        var cultivar: String?
        var explantType: String?
        var cultureSystem: CultureSystem?
        var cultureStage: CultureStage
        var status: CultureBatchStatus
        var startedAt: Date
        var expectedEndAt: Date?
        var initialExplantCount: Int
        var currentCount: Int
        var notes: String
        var createdAt: Date
        var motherPlantId: UUID?
        var parentBatchId: UUID?
        var mediumRecipeVersionId: UUID?
        var experimentGroupId: UUID?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case batchCode = "batch_code"
            case speciesName = "species_name"
            case cultivar
            case explantType = "explant_type"
            case cultureSystem = "culture_system"
            case cultureStage = "culture_stage"
            case status
            case startedAt = "started_at"
            case expectedEndAt = "expected_end_at"
            case initialExplantCount = "initial_explant_count"
            case currentCount = "current_count"
            case notes
            case createdAt = "created_at"
            case motherPlantId = "mother_plant_id"
            case parentBatchId = "parent_batch_id"
            case mediumRecipeVersionId = "medium_recipe_version_id"
            case experimentGroupId = "experiment_group_id"
            case updatedAt = "updated_at"
        }
    }

    private func pushCultureBatches(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<CultureBatch>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { batch in
            CultureBatchDTO(
                id: batch.id, workspaceId: workspaceID, batchCode: batch.batchCode, speciesName: batch.speciesName,
                cultivar: batch.cultivar, explantType: batch.explantType, cultureSystem: batch.cultureSystem,
                cultureStage: batch.cultureStage, status: batch.status, startedAt: batch.startedAt,
                expectedEndAt: batch.expectedEndAt, initialExplantCount: batch.initialExplantCount,
                currentCount: batch.currentCount, notes: batch.notes, createdAt: batch.createdAt,
                motherPlantId: batch.motherPlant?.id, parentBatchId: batch.parentBatch?.id,
                mediumRecipeVersionId: batch.mediumRecipeVersion?.id, experimentGroupId: batch.experimentGroup?.id,
                updatedAt: batch.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("culture_batches").upsert(dtos).execute()
        for batch in pending { batch.syncStatus = .synced }
    }

    private struct BioLabExperimentDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var code: String
        var question: String
        var independentVariables: String
        var controlledVariables: String
        var outcomes: String
        var notes: String
        var startedAt: Date
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case code, question
            case independentVariables = "independent_variables"
            case controlledVariables = "controlled_variables"
            case outcomes, notes
            case startedAt = "started_at"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// Pushed before ExperimentGroup and before CultureBatches — see the
    /// top-level push-order comment for why the Programs/Versions chain
    /// moved up here too.
    private func pushBioLabExperiments(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioLabExperiment>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { experiment in
            BioLabExperimentDTO(
                id: experiment.id, workspaceId: workspaceID, code: experiment.code, question: experiment.question,
                independentVariables: experiment.independentVariables, controlledVariables: experiment.controlledVariables,
                outcomes: experiment.outcomes, notes: experiment.notes, startedAt: experiment.startedAt,
                createdAt: experiment.createdAt, updatedAt: experiment.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("bio_lab_experiments").upsert(dtos).execute()
        for experiment in pending { experiment.syncStatus = .synced }
    }

    private struct ExperimentGroupDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var experimentId: UUID
        var name: String
        var programVersionId: UUID?
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case experimentId = "experiment_id"
            case name
            case programVersionId = "program_version_id"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// Pushed after BioLabExperiment and after BioreactorProgramVersion
    /// (programVersionId), and before CultureBatches (experimentGroupId).
    private func pushExperimentGroups(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<ExperimentGroup>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { group -> ExperimentGroupDTO? in
            guard let experimentId = group.experiment?.id else { return nil }
            return ExperimentGroupDTO(
                id: group.id, workspaceId: workspaceID, experimentId: experimentId, name: group.name,
                programVersionId: group.programVersion?.id, createdAt: group.createdAt, updatedAt: group.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("experiment_groups").upsert(dtos).execute()
        for group in pending { group.syncStatus = .synced }
    }

    private struct MediumRecipeDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var name: String
        var speciesName: String
        var notes: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name
            case speciesName = "species_name"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushMediumRecipes(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<MediumRecipe>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { recipe in
            MediumRecipeDTO(
                id: recipe.id, workspaceId: workspaceID, name: recipe.name, speciesName: recipe.speciesName,
                notes: recipe.notes, createdAt: recipe.createdAt, updatedAt: recipe.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("medium_recipes").upsert(dtos).execute()
        for recipe in pending { recipe.syncStatus = .synced }
    }

    private struct MediumRecipeVersionDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var recipeId: UUID
        var versionNumber: Int
        var targetPH: Double
        var measuredPH: Double?
        var components: [MediumComponentAmount]
        var changeReason: String
        var parentVersionId: UUID?
        var notes: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case recipeId = "recipe_id"
            case versionNumber = "version_number"
            case targetPH = "target_ph"
            case measuredPH = "measured_ph"
            case components
            case changeReason = "change_reason"
            case parentVersionId = "parent_version_id"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// Versions are never edited after creation (see the model's own
    /// doc comment), so "pending" here only ever means "brand new,
    /// never pushed" — never a retroactive change to one already synced.
    /// `parentVersion` can be another version pushed in this exact same
    /// batch (e.g. creating V2 then immediately V3 from it offline) —
    /// same conditional-omission/self-healing shape as
    /// Plant.originBatchId: only sent once the parent is confirmed
    /// `.synced`, otherwise this version stays `.pendingUpdate` so a
    /// later sync call retries it.
    private func pushMediumRecipeVersions(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<MediumRecipeVersion>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { version -> MediumRecipeVersionDTO? in
            guard let recipeId = version.recipe?.id else { return nil }
            let parentResolved = version.parentVersion == nil || version.parentVersion?.syncStatus == .synced
            return MediumRecipeVersionDTO(
                id: version.id, workspaceId: workspaceID, recipeId: recipeId, versionNumber: version.versionNumber,
                targetPH: version.targetPH, measuredPH: version.measuredPH, components: version.components,
                changeReason: version.changeReason, parentVersionId: parentResolved ? version.parentVersion?.id : nil,
                notes: version.notes, createdAt: version.createdAt, updatedAt: version.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("medium_recipe_versions").upsert(dtos).execute()
        for version in pending {
            let parentResolved = version.parentVersion == nil || version.parentVersion?.syncStatus == .synced
            version.syncStatus = parentResolved ? .synced : .pendingUpdate
        }
    }

    private struct MediumBatchDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var code: String
        var recipeVersionId: UUID?
        var volumeLiters: Double
        var targetVolumeLiters: Double?
        var preparedAt: Date
        var preparedBy: String?
        var measuredPH: Double?
        var compoundLots: [MediumBatchIngredient]
        var notes: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case code
            case recipeVersionId = "recipe_version_id"
            case volumeLiters = "volume_liters"
            case targetVolumeLiters = "target_volume_liters"
            case preparedAt = "prepared_at"
            case preparedBy = "prepared_by"
            case measuredPH = "measured_ph"
            case compoundLots = "compound_lots"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushMediumBatches(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<MediumBatch>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { batch in
            MediumBatchDTO(
                id: batch.id, workspaceId: workspaceID, code: batch.code, recipeVersionId: batch.recipeVersion?.id,
                volumeLiters: batch.volumeLiters, targetVolumeLiters: batch.targetVolumeLiters, preparedAt: batch.preparedAt,
                preparedBy: batch.preparedBy, measuredPH: batch.measuredPH, compoundLots: batch.compoundLots, notes: batch.notes,
                createdAt: batch.createdAt, updatedAt: batch.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("medium_batches").upsert(dtos).execute()
        for batch in pending { batch.syncStatus = .synced }
    }

    private struct AcclimatizationBatchDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var cultureBatchId: UUID?
        var startedAt: Date
        var initialPlantletCount: Int
        var currentSurvivorCount: Int
        var substrate: String
        var humidityProgram: String
        var temperature: Double?
        var location: String
        var status: AcclimatizationStatus
        var steps: [AcclimatizationStep]
        var notes: String
        var plantsCreated: Bool
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case cultureBatchId = "culture_batch_id"
            case startedAt = "started_at"
            case initialPlantletCount = "initial_plantlet_count"
            case currentSurvivorCount = "current_survivor_count"
            case substrate
            case humidityProgram = "humidity_program"
            case temperature, location, status, steps, notes
            case plantsCreated = "plants_created"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// Pushed after CultureBatches, whose id it references.
    private func pushAcclimatizationBatches(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<AcclimatizationBatch>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { batch in
            AcclimatizationBatchDTO(
                id: batch.id, workspaceId: workspaceID, cultureBatchId: batch.cultureBatch?.id, startedAt: batch.startedAt,
                initialPlantletCount: batch.initialPlantletCount, currentSurvivorCount: batch.currentSurvivorCount,
                substrate: batch.substrate, humidityProgram: batch.humidityProgram, temperature: batch.temperature,
                location: batch.location, status: batch.status, steps: batch.steps, notes: batch.notes,
                plantsCreated: batch.plantsCreated, createdAt: batch.createdAt, updatedAt: batch.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("acclimatization_batches").upsert(dtos).execute()
        for batch in pending { batch.syncStatus = .synced }
    }

    private struct LabInventoryItemDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var name: String
        var category: LabInventoryCategory
        var currentQuantity: Int
        var minimumThreshold: Int?
        var unit: String
        var supplier: String?
        var lotNumber: String?
        var expiryDate: Date?
        var notes: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name, category
            case currentQuantity = "current_quantity"
            case minimumThreshold = "minimum_threshold"
            case unit, supplier
            case lotNumber = "lot_number"
            case expiryDate = "expiry_date"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// No foreign keys — can push anywhere, kept next to
    /// AcclimatizationBatch for Phase 7L locality.
    private func pushLabInventoryItems(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<LabInventoryItem>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { item in
            LabInventoryItemDTO(
                id: item.id, workspaceId: workspaceID, name: item.name, category: item.category,
                currentQuantity: item.currentQuantity, minimumThreshold: item.minimumThreshold, unit: item.unit,
                supplier: item.supplier, lotNumber: item.lotNumber, expiryDate: item.expiryDate, notes: item.notes,
                createdAt: item.createdAt, updatedAt: item.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("lab_inventory_items").upsert(dtos).execute()
        for item in pending { item.syncStatus = .synced }
    }

    private struct LabCompoundDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var name: String
        var shortName: String
        var category: LabCompoundCategory
        var molecularWeight: Double?
        var defaultUnit: ConcentrationUnit
        var supplier: String?
        var catalogNumber: String?
        var notes: String
        var isHidden: Bool
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name
            case shortName = "short_name"
            case category
            case molecularWeight = "molecular_weight"
            case defaultUnit = "default_unit"
            case supplier
            case catalogNumber = "catalog_number"
            case notes
            case isHidden = "is_hidden"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// No foreign keys — pushed first among the three new Smart Media
    /// tables so StockSolution/InventoryLot's compoundId always already
    /// exists remotely by the time they upsert.
    private func pushLabCompounds(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<LabCompound>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { compound in
            LabCompoundDTO(
                id: compound.id, workspaceId: workspaceID, name: compound.name, shortName: compound.shortName,
                category: compound.category, molecularWeight: compound.molecularWeight, defaultUnit: compound.defaultUnit,
                supplier: compound.supplier, catalogNumber: compound.catalogNumber, notes: compound.notes,
                isHidden: compound.isHidden, createdAt: compound.createdAt, updatedAt: compound.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("lab_compounds").upsert(dtos).execute()
        for compound in pending { compound.syncStatus = .synced }
    }

    private struct StockSolutionDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var compoundId: UUID?
        var name: String
        var concentration: Double
        var concentrationUnit: ConcentrationUnit
        var preparedVolumeLiters: Double
        var remainingVolumeLiters: Double
        var preparedAt: Date
        var expiresAt: Date?
        var storageLocation: String
        var lotNumber: String?
        var notes: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case compoundId = "compound_id"
            case name, concentration
            case concentrationUnit = "concentration_unit"
            case preparedVolumeLiters = "prepared_volume_liters"
            case remainingVolumeLiters = "remaining_volume_liters"
            case preparedAt = "prepared_at"
            case expiresAt = "expires_at"
            case storageLocation = "storage_location"
            case lotNumber = "lot_number"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushStockSolutions(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<StockSolution>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { solution in
            StockSolutionDTO(
                id: solution.id, workspaceId: workspaceID, compoundId: solution.compound?.id, name: solution.name,
                concentration: solution.concentration, concentrationUnit: solution.concentrationUnit,
                preparedVolumeLiters: solution.preparedVolumeLiters, remainingVolumeLiters: solution.remainingVolumeLiters,
                preparedAt: solution.preparedAt, expiresAt: solution.expiresAt, storageLocation: solution.storageLocation,
                lotNumber: solution.lotNumber, notes: solution.notes, createdAt: solution.createdAt,
                updatedAt: solution.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("stock_solutions").upsert(dtos).execute()
        for solution in pending { solution.syncStatus = .synced }
    }

    private struct InventoryLotDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var compoundId: UUID?
        var lotNumber: String
        var quantityReceived: Double
        var quantityRemaining: Double
        var unit: AmountUnit
        var receivedAt: Date
        var expiresAt: Date?
        var supplier: String?
        var costTotal: Double?
        var notes: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case compoundId = "compound_id"
            case lotNumber = "lot_number"
            case quantityReceived = "quantity_received"
            case quantityRemaining = "quantity_remaining"
            case unit
            case receivedAt = "received_at"
            case expiresAt = "expires_at"
            case supplier
            case costTotal = "cost_total"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushInventoryLots(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<InventoryLot>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { lot in
            InventoryLotDTO(
                id: lot.id, workspaceId: workspaceID, compoundId: lot.compound?.id, lotNumber: lot.lotNumber,
                quantityReceived: lot.quantityReceived, quantityRemaining: lot.quantityRemaining, unit: lot.unit,
                receivedAt: lot.receivedAt, expiresAt: lot.expiresAt, supplier: lot.supplier, costTotal: lot.costTotal,
                notes: lot.notes, createdAt: lot.createdAt, updatedAt: lot.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("inventory_lots").upsert(dtos).execute()
        for lot in pending { lot.syncStatus = .synced }
    }

    private struct BioLabAuditEntryDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var entityType: String
        var entityId: UUID
        var action: String
        var detail: String
        var performedBy: String?
        var occurredAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case entityType = "entity_type"
            case entityId = "entity_id"
            case action, detail
            case performedBy = "performed_by"
            case occurredAt = "occurred_at"
            case updatedAt = "updated_at"
        }
    }

    /// Append-only — never edited after creation.
    private func pushBioLabAuditEntries(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioLabAuditEntry>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { entry in
            BioLabAuditEntryDTO(
                id: entry.id, workspaceId: workspaceID, entityType: entry.entityType, entityId: entry.entityId,
                action: entry.action, detail: entry.detail, performedBy: entry.performedBy,
                occurredAt: entry.occurredAt, updatedAt: entry.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("biolab_audit_entries").upsert(dtos).execute()
        for entry in pending { entry.syncStatus = .synced }
    }

    private struct BioreactorDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var name: String
        var code: String
        var bioreactorType: BioreactorType
        var totalVolumeLiters: Double
        var workingVolumeLiters: Double
        var status: BioreactorStatus
        var componentTypes: [BioreactorComponentType]
        var location: String
        var currentBatchId: UUID?
        var activeProgramVersionId: UUID?
        var automationEnabled: Bool
        var scheduleResumedAt: Date?
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name
            case code
            case bioreactorType = "bioreactor_type"
            case totalVolumeLiters = "total_volume_liters"
            case workingVolumeLiters = "working_volume_liters"
            case status
            case componentTypes = "component_types"
            case location
            case currentBatchId = "current_batch_id"
            case activeProgramVersionId = "active_program_version_id"
            case automationEnabled = "automation_enabled"
            case scheduleResumedAt = "schedule_resumed_at"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// Pushed after culture batches and after program versions
    /// (currentBatchId/activeProgramVersionId's foreign key targets
    /// must already exist remotely).
    private func pushBioreactors(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<Bioreactor>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { bioreactor in
            BioreactorDTO(
                id: bioreactor.id, workspaceId: workspaceID, name: bioreactor.name, code: bioreactor.code,
                bioreactorType: bioreactor.bioreactorType, totalVolumeLiters: bioreactor.totalVolumeLiters,
                workingVolumeLiters: bioreactor.workingVolumeLiters, status: bioreactor.status,
                componentTypes: bioreactor.componentTypes, location: bioreactor.location,
                currentBatchId: bioreactor.currentBatch?.id, activeProgramVersionId: bioreactor.activeProgramVersion?.id,
                automationEnabled: bioreactor.automationEnabled, scheduleResumedAt: bioreactor.scheduleResumedAt,
                createdAt: bioreactor.createdAt, updatedAt: bioreactor.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("bioreactors").upsert(dtos).execute()
        for bioreactor in pending { bioreactor.syncStatus = .synced }
    }

    private struct BioreactorDeviceBindingDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var bioreactorId: UUID
        var role: BioreactorDeviceRole
        var deviceId: UUID?
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case bioreactorId = "bioreactor_id"
            case role
            case deviceId = "device_id"
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// Pushed after both bioreactors and connected devices, whose ids it
    /// references as foreign keys.
    private func pushBioreactorDeviceBindings(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioreactorDeviceBinding>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { binding -> BioreactorDeviceBindingDTO? in
            guard let bioreactorId = binding.bioreactor?.id else { return nil }
            return BioreactorDeviceBindingDTO(
                id: binding.id, workspaceId: workspaceID, bioreactorId: bioreactorId, role: binding.role,
                deviceId: binding.device?.id, createdAt: binding.createdAt, updatedAt: binding.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("bioreactor_device_bindings").upsert(dtos).execute()
        for binding in pending { binding.syncStatus = .synced }
    }

    private struct BioreactorInspectionDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var cultureBatchId: UUID?
        var bioreactorId: UUID?
        var date: Date
        var cultureAppearance: String
        var contaminationStatus: ContaminationStatus
        var hyperhydricityStatus: ObservedSeverity
        var necrosisStatus: ObservedSeverity
        var browningStatus: ObservedSeverity
        var growthStatus: String
        var estimatedCount: Int?
        var notes: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case cultureBatchId = "culture_batch_id"
            case bioreactorId = "bioreactor_id"
            case date
            case cultureAppearance = "culture_appearance"
            case contaminationStatus = "contamination_status"
            case hyperhydricityStatus = "hyperhydricity_status"
            case necrosisStatus = "necrosis_status"
            case browningStatus = "browning_status"
            case growthStatus = "growth_status"
            case estimatedCount = "estimated_count"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// Pushed after culture batches and bioreactors, whose ids it
    /// references as foreign keys.
    private func pushBioreactorInspections(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioreactorInspection>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { inspection in
            BioreactorInspectionDTO(
                id: inspection.id, workspaceId: workspaceID, cultureBatchId: inspection.cultureBatch?.id,
                bioreactorId: inspection.bioreactor?.id, date: inspection.date, cultureAppearance: inspection.cultureAppearance,
                contaminationStatus: inspection.contaminationStatus, hyperhydricityStatus: inspection.hyperhydricityStatus,
                necrosisStatus: inspection.necrosisStatus, browningStatus: inspection.browningStatus,
                growthStatus: inspection.growthStatus, estimatedCount: inspection.estimatedCount, notes: inspection.notes,
                createdAt: inspection.createdAt, updatedAt: inspection.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("bioreactor_inspections").upsert(dtos).execute()
        for inspection in pending { inspection.syncStatus = .synced }
    }

    private struct BioLabInspectionPhotoDTO: Encodable {
        var id: UUID
        var inspectionId: UUID
        var storagePath: String
        var thumbnailStoragePath: String
        var category: BioLabPhotoCategory
        var date: Date

        enum CodingKeys: String, CodingKey {
            case id
            case inspectionId = "inspection_id"
            case storagePath = "storage_path"
            case thumbnailStoragePath = "thumbnail_storage_path"
            case category, date
        }
    }

    /// Pushed after bioreactor inspections, whose id it references —
    /// same storage-path-not-inline-data shape as pushPlantPhotos.
    private func pushBioLabInspectionPhotos(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioLabInspectionPhoto>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        var dtos: [BioLabInspectionPhotoDTO] = []
        for photo in pending {
            guard let inspectionID = photo.inspection?.id else { continue }
            let path = "\(workspaceID)/biolab/\(inspectionID)/\(photo.id).jpg"
            let thumbnailPath = "\(workspaceID)/biolab/\(inspectionID)/\(photo.id)_thumb.jpg"
            try await uploadPhoto(photo.imageData, path: path)
            try await uploadPhoto(photo.thumbnailData, path: thumbnailPath)
            dtos.append(BioLabInspectionPhotoDTO(
                id: photo.id, inspectionId: inspectionID, storagePath: path,
                thumbnailStoragePath: thumbnailPath, category: photo.category, date: photo.date
            ))
        }
        guard !dtos.isEmpty else { return }
        try await AuthService.client.from("biolab_inspection_photos").upsert(dtos).execute()
        for photo in pending where photo.inspection != nil { photo.syncStatus = .synced }
    }

    private struct BioreactorMaintenanceEventDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var bioreactorId: UUID
        var date: Date
        var eventType: MaintenanceEventType
        var notes: String
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case bioreactorId = "bioreactor_id"
            case date
            case eventType = "event_type"
            case notes
            case updatedAt = "updated_at"
        }
    }

    private func pushBioreactorMaintenanceEvents(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioreactorMaintenanceEvent>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { event -> BioreactorMaintenanceEventDTO? in
            guard let bioreactorId = event.bioreactor?.id else { return nil }
            return BioreactorMaintenanceEventDTO(
                id: event.id, workspaceId: workspaceID, bioreactorId: bioreactorId, date: event.date,
                eventType: event.eventType, notes: event.notes, updatedAt: event.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("bioreactor_maintenance").upsert(dtos).execute()
        for event in pending { event.syncStatus = .synced }
    }

    private struct BioreactorProgramDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var name: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case name
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushBioreactorPrograms(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioreactorProgram>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { program in
            BioreactorProgramDTO(id: program.id, workspaceId: workspaceID, name: program.name, createdAt: program.createdAt, updatedAt: program.updatedAt ?? .now)
        }
        try await AuthService.client.from("bioreactor_programs").upsert(dtos).execute()
        for program in pending { program.syncStatus = .synced }
    }

    private struct BioreactorProgramVersionDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var programId: UUID
        var versionNumber: Int
        var immersionEnabled: Bool
        var immersionDurationSeconds: Int
        var immersionIntervalMinutes: Int
        var aerationEnabled: Bool
        var aerationDurationSeconds: Int
        var aerationIntervalMinutes: Int
        var photoperiodEnabled: Bool
        var lightStartMinutesSinceMidnight: Int?
        var lightEndMinutesSinceMidnight: Int?
        var targetTemperature: Double?
        var maxImmersionDurationSeconds: Int
        var maxAerationDurationSeconds: Int
        var notes: String
        var createdAt: Date
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case programId = "program_id"
            case versionNumber = "version_number"
            case immersionEnabled = "immersion_enabled"
            case immersionDurationSeconds = "immersion_duration_seconds"
            case immersionIntervalMinutes = "immersion_interval_minutes"
            case aerationEnabled = "aeration_enabled"
            case aerationDurationSeconds = "aeration_duration_seconds"
            case aerationIntervalMinutes = "aeration_interval_minutes"
            case photoperiodEnabled = "photoperiod_enabled"
            case lightStartMinutesSinceMidnight = "light_start_minutes"
            case lightEndMinutesSinceMidnight = "light_end_minutes"
            case targetTemperature = "target_temperature"
            case maxImmersionDurationSeconds = "max_immersion_duration_seconds"
            case maxAerationDurationSeconds = "max_aeration_duration_seconds"
            case notes
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    /// Versions are immutable once created (same discipline as
    /// MediumRecipeVersion) — "pending" only ever means "brand new."
    private func pushBioreactorProgramVersions(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioreactorProgramVersion>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { version -> BioreactorProgramVersionDTO? in
            guard let programId = version.program?.id else { return nil }
            return BioreactorProgramVersionDTO(
                id: version.id, workspaceId: workspaceID, programId: programId, versionNumber: version.versionNumber,
                immersionEnabled: version.immersionEnabled, immersionDurationSeconds: version.immersionDurationSeconds,
                immersionIntervalMinutes: version.immersionIntervalMinutes, aerationEnabled: version.aerationEnabled,
                aerationDurationSeconds: version.aerationDurationSeconds, aerationIntervalMinutes: version.aerationIntervalMinutes,
                photoperiodEnabled: version.photoperiodEnabled, lightStartMinutesSinceMidnight: version.lightStartMinutesSinceMidnight,
                lightEndMinutesSinceMidnight: version.lightEndMinutesSinceMidnight, targetTemperature: version.targetTemperature,
                maxImmersionDurationSeconds: version.maxImmersionDurationSeconds, maxAerationDurationSeconds: version.maxAerationDurationSeconds,
                notes: version.notes, createdAt: version.createdAt, updatedAt: version.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("bioreactor_program_versions").upsert(dtos).execute()
        for version in pending { version.syncStatus = .synced }
    }

    private struct BioreactorCycleExecutionDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var bioreactorId: UUID
        var programVersionId: UUID?
        var cycleType: BioreactorCycleType
        var plannedStart: Date
        var actualStart: Date?
        var actualEnd: Date?
        var expectedDurationSeconds: Int
        var actualDurationSeconds: Int?
        var status: CycleExecutionStatus
        var failureReason: String?
        var sensorSnapshotBefore: String?
        var sensorSnapshotAfter: String?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case bioreactorId = "bioreactor_id"
            case programVersionId = "program_version_id"
            case cycleType = "cycle_type"
            case plannedStart = "planned_start"
            case actualStart = "actual_start"
            case actualEnd = "actual_end"
            case expectedDurationSeconds = "expected_duration_seconds"
            case actualDurationSeconds = "actual_duration_seconds"
            case status
            case failureReason = "failure_reason"
            case sensorSnapshotBefore = "sensor_snapshot_before"
            case sensorSnapshotAfter = "sensor_snapshot_after"
            case updatedAt = "updated_at"
        }
    }

    private func pushBioreactorCycleExecutions(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioreactorCycleExecution>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { execution -> BioreactorCycleExecutionDTO? in
            guard let bioreactorId = execution.bioreactor?.id else { return nil }
            return BioreactorCycleExecutionDTO(
                id: execution.id, workspaceId: workspaceID, bioreactorId: bioreactorId, programVersionId: execution.programVersion?.id,
                cycleType: execution.cycleType, plannedStart: execution.plannedStart, actualStart: execution.actualStart,
                actualEnd: execution.actualEnd, expectedDurationSeconds: execution.expectedDurationSeconds,
                actualDurationSeconds: execution.actualDurationSeconds, status: execution.status, failureReason: execution.failureReason,
                sensorSnapshotBefore: execution.sensorSnapshotBefore, sensorSnapshotAfter: execution.sensorSnapshotAfter,
                updatedAt: execution.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("bioreactor_cycle_executions").upsert(dtos).execute()
        for execution in pending { execution.syncStatus = .synced }
    }

    private struct BioLabAlertDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var alertType: BioLabAlertType
        var priority: BioLabAlertPriority
        var message: String
        var bioreactorId: UUID?
        var cultureBatchId: UUID?
        var createdAt: Date
        var resolvedAt: Date?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case alertType = "alert_type"
            case priority
            case message
            case bioreactorId = "bioreactor_id"
            case cultureBatchId = "culture_batch_id"
            case createdAt = "created_at"
            case resolvedAt = "resolved_at"
            case updatedAt = "updated_at"
        }
    }

    private func pushBioLabAlerts(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<BioLabAlert>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { alert in
            BioLabAlertDTO(
                id: alert.id, workspaceId: workspaceID, alertType: alert.alertType, priority: alert.priority, message: alert.message,
                bioreactorId: alert.bioreactor?.id, cultureBatchId: alert.cultureBatch?.id,
                createdAt: alert.createdAt, resolvedAt: alert.resolvedAt, updatedAt: alert.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("biolab_alerts").upsert(dtos).execute()
        for alert in pending { alert.syncStatus = .synced }
    }

    private struct GardenBoundaryDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var points: [GardenCoordinate]
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case points
            case updatedAt = "updated_at"
        }
    }

    private func pushGardenBoundaries(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<GardenBoundary>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { boundary in
            GardenBoundaryDTO(
                id: boundary.id, workspaceId: workspaceID, gardenId: boundary.garden?.id,
                points: boundary.points, updatedAt: boundary.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("garden_boundaries").upsert(dtos).execute()
        for boundary in pending { boundary.syncStatus = .synced }
    }

    // MARK: - Garden objects and areas (Phase 6C)

    private struct GardenMapObjectDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var objectType: GardenObjectType
        var positionXMeters: Double
        var positionYMeters: Double
        var rotationRadians: Double
        var widthMeters: Double
        var heightMeters: Double
        var zIndex: Int
        var label: String?
        var linkedEntityId: UUID?
        var linkedEntityKind: GardenObjectLinkKind?
        var canopyDiameterMeters: Double?
        var estimatedAdultCanopyDiameterMeters: Double?
        var sprinklerRadiusMeters: Double?
        var sprinklerStartAngleDegrees: Double?
        var sprinklerEndAngleDegrees: Double?
        var sprinklerFlowRateLitersPerHour: Double?
        var structureHeightMeters: Double?
        var estimatedYearsToMaturity: Double?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case objectType = "object_type"
            case positionXMeters = "position_x_meters"
            case positionYMeters = "position_y_meters"
            case rotationRadians = "rotation_radians"
            case widthMeters = "width_meters"
            case heightMeters = "height_meters"
            case zIndex = "z_index"
            case label
            case linkedEntityId = "linked_entity_id"
            case linkedEntityKind = "linked_entity_kind"
            case canopyDiameterMeters = "canopy_diameter_meters"
            case estimatedAdultCanopyDiameterMeters = "estimated_adult_canopy_diameter_meters"
            case sprinklerRadiusMeters = "sprinkler_radius_meters"
            case sprinklerStartAngleDegrees = "sprinkler_start_angle_degrees"
            case sprinklerEndAngleDegrees = "sprinkler_end_angle_degrees"
            case sprinklerFlowRateLitersPerHour = "sprinkler_flow_rate_liters_per_hour"
            case structureHeightMeters = "structure_height_meters"
            case estimatedYearsToMaturity = "estimated_years_to_maturity"
            case updatedAt = "updated_at"
        }
    }

    private func pushGardenMapObjects(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<GardenMapObject>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { object in
            GardenMapObjectDTO(
                id: object.id, workspaceId: workspaceID, gardenId: object.garden?.id, objectType: object.objectType,
                positionXMeters: object.position.xMeters, positionYMeters: object.position.yMeters,
                rotationRadians: object.rotationRadians, widthMeters: object.widthMeters, heightMeters: object.heightMeters,
                zIndex: object.zIndex, label: object.label, linkedEntityId: object.linkedEntityId,
                linkedEntityKind: object.linkedEntityKind, canopyDiameterMeters: object.canopyDiameterMeters,
                estimatedAdultCanopyDiameterMeters: object.estimatedAdultCanopyDiameterMeters,
                sprinklerRadiusMeters: object.sprinklerRadiusMeters, sprinklerStartAngleDegrees: object.sprinklerStartAngleDegrees,
                sprinklerEndAngleDegrees: object.sprinklerEndAngleDegrees, sprinklerFlowRateLitersPerHour: object.sprinklerFlowRateLitersPerHour,
                structureHeightMeters: object.structureHeightMeters, estimatedYearsToMaturity: object.estimatedYearsToMaturity,
                updatedAt: object.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("garden_map_objects").upsert(dtos).execute()
        for object in pending { object.syncStatus = .synced }
    }

    private struct GardenAreaDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var areaType: GardenAreaType
        var name: String
        var points: [GardenCoordinate]
        var microclimateSunLevel: MicroclimateSunLevel?
        var microclimateWindLevel: MicroclimateWindLevel?
        var microclimateSoilLevel: MicroclimateSoilLevel?
        var microclimateNotes: String?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case areaType = "area_type"
            case name
            case points
            case microclimateSunLevel = "microclimate_sun_level"
            case microclimateWindLevel = "microclimate_wind_level"
            case microclimateSoilLevel = "microclimate_soil_level"
            case microclimateNotes = "microclimate_notes"
            case updatedAt = "updated_at"
        }
    }

    private func pushGardenAreas(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<GardenArea>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { area in
            GardenAreaDTO(
                id: area.id, workspaceId: workspaceID, gardenId: area.garden?.id, areaType: area.areaType,
                name: area.name, points: area.points, microclimateSunLevel: area.microclimateSunLevel,
                microclimateWindLevel: area.microclimateWindLevel, microclimateSoilLevel: area.microclimateSoilLevel,
                microclimateNotes: area.microclimateNotes, updatedAt: area.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("garden_areas").upsert(dtos).execute()
        for area in pending { area.syncStatus = .synced }
    }

    private struct IrrigationPipeDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var points: [GardenCoordinate]
        var diameterMM: Double
        var material: PipeMaterial
        var lineType: PipeLineType
        var startNodeObjectId: UUID?
        var endNodeObjectId: UUID?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case points
            case diameterMM = "diameter_mm"
            case material
            case lineType = "line_type"
            case startNodeObjectId = "start_node_object_id"
            case endNodeObjectId = "end_node_object_id"
            case updatedAt = "updated_at"
        }
    }

    private func pushIrrigationPipes(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<IrrigationPipe>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { pipe in
            IrrigationPipeDTO(
                id: pipe.id, workspaceId: workspaceID, gardenId: pipe.garden?.id, points: pipe.points,
                diameterMM: pipe.diameterMM, material: pipe.material, lineType: pipe.lineType,
                startNodeObjectId: pipe.startNodeObjectId, endNodeObjectId: pipe.endNodeObjectId, updatedAt: pipe.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("irrigation_pipes").upsert(dtos).execute()
        for pipe in pending { pipe.syncStatus = .synced }
    }

    // MARK: - Scenes

    private struct OasisSceneDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var gardenId: UUID?
        var name: String
        var icon: String
        var greenhouseId: UUID?
        var setClimateControlEnabled: Bool?
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case gardenId = "garden_id"
            case name
            case icon
            case greenhouseId = "greenhouse_id"
            case setClimateControlEnabled = "set_climate_control_enabled"
            case updatedAt = "updated_at"
        }
    }

    private func pushScenes(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<OasisScene>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { scene in
            OasisSceneDTO(
                id: scene.id, workspaceId: workspaceID, gardenId: scene.garden?.id, name: scene.name, icon: scene.icon,
                greenhouseId: scene.greenhouse?.id, setClimateControlEnabled: scene.setClimateControlEnabled,
                updatedAt: scene.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("scenes").upsert(dtos).execute()
        for scene in pending { scene.syncStatus = .synced }
    }

    private struct OasisSceneActionDTO: Encodable {
        var id: UUID
        var sceneId: UUID
        var deviceId: UUID?
        var capability: DeviceCapability
        var targetOn: Bool
        var order: Int

        enum CodingKeys: String, CodingKey {
            case id
            case sceneId = "scene_id"
            case deviceId = "device_id"
            case capability
            case targetOn = "target_on"
            case order
        }
    }

    /// Same "push every child of every parent, no per-child syncStatus"
    /// shape as pushAutomationConditions/pushAutomationActions —
    /// OasisSceneAction has no sync fields of its own either.
    private func pushSceneActions(context: ModelContext) async throws {
        let actions = try context.fetch(FetchDescriptor<OasisSceneAction>()).filter { $0.scene != nil }
        guard !actions.isEmpty else { return }
        let dtos = actions.compactMap { action -> OasisSceneActionDTO? in
            guard let sceneID = action.scene?.id else { return nil }
            return OasisSceneActionDTO(
                id: action.id, sceneId: sceneID, deviceId: action.device?.id,
                capability: action.capability, targetOn: action.targetOn, order: action.order
            )
        }
        try await AuthService.client.from("scene_actions").upsert(dtos).execute()
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
        var soilMoistureBefore: Double?
        var soilMoistureAfter: Double?
        var measuredLiters: Double?

        enum CodingKeys: String, CodingKey {
            case id
            case zoneId = "zone_id"
            case date
            case durationMinutes = "duration_minutes"
            case estimatedLiters = "estimated_liters"
            case isAutomatic = "is_automatic"
            case notes
            case soilMoistureBefore = "soil_moisture_before"
            case soilMoistureAfter = "soil_moisture_after"
            case measuredLiters = "measured_liters"
        }
    }

    private func pushIrrigationEvents(context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<IrrigationEvent>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.compactMap { event -> IrrigationEventDTO? in
            guard let zoneID = event.zone?.id else { return nil }
            return IrrigationEventDTO(
                id: event.id, zoneId: zoneID, date: event.date, durationMinutes: event.durationMinutes,
                estimatedLiters: event.estimatedLiters, isAutomatic: event.isAutomatic, notes: event.notes,
                soilMoistureBefore: event.soilMoistureBefore, soilMoistureAfter: event.soilMoistureAfter,
                measuredLiters: event.measuredLiters
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
        var showDeviceHealth: Bool
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
            case showDeviceHealth = "show_device_health"
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
                showConnectedHome: prefs.showConnectedHome, showDeviceHealth: prefs.showDeviceHealth,
                updatedAt: prefs.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("dashboard_preferences").upsert(dtos, onConflict: "workspace_id").execute()
        for prefs in pending { prefs.syncStatus = .synced }
    }

    // MARK: - Smart mode settings

    private struct SmartModeSettingsDTO: Encodable {
        var id: UUID
        var workspaceId: UUID
        var vacationModeEnabled: Bool
        var vacationStartDate: Date?
        var vacationEndDate: Date?
        var winterModeEnabled: Bool
        var waterSavingModeEnabled: Bool
        var updatedAt: Date

        enum CodingKeys: String, CodingKey {
            case id
            case workspaceId = "workspace_id"
            case vacationModeEnabled = "vacation_mode_enabled"
            case vacationStartDate = "vacation_start_date"
            case vacationEndDate = "vacation_end_date"
            case winterModeEnabled = "winter_mode_enabled"
            case waterSavingModeEnabled = "water_saving_mode_enabled"
            case updatedAt = "updated_at"
        }
    }

    /// Same upsert-on-workspace_id reasoning as pushDashboardPreferences.
    private func pushSmartModeSettings(workspaceID: UUID, context: ModelContext) async throws {
        let pending = try context.fetch(FetchDescriptor<SmartModeSettings>()).filter { $0.syncStatus != .synced }
        guard !pending.isEmpty else { return }
        let dtos = pending.map { settings in
            SmartModeSettingsDTO(
                id: settings.id, workspaceId: workspaceID, vacationModeEnabled: settings.vacationModeEnabled,
                vacationStartDate: settings.vacationStartDate, vacationEndDate: settings.vacationEndDate,
                winterModeEnabled: settings.winterModeEnabled, waterSavingModeEnabled: settings.waterSavingModeEnabled,
                updatedAt: settings.updatedAt ?? .now
            )
        }
        try await AuthService.client.from("smart_mode_settings").upsert(dtos, onConflict: "workspace_id").execute()
        for settings in pending { settings.syncStatus = .synced }
    }

    // MARK: - Pending deletions

    // ============================================================
    // Téléchargement du Digital Twin (Phase 11)
    // ============================================================

    /// Récupère les modifications faites AILLEURS sur le Digital Twin —
    /// en pratique depuis Oasis Care Pro Web, qui écrit dans ces mêmes
    /// tables.
    ///
    /// Pourquoi ceci existe : jusqu'ici la synchronisation était en
    /// écriture seule (voir la doc de cette classe), et
    /// `restoreFromCloudIfNeeded` ne s'exécute que sur un appareil
    /// vierge. Un jardin modifié sur le web ne redescendait donc jamais
    /// sur un téléphone qui contenait déjà des données — signalé à
    /// l'usage, pas en test.
    ///
    /// Périmètre volontairement restreint aux entités que le web
    /// modifie réellement (jardins, limite, zones, objets). Un moteur de
    /// fusion général sur les 54 modèles est un tout autre problème, et
    /// c'est exactement le genre de chantier qui a déjà causé une perte
    /// de données sur ce projet.
    ///
    /// RÈGLE DE FUSION — le local gagne s'il est en attente.
    /// Une ligne distante n'est appliquée que si la copie locale est
    /// `.synced`, c'est-à-dire sans modification non encore envoyée.
    /// Autrement on écraserait du travail que l'utilisateur vient de
    /// faire hors ligne et qui n'a pas encore pu partir. Dans ce cas on
    /// ne touche à rien : le push du prochain cycle enverra la version
    /// locale, et c'est elle qui fera foi.
    private func pullDigitalTwin(context: ModelContext) async throws {
        // 1. Jardins — un jardin créé sur le web doit apparaître ici.
        let remoteGardens: [GardenRow] = try await AuthService.client
            .from("gardens").select().is("deleted_at", value: nil).execute().value

        var localGardens = Dictionary(
            uniqueKeysWithValues: (try context.fetch(FetchDescriptor<Garden>())).map { ($0.id, $0) }
        )

        for row in remoteGardens {
            if let existing = localGardens[row.id] {
                guard existing.syncStatus == .synced else { continue }
                existing.name = row.name
                existing.address = row.address
                existing.notes = row.notes
                existing.latitude = row.latitude
                existing.longitude = row.longitude
                existing.locationName = row.locationName
                existing.updatedAt = row.updatedAt
                // Recalé à chaque passage : une livraison de jardin
                // (§JARDIN PRO → PARTICULIER) le fait changer d'espace
                // côté serveur, et le téléphone doit suivre plutôt que
                // de le renvoyer d'où il vient.
                existing.remoteWorkspaceID = row.workspaceId
            } else {
                let garden = Garden(
                    name: row.name, address: row.address, notes: row.notes,
                    dateCreated: row.dateCreated
                )
                garden.id = row.id
                garden.latitude = row.latitude
                garden.longitude = row.longitude
                garden.locationName = row.locationName
                garden.weatherEnabled = row.weatherEnabled
                garden.preferredMapMode = row.preferredMapMode ?? .oasisPlan
                garden.syncStatus = .synced
                garden.updatedAt = row.updatedAt
                garden.remoteWorkspaceID = row.workspaceId
                context.insert(garden)
                localGardens[row.id] = garden
            }
        }

        // 2. Limite de propriété.
        let remoteBoundaries: [GardenBoundaryRow] = try await AuthService.client
            .from("garden_boundaries").select().is("deleted_at", value: nil).execute().value
        let localBoundaries = Dictionary(
            uniqueKeysWithValues: (try context.fetch(FetchDescriptor<GardenBoundary>())).map { ($0.id, $0) }
        )
        for row in remoteBoundaries {
            let garden = row.gardenId.flatMap { localGardens[$0] }
            if let existing = localBoundaries[row.id] {
                guard existing.syncStatus == .synced else { continue }
                existing.points = row.points
                existing.updatedAt = row.updatedAt
            } else {
                let boundary = GardenBoundary(garden: garden, points: row.points)
                boundary.id = row.id
                boundary.syncStatus = .synced
                boundary.updatedAt = row.updatedAt
                context.insert(boundary)
                garden?.boundary = boundary
            }
        }

        // 3. Zones.
        let remoteAreas: [GardenAreaRow] = try await AuthService.client
            .from("garden_areas").select().is("deleted_at", value: nil).execute().value
        var localAreas = Dictionary(
            uniqueKeysWithValues: (try context.fetch(FetchDescriptor<GardenArea>())).map { ($0.id, $0) }
        )
        var seenAreaIDs: Set<UUID> = []
        for row in remoteAreas {
            seenAreaIDs.insert(row.id)
            if let existing = localAreas[row.id] {
                guard existing.syncStatus == .synced else { continue }
                existing.areaType = row.areaType
                existing.name = row.name
                existing.points = row.points
                existing.updatedAt = row.updatedAt
            } else {
                let garden = row.gardenId.flatMap { localGardens[$0] }
                let area = GardenArea(
                    garden: garden, areaType: row.areaType, name: row.name, points: row.points
                )
                area.id = row.id
                area.syncStatus = .synced
                area.updatedAt = row.updatedAt
                context.insert(area)
                localAreas[row.id] = area
            }
        }

        // 4. Objets du plan.
        let remoteObjects: [GardenMapObjectRow] = try await AuthService.client
            .from("garden_map_objects").select().is("deleted_at", value: nil).execute().value
        var localObjects = Dictionary(
            uniqueKeysWithValues: (try context.fetch(FetchDescriptor<GardenMapObject>())).map { ($0.id, $0) }
        )
        var seenObjectIDs: Set<UUID> = []
        for row in remoteObjects {
            seenObjectIDs.insert(row.id)
            if let existing = localObjects[row.id] {
                guard existing.syncStatus == .synced else { continue }
                existing.objectType = row.objectType
                existing.position = GardenCoordinate(
                    xMeters: row.positionXMeters, yMeters: row.positionYMeters
                )
                existing.rotationRadians = row.rotationRadians
                existing.widthMeters = row.widthMeters
                existing.heightMeters = row.heightMeters
                existing.zIndex = row.zIndex
                existing.label = row.label
                existing.canopyDiameterMeters = row.canopyDiameterMeters
                existing.updatedAt = row.updatedAt
            } else {
                let garden = row.gardenId.flatMap { localGardens[$0] }
                let object = GardenMapObject(
                    garden: garden, objectType: row.objectType,
                    position: GardenCoordinate(
                        xMeters: row.positionXMeters, yMeters: row.positionYMeters
                    )
                )
                object.id = row.id
                object.rotationRadians = row.rotationRadians
                object.widthMeters = row.widthMeters
                object.heightMeters = row.heightMeters
                object.zIndex = row.zIndex
                object.label = row.label
                object.linkedEntityId = row.linkedEntityId
                object.linkedEntityKind = row.linkedEntityKind
                object.canopyDiameterMeters = row.canopyDiameterMeters
                object.estimatedAdultCanopyDiameterMeters = row.estimatedAdultCanopyDiameterMeters
                object.syncStatus = .synced
                object.updatedAt = row.updatedAt
                context.insert(object)
                localObjects[row.id] = object
            }
        }

        // 5. Suppressions faites ailleurs.
        //
        // Le web supprime en douceur (`deleted_at`), pas en dur : une
        // ligne effacée pour de bon ne peut pas être distinguée d'une
        // ligne qui n'a jamais existé, donc la suppression ne pourrait
        // pas se propager jusqu'ici. Une entité locale `.synced` absente
        // du jeu distant a donc bien été supprimée ailleurs.
        //
        // Restreint aux entités `.synced` : une zone créée hors ligne et
        // pas encore poussée est forcément absente du serveur, et la
        // supprimer serait détruire le travail de l'utilisateur.
        for (id, area) in localAreas where !seenAreaIDs.contains(id) && area.syncStatus == .synced {
            context.delete(area)
        }
        for (id, object) in localObjects where !seenObjectIDs.contains(id) && object.syncStatus == .synced {
            context.delete(object)
        }
    }

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
