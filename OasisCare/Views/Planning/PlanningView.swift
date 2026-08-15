import SwiftUI
import SwiftData

struct PlanningView: View {
    @Query private var schedules: [CareSchedule]

    private var activeSchedules: [CareSchedule] {
        schedules.filter { $0.isActive && $0.plant != nil }
    }

    private var overdue: [CareSchedule] {
        activeSchedules.filter { $0.isOverdue }
    }

    private var dueToday: [CareSchedule] {
        activeSchedules.filter { schedule in
            guard !schedule.isOverdue else { return false }
            guard let date = schedule.nextDueDate else { return true }
            return daysFromToday(date) == 0
        }
    }

    private var dueTomorrow: [CareSchedule] {
        activeSchedules.filter { schedule in
            guard !schedule.isOverdue, let date = schedule.nextDueDate else { return false }
            return daysFromToday(date) == 1
        }
    }

    private var dueThisWeek: [CareSchedule] {
        activeSchedules.filter { schedule in
            guard !schedule.isOverdue, let date = schedule.nextDueDate else { return false }
            let days = daysFromToday(date)
            return days >= 2 && days <= 6
        }
    }

    private var dueThisMonth: [CareSchedule] {
        activeSchedules.filter { schedule in
            guard !schedule.isOverdue, let date = schedule.nextDueDate else { return false }
            let days = daysFromToday(date)
            return days >= 7 && days <= 30
        }
    }

    private func daysFromToday(_ date: Date) -> Int {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: .now)
        let startOfTarget = calendar.startOfDay(for: date)
        return calendar.dateComponents([.day], from: startOfToday, to: startOfTarget).day ?? 0
    }

    var body: some View {
        NavigationStack {
            Group {
                if activeSchedules.isEmpty {
                    EmptyStateView(
                        icon: "calendar",
                        title: "Aucune intervention planifiée",
                        message: "Configurez une fréquence d'arrosage ou d'engrais depuis la fiche d'un végétal."
                    )
                } else {
                    List {
                        section("En retard", schedules: overdue)
                        section("Aujourd'hui", schedules: dueToday)
                        section("Demain", schedules: dueTomorrow)
                        section("Cette semaine", schedules: dueThisWeek)
                        section("Ce mois-ci", schedules: dueThisMonth)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Planning")
            .navigationDestination(for: Plant.self) { plant in
                PlantDetailView(plant: plant)
            }
        }
    }

    @ViewBuilder
    private func section(_ title: String, schedules: [CareSchedule]) -> some View {
        if !schedules.isEmpty {
            Section(title) {
                ForEach(schedules) { schedule in
                    if let plant = schedule.plant {
                        NavigationLink(value: plant) {
                            ScheduleRow(schedule: schedule, plant: plant)
                        }
                    }
                }
            }
        }
    }
}
