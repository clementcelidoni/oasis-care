import SwiftUI
import SwiftData

struct RootTabView: View {
    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var notificationRouter = NotificationRouter.shared
    @ObservedObject private var toastCenter = ToastCenter.shared

    @State private var deepLinkedPlant: Plant?

    var body: some View {
        ZStack {
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
            .onChange(of: notificationRouter.pendingPlantID) { _, newID in
                guard let newID else { return }
                deepLinkedPlant = findPlant(id: newID)
                notificationRouter.pendingPlantID = nil
            }
            .sheet(item: $deepLinkedPlant) { plant in
                NavigationStack {
                    PlantDetailView(plant: plant)
                }
            }

            if let toast = toastCenter.current {
                VStack {
                    Spacer()
                    ToastView(message: toast) {
                        toast.undoAction?()
                        toastCenter.current = nil
                    }
                    .padding(.bottom, 60)
                }
                .task(id: toast.id) {
                    try? await Task.sleep(for: .seconds(4))
                    if !Task.isCancelled {
                        toastCenter.current = nil
                    }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .animation(.spring(duration: 0.35), value: toastCenter.current?.id)
            }
        }
    }

    private func findPlant(id: UUID) -> Plant? {
        var descriptor = FetchDescriptor<Plant>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try? modelContext.fetch(descriptor).first
    }
}
