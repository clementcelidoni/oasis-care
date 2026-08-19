import SwiftUI
import SwiftData

struct GardenDetailView: View {
    private enum ActiveSheet: Identifiable {
        case edit
        case addZone
        case editZone(GardenZone)
        case addIrrigationZone
        case editIrrigationZone(IrrigationZone)
        case addGreenhouse
        case addPond
        case addSensor
        case sensorDetail(Sensor)
        case addScene
        case editScene(OasisScene)

        var id: String {
            switch self {
            case .edit: return "edit"
            case .addZone: return "addZone"
            case .editZone(let zone): return "editZone-\(zone.id.uuidString)"
            case .addIrrigationZone: return "addIrrigationZone"
            case .editIrrigationZone(let zone): return "editIrrigationZone-\(zone.id.uuidString)"
            case .addGreenhouse: return "addGreenhouse"
            case .addPond: return "addPond"
            case .addSensor: return "addSensor"
            case .sensorDetail(let sensor): return "sensorDetail-\(sensor.id.uuidString)"
            case .addScene: return "addScene"
            case .editScene(let scene): return "editScene-\(scene.id.uuidString)"
            }
        }
    }

    private enum ZoneDeletionTarget: Identifiable {
        case gardenZone(GardenZone)
        case irrigationZone(IrrigationZone)

        var id: String {
            switch self {
            case .gardenZone(let zone): return "gardenZone-\(zone.id.uuidString)"
            case .irrigationZone(let zone): return "irrigationZone-\(zone.id.uuidString)"
            }
        }

        var name: String {
            switch self {
            case .gardenZone(let zone): return zone.name
            case .irrigationZone(let zone): return zone.name
            }
        }

        /// Irrigation zones cascade-delete their IrrigationEvent history
        /// (unlike GardenZone, which only nullifies its plants' zone),
        /// so the warning has to say so explicitly.
        var message: String {
            switch self {
            case .gardenZone:
                return "Les végétaux de cette zone seront conservés, sans zone associée. Cette action est irréversible."
            case .irrigationZone:
                return "Les végétaux de cette zone seront conservés, sans zone associée. L'historique des cycles d'irrigation de cette zone sera définitivement supprimé."
            }
        }
    }

    private enum ViewMode: String, CaseIterable {
        case list, map

        var label: String {
            switch self {
            case .list: return "Liste"
            case .map: return "Carte"
            }
        }
    }

    var garden: Garden

    @Environment(\.modelContext) private var modelContext

    @State private var activeSheet: ActiveSheet?
    @State private var isBulkWaterSheetPresented = false
    @State private var isCheckupPresented = false
    @State private var zonePendingDeletion: ZoneDeletionTarget?
    @State private var activatingSceneID: UUID?
    @State private var viewMode: ViewMode = .list
    @State private var mapMode: GardenMapMode
    @StateObject private var mapEngine: GardenMapEngine

    init(garden: Garden) {
        self.garden = garden
        _mapMode = State(initialValue: garden.preferredMapMode)
        _mapEngine = StateObject(wrappedValue: GardenMapEngine(garden: garden))
    }

    private var plantsDueForWatering: [Plant] {
        garden.plants.filter { $0.schedule(for: .watering)?.isDue ?? false }
    }

    private var hasActiveCheckup: Bool {
        garden.checkups.contains { !$0.isComplete }
    }

    var body: some View {
        Group {
            switch viewMode {
            case .list:
                listContent
            case .map:
                mapContent
            }
        }
        .navigationTitle(garden.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Affichage", selection: $viewMode) {
                    ForEach(ViewMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 160)
            }
            if viewMode == .map {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        ForEach(GardenMapMode.allCases) { mode in
                            Button {
                                setMapMode(mode)
                            } label: {
                                Label(mode.label, systemImage: mode.icon)
                            }
                        }
                    } label: {
                        Image(systemName: mapMode.icon)
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Modifier") { activeSheet = .edit }
            }
        }
        .navigationDestination(for: Plant.self) { plant in
            PlantDetailView(plant: plant)
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .edit:
                GardenFormView(garden: garden)
            case .addZone:
                GardenZoneFormView(garden: garden, zone: nil)
            case .editZone(let zone):
                GardenZoneFormView(garden: garden, zone: zone)
            case .addIrrigationZone:
                IrrigationZoneFormView(garden: garden, zone: nil)
            case .editIrrigationZone(let zone):
                IrrigationZoneFormView(garden: garden, zone: zone)
            case .addGreenhouse:
                GreenhouseFormView(garden: garden, greenhouse: nil)
            case .addPond:
                PondFormView(garden: garden, pond: nil)
            case .addSensor:
                SensorFormSheet(garden: garden)
            case .sensorDetail(let sensor):
                SensorDetailSheet(sensor: sensor)
            case .addScene:
                SceneFormView(garden: garden, scene: nil)
            case .editScene(let scene):
                SceneFormView(garden: garden, scene: scene)
            }
        }
        .sheet(isPresented: $isBulkWaterSheetPresented) {
            PlantListView(gardenFilter: garden)
        }
        .sheet(isPresented: $isCheckupPresented) {
            GardenCheckupSheet(garden: garden)
        }
        .confirmationDialog(
            "Supprimer \(zonePendingDeletion?.name ?? "cette zone") ?",
            isPresented: Binding(
                get: { zonePendingDeletion != nil },
                set: { if !$0 { zonePendingDeletion = nil } }
            ),
            titleVisibility: .visible,
            presenting: zonePendingDeletion
        ) { target in
            Button("Supprimer", role: .destructive) {
                switch target {
                case .gardenZone(let zone): DeletionService.delete(zone, in: modelContext)
                case .irrigationZone(let zone): DeletionService.delete(zone, in: modelContext)
                }
                zonePendingDeletion = nil
            }
            Button("Annuler", role: .cancel) {
                zonePendingDeletion = nil
            }
        } message: { target in
            Text(target.message)
        }
    }

    /// Spec Phase 6A — the four map modes share one entry point;
    /// .oasisPlan is the new vector engine, the other three stay on the
    /// existing MapKit-backed GardenMapView with a different style.
    @ViewBuilder
    private var mapContent: some View {
        switch mapMode {
        case .oasisPlan:
            OasisPlanView(engine: mapEngine)
        case .standard, .satellite, .hybrid:
            GardenMapView(garden: garden, mode: mapMode)
        }
    }

    private func setMapMode(_ mode: GardenMapMode) {
        mapMode = mode
        guard garden.preferredMapMode != mode else { return }
        garden.preferredMapMode = mode
        garden.markDirty()
        try? modelContext.save()
    }

    private var listContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let address = garden.address, !address.isEmpty {
                    Label(address, systemImage: "location.fill")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if !garden.notes.isEmpty {
                    Text(garden.notes)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if !plantsDueForWatering.isEmpty {
                    quickWaterBanner
                }

                if !garden.plants.isEmpty {
                    checkupBanner
                }

                zonesSection
                irrigationSection
                greenhousesSection
                pondsSection
                scenesSection
                capteursSection
                plantsSection
            }
            .padding()
        }
    }

    private var quickWaterBanner: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(plantsDueForWatering.count) plante\(plantsDueForWatering.count > 1 ? "s" : "") à arroser")
                .font(.subheadline.weight(.medium))

            Button {
                isBulkWaterSheetPresented = true
            } label: {
                Label("Sélectionner les plantes à arroser", systemImage: "drop.fill")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .accessibilityIdentifier("selectPlantsToWaterButton")
        }
        .padding()
        .background(Color.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    /// Spec §61 — "Commencer le check-up" from within Garden.
    private var checkupBanner: some View {
        Button {
            isCheckupPresented = true
        } label: {
            Label(
                hasActiveCheckup ? "Reprendre le check-up" : "Commencer le check-up",
                systemImage: "checklist"
            )
            .font(.subheadline.weight(.medium))
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(.green)
        .accessibilityIdentifier("startGardenCheckupButton")
    }

    private var zonesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Zones")
                    .font(.headline)
                Spacer()
                Button {
                    activeSheet = .addZone
                } label: {
                    Label("Ajouter", systemImage: "plus.circle.fill")
                        .labelStyle(.iconOnly)
                }
                .accessibilityIdentifier("addZoneButton")
            }

            if garden.zones.isEmpty {
                Text("Aucune zone pour l'instant.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                let sortedZones = garden.zones.sorted { $0.name < $1.name }
                VStack(spacing: 0) {
                    ForEach(Array(sortedZones.enumerated()), id: \.element.id) { index, zone in
                        Button {
                            activeSheet = .editZone(zone)
                        } label: {
                            HStack {
                                Text(zone.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                Text("\(zone.plants.count)")
                                    .foregroundStyle(.secondary)
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(zone.name)
                        .contextMenu {
                            Button {
                                activeSheet = .editZone(zone)
                            } label: {
                                Label("Modifier", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                zonePendingDeletion = .gardenZone(zone)
                            } label: {
                                Label("Supprimer", systemImage: "trash")
                            }
                        }
                        if index < sortedZones.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private var irrigationSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Irrigation")
                    .font(.headline)
                Spacer()
                Button {
                    activeSheet = .addIrrigationZone
                } label: {
                    Label("Ajouter", systemImage: "plus.circle.fill")
                        .labelStyle(.iconOnly)
                }
                .accessibilityIdentifier("addIrrigationZoneButton")
            }

            if garden.irrigationZones.isEmpty {
                Text("Aucune zone d'irrigation pour l'instant.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                let sortedZones = garden.irrigationZones.sorted { $0.name < $1.name }
                VStack(spacing: 0) {
                    ForEach(Array(sortedZones.enumerated()), id: \.element.id) { index, zone in
                        IrrigationZoneRow(zone: zone) {
                            IrrigationController.logCycle(for: zone, in: modelContext)
                            Haptics.success()
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { activeSheet = .editIrrigationZone(zone) }
                        .contextMenu {
                            Button {
                                activeSheet = .editIrrigationZone(zone)
                            } label: {
                                Label("Modifier", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                zonePendingDeletion = .irrigationZone(zone)
                            } label: {
                                Label("Supprimer", systemImage: "trash")
                            }
                        }
                        if index < sortedZones.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private var greenhousesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Serres")
                    .font(.headline)
                Spacer()
                Button {
                    activeSheet = .addGreenhouse
                } label: {
                    Label("Ajouter", systemImage: "plus.circle")
                        .labelStyle(.iconOnly)
                }
            }
            if garden.greenhouses.isEmpty {
                Text("Aucune serre pour l'instant.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(garden.greenhouses.sorted { $0.name < $1.name }.enumerated()), id: \.element.id) { index, greenhouse in
                        NavigationLink {
                            GreenhouseDashboardView(greenhouse: greenhouse)
                        } label: {
                            HStack {
                                Image(systemName: "leaf.arrow.circlepath")
                                    .foregroundStyle(greenhouse.climateControlEnabled ? Color.green : Color.secondary)
                                Text(greenhouse.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 6)
                        }
                        if index < garden.greenhouses.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private var pondsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Bassins")
                    .font(.headline)
                Spacer()
                Button {
                    activeSheet = .addPond
                } label: {
                    Label("Ajouter", systemImage: "plus.circle")
                        .labelStyle(.iconOnly)
                }
            }
            if garden.ponds.isEmpty {
                Text("Aucun bassin pour l'instant.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(garden.ponds.sorted { $0.name < $1.name }.enumerated()), id: \.element.id) { index, pond in
                        NavigationLink {
                            PondDashboardView(pond: pond)
                        } label: {
                            HStack {
                                Image(systemName: "water.waves")
                                    .foregroundStyle((pond.lowWaterAlert || pond.uvLampDue) ? Color.orange : Color.secondary)
                                Text(pond.name)
                                    .foregroundStyle(.primary)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 6)
                        }
                        if index < garden.ponds.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    /// Spec §79-80 — tapping a scene activates it immediately (spec's
    /// own "one tap/one phrase" framing), "Modifier" opens the builder;
    /// unlike greenhouses/ponds there's no dashboard to navigate to,
    /// activating IS the primary action.
    private var scenesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Scènes")
                    .font(.headline)
                Spacer()
                Button {
                    activeSheet = .addScene
                } label: {
                    Label("Ajouter", systemImage: "plus.circle")
                        .labelStyle(.iconOnly)
                }
            }
            if garden.scenes.isEmpty {
                Text("Aucune scène pour l'instant.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(garden.scenes.sorted { $0.name < $1.name }.enumerated()), id: \.element.id) { index, scene in
                        HStack {
                            Button {
                                activateScene(scene)
                            } label: {
                                HStack {
                                    Image(systemName: scene.icon)
                                        .foregroundStyle(activatingSceneID == scene.id ? Color.secondary : Color.accentColor)
                                    Text(scene.name)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if activatingSceneID == scene.id {
                                        ProgressView()
                                    }
                                }
                                .padding(.vertical, 6)
                            }
                            .buttonStyle(.plain)
                            .disabled(activatingSceneID != nil)
                            Button("Modifier") { activeSheet = .editScene(scene) }
                                .font(.caption)
                                .buttonStyle(.borderless)
                        }
                        if index < garden.scenes.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private func activateScene(_ scene: OasisScene) {
        activatingSceneID = scene.id
        Task {
            await SceneService.activate(scene, context: modelContext)
            activatingSceneID = nil
            Haptics.success()
        }
    }

    /// Spec §57's "Capteurs" dashboard section, for readings that belong
    /// to the garden as a whole or to a zone rather than to one plant or
    /// a greenhouse/pond (those already show their own sensors in their
    /// own sections above) — reuses the same SensorSectionView that
    /// PlantDetailView already uses, so grouping/divergence-detection
    /// behaves identically everywhere in the app.
    private var gardenLevelSensors: [Sensor] {
        var seen = Set<UUID>()
        return (garden.sensors + garden.zones.flatMap(\.sensors)).filter { seen.insert($0.id).inserted }
    }

    private var capteursSection: some View {
        SensorSectionView(
            sensors: gardenLevelSensors,
            onAdd: { activeSheet = .addSensor },
            onSelect: { sensor in activeSheet = .sensorDetail(sensor) }
        )
    }

    private var plantsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Végétaux")
                .font(.headline)

            if garden.plants.isEmpty {
                Text("Aucun végétal associé à ce jardin.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                let sortedPlants = garden.plants.sorted { $0.customName < $1.customName }
                VStack(spacing: 0) {
                    ForEach(Array(sortedPlants.enumerated()), id: \.element.id) { index, plant in
                        NavigationLink(value: plant) {
                            PlantRow(plant: plant)
                        }
                        if index < sortedPlants.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }
}

private struct IrrigationZoneRow: View {
    var zone: IrrigationZone
    var onLogCycle: () -> Void

    var body: some View {
        HStack {
            Image(systemName: zone.type.icon)
                .foregroundStyle(zone.active ? Color.blue : Color.secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(zone.name)
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if zone.valveDevice != nil {
                NavigationLink("Piloter") {
                    ConnectedIrrigationZoneView(zone: zone)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            } else {
                Button("Cycle", action: onLogCycle)
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 6)
    }

    private var subtitle: String {
        let plantsWord = zone.plants.count > 1 ? "végétaux" : "végétal"
        var parts: [String] = ["\(zone.plants.count) \(plantsWord)"]
        if let flowRate = zone.flowRate {
            parts.insert("\(flowRate.formatted()) \(zone.flowRateUnit)", at: 0)
        }
        return parts.joined(separator: " · ")
    }
}
