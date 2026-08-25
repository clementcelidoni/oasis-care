import SwiftData

/// Spec §77 — extracted out of OasisCareApp so App Intents (which run
/// outside the SwiftUI view hierarchy, with no
/// `@Environment(\.modelContext)` available) can reach the exact same
/// on-disk store the main app uses, by building their own ModelContext
/// from this same container/schema instead of a second, mismatched one.
/// Swift globals are lazily initialized on first access, so this only
/// actually runs once per process either way — from the app at launch,
/// or from whichever App Intent runs first if Siri invokes one while
/// the app isn't already open.
enum SharedModelContainer {
    static let shared: ModelContainer = {
        let schema = Schema([
            Plant.self,
            Garden.self,
            GardenZone.self,
            CareEvent.self,
            CareSchedule.self,
            PlantPhoto.self,
            PendingDeletion.self,
            SpeciesProfile.self,
            AIAnalysis.self,
            DashboardPreferences.self,
            IrrigationZone.self,
            IrrigationEvent.self,
            SmartTag.self,
            PlantMeasurement.self,
            TreeInspection.self,
            GardenCheckup.self,
            GardenCheckupEntry.self,
            Sensor.self,
            SensorReading.self,
            ConnectedDevice.self,
            DeviceCommandLog.self,
            AutomationRule.self,
            AutomationCondition.self,
            AutomationAction.self,
            AutomationExecution.self,
            Greenhouse.self,
            Pond.self,
            SmartModeSettings.self,
            OasisScene.self,
            OasisSceneAction.self,
            GardenBoundary.self,
            GardenMapObject.self,
            GardenArea.self,
            IrrigationPipe.self,
            GardenPlanImage.self,
            CultureBatch.self,
            MediumRecipe.self,
            MediumRecipeVersion.self,
            MediumBatch.self,
            Bioreactor.self,
            BioreactorMaintenanceEvent.self,
            BioreactorProgram.self,
            BioreactorProgramVersion.self,
            BioreactorCycleExecution.self,
            BioLabAlert.self,
            BioreactorDeviceBinding.self,
            BioreactorInspection.self,
            BioLabInspectionPhoto.self,
            BioLabExperiment.self,
            ExperimentGroup.self,
            AcclimatizationBatch.self,
            LabInventoryItem.self,
            LabCompound.self,
            StockSolution.self,
            InventoryLot.self,
            BioLabAuditEntry.self
        ])
        let configuration = ModelConfiguration(schema: schema)

        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            fatalError("Impossible de créer le conteneur SwiftData : \(error)")
        }
    }()
}
