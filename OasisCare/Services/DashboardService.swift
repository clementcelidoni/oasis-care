import Foundation
import SwiftData

/// Pure read/aggregate computations backing the dashboard (spec §1-14).
/// Nothing here mutates data — it only summarizes what already exists,
/// so it's safe to recompute on every dashboard render.
enum DashboardService {
    static func preferences(in context: ModelContext) -> DashboardPreferences {
        if let existing = try? context.fetch(FetchDescriptor<DashboardPreferences>()).first {
            return existing
        }
        let created = DashboardPreferences()
        context.insert(created)
        return created
    }

    // MARK: - Health score

    struct HealthScore {
        var value: Int
        /// How the value breaks down, shown alongside it so the number
        /// is never presented as an unexplained fact (spec §3: "ne
        /// jamais présenter un chiffre arbitraire comme vérité
        /// scientifique").
        var explanation: String
    }

    /// 100 minus a weighted penalty for non-healthy plants and very
    /// overdue active schedules, floored at 0. Deliberately no
    /// "vs last month" delta: that would need a score history this
    /// app doesn't keep yet, and a fabricated trend is worse than none.
    static func healthScore(plants: [Plant]) -> HealthScore {
        guard !plants.isEmpty else {
            return HealthScore(value: 100, explanation: "Aucun végétal pour l'instant.")
        }
        let total = Double(plants.count)
        let monitor = Double(plants.filter { $0.healthStatus == .monitor }.count)
        let attention = Double(plants.filter { $0.healthStatus == .attention }.count)
        let urgent = Double(plants.filter { $0.healthStatus == .urgent }.count)

        let veryOverdueCount = plants.reduce(into: 0) { count, plant in
            count += plant.careSchedules.filter { $0.isActive && daysOverdue($0) >= 7 }.count
        }

        var score = 100.0
        score -= (monitor / total) * 15
        score -= (attention / total) * 30
        score -= (urgent / total) * 50
        score -= Double(min(veryOverdueCount * 2, 20))
        let rounded = max(0, min(100, Int(score.rounded())))

        let plantsWord = plants.count > 1 ? "végétaux" : "végétal"
        let explanation = "Basé sur l'état de \(plants.count) \(plantsWord) et les tâches en retard de plus de 7 jours."
        return HealthScore(value: rounded, explanation: explanation)
    }

    private static func daysOverdue(_ schedule: CareSchedule) -> Int {
        guard schedule.isOverdue, let due = schedule.nextDueDate else { return 0 }
        return Calendar.current.dateComponents([.day], from: due, to: .now).day ?? 0
    }

    // MARK: - Upcoming

    struct UpcomingItem: Identifiable {
        var id: UUID { schedule.id }
        var schedule: CareSchedule
        var plant: Plant
    }

    struct UpcomingDay: Identifiable {
        var id: Date
        var label: String
        var items: [UpcomingItem]
    }

    /// Active schedules due on a future day (today/overdue are already
    /// covered by "à faire aujourd'hui" and alerts — repeating them
    /// here would be noise), grouped and capped so the dashboard never
    /// tries to render a full planning view inline.
    static func upcoming(schedules: [CareSchedule], daysAhead: Int = 6, maxDays: Int = 3) -> [UpcomingDay] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        guard let horizon = calendar.date(byAdding: .day, value: daysAhead, to: today) else { return [] }

        var byDay: [Date: [UpcomingItem]] = [:]
        for schedule in schedules {
            guard schedule.isActive, let plant = schedule.plant, let due = schedule.nextDueDate else { continue }
            let day = calendar.startOfDay(for: due)
            guard day > today, day <= horizon else { continue }
            byDay[day, default: []].append(UpcomingItem(schedule: schedule, plant: plant))
        }

        return byDay.keys.sorted().prefix(maxDays).map { day in
            UpcomingDay(id: day, label: dayLabel(day, today: today, calendar: calendar), items: byDay[day] ?? [])
        }
    }

    private static func dayLabel(_ day: Date, today: Date, calendar: Calendar) -> String {
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: today), calendar.isDate(day, inSameDayAs: tomorrow) {
            return "Demain"
        }
        return day.formatted(.dateTime.weekday(.wide)).capitalized
    }

    // MARK: - Recent activity

    static func recentActivity(events: [CareEvent], limit: Int = 6) -> [CareEvent] {
        Array(events.sorted { $0.date > $1.date }.prefix(limit))
    }

    // MARK: - Evolution

    struct Evolution {
        var newPhotosThisWeek: Int
        var newPlantsThisWeek: Int
    }

    /// Only counts what's directly measurable (new photos, new
    /// plants). "Changements d'état" from the spec's mockup isn't
    /// included: nothing in the app records a history of health-status
    /// changes today, and inventing that count would fail the same
    /// "never an arbitrary number" rule as the health score.
    static func evolution(plants: [Plant], photos: [PlantPhoto]) -> Evolution {
        let weekAgo = Calendar.current.date(byAdding: .day, value: -7, to: .now) ?? .distantPast
        return Evolution(
            newPhotosThisWeek: photos.filter { $0.date >= weekAgo }.count,
            newPlantsThisWeek: plants.filter { $0.dateAdded >= weekAgo }.count
        )
    }
}
