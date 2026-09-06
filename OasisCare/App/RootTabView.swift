import SwiftUI
import SwiftData

struct RootTabView: View {
    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var notificationRouter = NotificationRouter.shared
    @ObservedObject private var deepLinkRouter = DeepLinkRouter.shared
    @ObservedObject private var toastCenter = ToastCenter.shared

    @State private var deepLinkedPlant: Plant?
    /// § 15 — une étiquette ouverte par lien ne mène plus seulement à
    /// une plante. Elle peut désigner un lot de culture ou un rack
    /// (présents en local), ou bien un objet que cet appareil n'a pas —
    /// et dans ce dernier cas c'est le serveur qui décrit ce qu'il y a
    /// à voir. Chacun sa feuille, et surtout : plus aucun cas muet.
    @State private var deepLinkedScan: SmartTagScanResult?
    @State private var deepLinkedEtiquette: EtiquetteResolue?

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
                // Skippable so UI tests start from an empty store: the
                // demo garden alone is exactly the Free-tier limit of 1,
                // which would (correctly) lock "add a garden".
                if !UITestSupport.skipsDemoData {
                    DemoData.seedIfNeeded(context: modelContext)
                }
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
            .onChange(of: deepLinkRouter.pendingScan?.id) { _, _ in
                guard let scan = deepLinkRouter.pendingScan else { return }
                deepLinkedScan = scan
                deepLinkRouter.pendingScan = nil
            }
            .onChange(of: deepLinkRouter.pendingEtiquette?.id) { _, _ in
                guard let etiquette = deepLinkRouter.pendingEtiquette else { return }
                deepLinkedEtiquette = etiquette
                deepLinkRouter.pendingEtiquette = nil
            }
            .sheet(item: $deepLinkedPlant) { plant in
                NavigationStack {
                    PlantDetailView(plant: plant)
                }
            }
            .sheet(item: $deepLinkedScan) { scan in
                SmartTagScanResultSheet(result: scan)
            }
            .sheet(item: $deepLinkedEtiquette) { etiquette in
                EtiquetteDistanteSheet(etiquette: etiquette)
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
        } else if let scan = deepLinkRouter.pendingScan {
            // Même raison que pour la plante : un lancement à froid par
            // lien pose la valeur AVANT que cette vue n'observe quoi que
            // ce soit, et aucun `.onChange` ne la verrait passer.
            deepLinkedScan = scan
            deepLinkRouter.pendingScan = nil
        } else if let etiquette = deepLinkRouter.pendingEtiquette {
            deepLinkedEtiquette = etiquette
            deepLinkRouter.pendingEtiquette = nil
        }
    }

    private func findPlant(id: UUID) -> Plant? {
        var descriptor = FetchDescriptor<Plant>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try? modelContext.fetch(descriptor).first
    }
}
