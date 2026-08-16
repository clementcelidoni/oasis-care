import SwiftUI
import SwiftData

struct RootTabView: View {
    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var notificationRouter = NotificationRouter.shared
    @ObservedObject private var deepLinkRouter = DeepLinkRouter.shared
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

                ScannerView()
                    .tabItem { Label("Scanner", systemImage: "camera.viewfinder") }

                PlanningView()
                    .tabItem { Label("Planning", systemImage: "calendar") }
            }
            .task {
                #if DEBUG
                DemoData.seedIfNeeded(context: modelContext)
                #endif
                // .onChange below only fires on a value that changes AFTER
                // this view is observing it — a cold launch via Universal
                // Link (or a tapped notification) before RootTabView ever
                // mounted, e.g. on a fresh install still showing Welcome,
                // would otherwise set pendingPlantID and have no observer
                // catch it. Checking once on appear closes that gap.
                checkPendingRoutes()
            }
            .onChange(of: notificationRouter.pendingPlantID) { _, newID in
                guard let newID else { return }
                deepLinkedPlant = findPlant(id: newID)
                notificationRouter.pendingPlantID = nil
            }
            .onChange(of: deepLinkRouter.pendingPlantID) { _, newID in
                guard let newID else { return }
                deepLinkedPlant = findPlant(id: newID)
                deepLinkRouter.pendingPlantID = nil
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

    private func checkPendingRoutes() {
        if let id = notificationRouter.pendingPlantID {
            deepLinkedPlant = findPlant(id: id)
            notificationRouter.pendingPlantID = nil
        } else if let id = deepLinkRouter.pendingPlantID {
            deepLinkedPlant = findPlant(id: id)
            deepLinkRouter.pendingPlantID = nil
        }
    }

    private func findPlant(id: UUID) -> Plant? {
        var descriptor = FetchDescriptor<Plant>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try? modelContext.fetch(descriptor).first
    }
}
