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

    private var toMonitorCount: Int {
        plants.filter { $0.healthStatus != .healthy }.count
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
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                                SummaryCard(title: "Arrosage", count: dueCount(for: .watering), icon: "drop.fill", tint: .blue)
                                SummaryCard(title: "Engrais", count: dueCount(for: .fertilizing), icon: "sparkles", tint: .green)
                                SummaryCard(title: "À surveiller", count: toMonitorCount, icon: "eye.fill", tint: .orange)
                                SummaryCard(title: "En retard", count: overdueSchedules.count, icon: "exclamationmark.triangle.fill", tint: .red)
                            }

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
            .navigationDestination(for: Plant.self) { plant in
                PlantDetailView(plant: plant)
            }
        }
    }
}
