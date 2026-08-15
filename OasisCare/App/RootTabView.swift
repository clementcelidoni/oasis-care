import SwiftUI
import SwiftData

struct RootTabView: View {
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Accueil", systemImage: "house.fill") }

            PlantListView()
                .tabItem { Label("Végétaux", systemImage: "leaf.fill") }

            GardenListView()
                .tabItem { Label("Jardins", systemImage: "map.fill") }

            ScannerPlaceholderView()
                .tabItem { Label("Scanner", systemImage: "camera.viewfinder") }

            PlanningView()
                .tabItem { Label("Planning", systemImage: "calendar") }
        }
        .task {
            #if DEBUG
            DemoData.seedIfNeeded(context: modelContext)
            #endif
        }
    }
}
