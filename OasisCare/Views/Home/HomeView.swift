import SwiftUI
import SwiftData

struct HomeView: View {
    @Query(filter: #Predicate<Plant> { !$0.isArchived }, sort: \Plant.customName)
    private var plants: [Plant]

    @Query private var schedules: [CareSchedule]

    private var dueSchedules: [CareSchedule] {
        schedules.filter { $0.isDue }
    }

    private var overdueSchedules: [CareSchedule] {
        schedules.filter { $0.isOverdue }
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

    private var toMonitorCount: Int {
        monitoredPlants.count
    }

    private var monitoredPlants: [Plant] {
        plants.filter { $0.healthStatus != .healthy }
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
                if plants.isEmpty {
                    EmptyStateView(
                        icon: "leaf",
                        title: "Aucun végétal pour l'instant",
                        message: "Ajoutez votre premier végétal depuis l'onglet Végétaux."
                    )
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 24) {
                            todaySection

                            if !overdueSchedules.isEmpty {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Interventions en retard")
                                        .font(.headline)

                                    VStack(spacing: 0) {
                                        ForEach(overdueSchedules.prefix(5)) { schedule in
                                            if let plant = schedule.plant {
                                                NavigationLink(value: plant) {
                                                    ScheduleRow(schedule: schedule, plant: plant)
                                                }
                                                .buttonStyle(.plain)
                                                Divider()
                                            }
                                        }
                                    }
                                }
                            }
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
        }
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
                    SummaryCard(title: "À surveiller", count: toMonitorCount, icon: "eye.fill", tint: .orange)
                }
                .buttonStyle(.plain)

                NavigationLink(value: PlantCategoryFilter(title: "En retard", plants: overduePlants)) {
                    SummaryCard(title: "En retard", count: overdueSchedules.count, icon: "exclamationmark.triangle.fill", tint: .red)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct PlantCategoryFilter: Hashable {
    var title: String
    var plants: [Plant]
}
