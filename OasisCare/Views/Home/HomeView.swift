import SwiftUI
import SwiftData

struct HomeView: View {
    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var authState = AuthState.shared

    @Query(filter: #Predicate<Plant> { !$0.isArchived }, sort: \Plant.customName)
    private var allPlants: [Plant]
    @Query private var allSchedules: [CareSchedule]
    @Query private var allEvents: [CareEvent]
    @Query private var allPhotos: [PlantPhoto]
    @Query private var allIrrigationEvents: [IrrigationEvent]
    @Query private var allIrrigationZones: [IrrigationZone]
    @Query(sort: \Garden.name) private var gardens: [Garden]
    @Query private var preferencesQuery: [DashboardPreferences]

    @State private var selectedGarden: Garden?
    @State private var isOasisSheetPresented = false
    @State private var addPlantSheet: AddPlantSheet?

    private enum AddPlantSheet: Identifiable {
        case scanner, manual, addEvent
        var id: Self { self }
    }

    private var preferences: DashboardPreferences {
        preferencesQuery.first ?? DashboardPreferences()
    }

    private var plants: [Plant] {
        guard let selectedGarden else { return allPlants }
        return allPlants.filter { $0.garden?.id == selectedGarden.id }
    }

    private var schedules: [CareSchedule] {
        scoped(allSchedules) { $0.plant?.id }
    }

    private var events: [CareEvent] {
        scoped(allEvents) { $0.plant?.id }
    }

    private var photos: [PlantPhoto] {
        scoped(allPhotos) { $0.plant?.id }
    }

    private var irrigationEvents: [IrrigationEvent] {
        guard let selectedGarden else { return allIrrigationEvents }
        return allIrrigationEvents.filter { $0.zone?.garden?.id == selectedGarden.id }
    }

    private var irrigationZones: [IrrigationZone] {
        guard let selectedGarden else { return allIrrigationZones }
        return allIrrigationZones.filter { $0.garden?.id == selectedGarden.id }
    }

    private func scoped<T>(_ items: [T], plantID: (T) -> UUID?) -> [T] {
        guard selectedGarden != nil else { return items }
        let ids = Set(plants.map(\.id))
        return items.filter { plantID($0).map(ids.contains) ?? false }
    }

    /// When viewing "Tous mes jardins", the weather card still needs
    /// one garden to represent — the first one actually configured for
    /// weather, matching the mockup's single "☀️ Jardin Maison" card.
    private var weatherGarden: Garden? {
        selectedGarden ?? gardens.first { $0.weatherEnabled && $0.hasLocation }
    }

    private var dueSchedules: [CareSchedule] { schedules.filter { $0.isDue } }
    private var overdueSchedules: [CareSchedule] { schedules.filter { $0.isOverdue } }
    private var monitoredPlants: [Plant] { plants.filter { $0.healthStatus != .healthy } }
    private var insights: [GardenInsightService.Insight] {
        GardenInsightService.insights(plants: plants, irrigationZones: irrigationZones)
    }

    private func dueCount(for type: CareEventType) -> Int {
        dueSchedules.filter { $0.type == type }.count
    }

    private func plants(dueFor type: CareEventType) -> [Plant] {
        let plantIDs = Set(dueSchedules.filter { $0.type == type }.compactMap { $0.plant?.id })
        return plants.filter { plantIDs.contains($0.id) }
    }

    private var categoriesWithDue: [CareEventType] {
        CareEventType.schedulable.filter { dueCount(for: $0) > 0 }
    }

    private var overduePlants: [Plant] {
        let plantIDs = Set(overdueSchedules.compactMap { $0.plant?.id })
        return plants.filter { plantIDs.contains($0.id) }
    }

    private func tint(for type: CareEventType) -> Color {
        switch type {
        case .watering: return .blue
        case .fertilizing: return .green
        case .pruning, .trimming: return .indigo
        case .treatment: return .red
        case .inspection: return .purple
        case .repotting: return .brown
        case .misting: return .teal
        case .cleaning: return .mint
        case .rotating: return .orange
        default: return .accentColor
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if allPlants.isEmpty {
                    EmptyStateView(
                        icon: "leaf",
                        title: "Aucun végétal pour l'instant",
                        message: "Ajoutez votre premier végétal depuis l'onglet Végétaux."
                    )
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            header

                            if preferences.showHealth {
                                GlobalSummaryCard(plants: plants)
                                HealthScoreCard(score: DashboardService.healthScore(plants: plants))
                            }

                            if preferences.showToday {
                                todaySection
                                bulkActionsSection
                            }

                            if preferences.showAlerts && !insights.isEmpty {
                                AlertsCard(insights: insights)
                            }

                            if preferences.showWeather {
                                WeatherCard(garden: weatherGarden, plants: plants)
                            }

                            let frequencySuggestions = SmartWateringService.frequencySuggestions(plants: plants)
                            if !frequencySuggestions.isEmpty {
                                FrequencySuggestionCard(suggestions: frequencySuggestions) { suggestion in
                                    CareScheduleEngine.setSchedule(
                                        .watering,
                                        frequencyDays: suggestion.actualAverageDays,
                                        for: suggestion.plant,
                                        in: modelContext
                                    )
                                    Haptics.success()
                                }
                            }

                            if preferences.showUpcoming {
                                let upcoming = DashboardService.upcoming(schedules: schedules)
                                if !upcoming.isEmpty {
                                    UpcomingCard(days: upcoming)
                                }
                            }

                            if preferences.showRecentActivity {
                                let recent = DashboardService.recentActivity(events: events)
                                if !recent.isEmpty {
                                    RecentActivityCard(events: recent)
                                }
                            }

                            if preferences.showWater {
                                WaterCard(events: irrigationEvents)
                            }

                            if preferences.showEvolution {
                                EvolutionCard(evolution: DashboardService.evolution(plants: plants, photos: photos))
                            }

                            if preferences.showOasisAI {
                                OasisAICard(
                                    insights: insights,
                                    todayTaskCount: dueSchedules.count
                                ) {
                                    isOasisSheetPresented = true
                                }
                            }

                            QuickActionsGrid(
                                onAddPlant: { addPlantSheet = .manual },
                                onScan: { addPlantSheet = .scanner },
                                onBulkWater: { performBulkCare(.watering) },
                                onAddIntervention: { addPlantSheet = .addEvent }
                            )
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Oasis Care")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gearshape.fill")
                    }
                    .accessibilityIdentifier("settingsButton")
                }
            }
            .navigationDestination(for: Plant.self) { plant in
                PlantDetailView(plant: plant)
            }
            .navigationDestination(for: PlantCategoryFilter.self) { filter in
                List(filter.plants) { plant in
                    NavigationLink(value: plant) {
                        PlantRow(plant: plant)
                    }
                }
                .listStyle(.plain)
                .navigationTitle(filter.title)
                .navigationBarTitleDisplayMode(.inline)
            }
            .navigationDestination(for: AllInsightsRoute.self) { _ in
                List(insights) { insight in
                    InsightRow(insight: insight)
                }
                .listStyle(.plain)
                .navigationTitle("Alertes")
                .navigationBarTitleDisplayMode(.inline)
            }
            .sheet(isPresented: $isOasisSheetPresented) {
                OasisAssistantSheet(
                    context: GardenAIContext.build(
                        gardenName: selectedGarden?.name,
                        plants: plants,
                        todaySchedules: dueSchedules,
                        overdueCount: overdueSchedules.count,
                        insights: insights,
                        recentEvents: DashboardService.recentActivity(events: events, limit: 15),
                        irrigationEvents: irrigationEvents
                    )
                )
            }
            .sheet(item: $addPlantSheet) { sheet in
                switch sheet {
                case .scanner:
                    ScannerView()
                case .manual:
                    PlantFormView(plant: nil)
                case .addEvent:
                    AddCareEventSheet(plants: plants)
                }
            }
            .task {
                _ = DashboardService.preferences(in: modelContext)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(greeting)
                        .font(.title2.weight(.semibold))
                    Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)).capitalized)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            Menu {
                Button("Tous mes jardins") { selectedGarden = nil }
                if !gardens.isEmpty {
                    Divider()
                    ForEach(gardens) { garden in
                        Button(garden.name) { selectedGarden = garden }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(selectedGarden?.name ?? "Tous mes jardins")
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.accentColor)
            }
        }
    }

    private var greeting: String {
        if let name = greetingName {
            return "Bonjour \(name) 🌿"
        }
        return "Bonjour 🌿"
    }

    private var greetingName: String? {
        guard case .authenticated = authState.status, let email = authState.session?.user.email else { return nil }
        let localPart = email.split(separator: "@").first.map(String.init) ?? email
        let namePart = localPart.split(separator: ".").first.map(String.init) ?? localPart
        guard let first = namePart.first else { return nil }
        return String(first).uppercased() + String(namePart.dropFirst())
    }

    private var todaySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Aujourd'hui")
                .font(.headline)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                ForEach(categoriesWithDue) { type in
                    NavigationLink(value: PlantCategoryFilter(title: type.displayName, plants: plants(dueFor: type))) {
                        SummaryCard(title: type.displayName, count: dueCount(for: type), icon: type.icon, tint: tint(for: type))
                    }
                    .buttonStyle(.plain)
                }

                NavigationLink(value: PlantCategoryFilter(title: "À surveiller", plants: monitoredPlants)) {
                    SummaryCard(title: "À surveiller", count: monitoredPlants.count, icon: "eye.fill", tint: .orange)
                }
                .buttonStyle(.plain)

                NavigationLink(value: PlantCategoryFilter(title: "En retard", plants: overduePlants)) {
                    SummaryCard(title: "En retard", count: overdueSchedules.count, icon: "exclamationmark.triangle.fill", tint: .red)
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Spec §5: group action directly from the dashboard, reusing
    /// CareScheduleEngine — the same engine PlantListView's bulk
    /// actions use, not a second implementation of the same logic.
    @ViewBuilder
    private var bulkActionsSection: some View {
        let bulkable: [CareEventType] = [.watering, .fertilizing]
        let rows = bulkable.filter { dueCount(for: $0) > 0 }
        if !rows.isEmpty {
            VStack(spacing: 8) {
                ForEach(rows) { type in
                    BulkActionRow(type: type, count: dueCount(for: type)) {
                        performBulkCare(type)
                    }
                }
            }
        }
    }

    private func performBulkCare(_ type: CareEventType) {
        let targets = plants(dueFor: type)
        guard !targets.isEmpty else { return }
        let result = CareScheduleEngine.recordCareForMultiple(type, plants: targets, in: modelContext)
        Haptics.success()
        let count = targets.count
        ToastCenter.shared.show(
            title: "✓ \(count) plante\(count > 1 ? "s" : "") — \(type.displayName.lowercased())",
            undoAction: result.undo
        )
    }
}

struct PlantCategoryFilter: Hashable {
    var title: String
    var plants: [Plant]
}

struct AllInsightsRoute: Hashable {}
