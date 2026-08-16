import SwiftUI
import SwiftData
import UserNotifications

@main
struct OasisCareApp: App {
    var sharedModelContainer: ModelContainer = {
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
            TreeInspection.self
        ])
        let configuration = ModelConfiguration(schema: schema)

        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            fatalError("Impossible de créer le conteneur SwiftData : \(error)")
        }
    }()

    init() {
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
    }

    var body: some Scene {
        WindowGroup {
            RootContainerView()
        }
        .modelContainer(sharedModelContainer)
    }
}
