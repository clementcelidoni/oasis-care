import SwiftUI
import SwiftData

@main
struct OasisCareApp: App {
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            Plant.self,
            Garden.self,
            GardenZone.self,
            CareEvent.self,
            CareSchedule.self
        ])
        let configuration = ModelConfiguration(schema: schema)

        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            fatalError("Impossible de créer le conteneur SwiftData : \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            RootTabView()
        }
        .modelContainer(sharedModelContainer)
    }
}
