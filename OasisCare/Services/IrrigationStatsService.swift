import Foundation

/// Spec §38: today/week/month totals, plus a month-over-month
/// comparison and the highest-consuming zone, all clearly labeled as
/// estimates (spec §36: "toujours indiquer lorsque la consommation est
/// une estimation" — the estimate itself lives in each
/// IrrigationEvent.estimatedLiters, this just aggregates it).
enum IrrigationStatsService {
    struct Stats {
        var todayLiters: Double
        var weekLiters: Double
        var monthLiters: Double
        var previousMonthLiters: Double?
        var topZone: (name: String, liters: Double)?

        var monthChangePercent: Int? {
            guard let previousMonthLiters, previousMonthLiters > 0 else { return nil }
            return Int(((monthLiters - previousMonthLiters) / previousMonthLiters * 100).rounded())
        }
    }

    static func stats(events: [IrrigationEvent]) -> Stats {
        let calendar = Calendar.current
        let now = Date.now
        let startOfDay = calendar.startOfDay(for: now)
        let startOfWeek = calendar.date(byAdding: .day, value: -7, to: now) ?? now
        let startOfMonth = calendar.date(byAdding: .day, value: -30, to: now) ?? now
        let startOfPriorMonth = calendar.date(byAdding: .day, value: -60, to: now) ?? now

        let today = sum(events, from: startOfDay)
        let week = sum(events, from: startOfWeek)
        let month = sum(events, from: startOfMonth)
        let priorMonthEvents = events.filter { $0.date >= startOfPriorMonth && $0.date < startOfMonth }
        let priorMonth = priorMonthEvents.reduce(0) { $0 + $1.estimatedLiters }

        var byZone: [String: Double] = [:]
        for event in events where event.date >= startOfMonth {
            guard let zoneName = event.zone?.name else { continue }
            byZone[zoneName, default: 0] += event.estimatedLiters
        }
        let topZone = byZone.max { $0.value < $1.value }.map { (name: $0.key, liters: $0.value) }

        return Stats(
            todayLiters: today,
            weekLiters: week,
            monthLiters: month,
            previousMonthLiters: priorMonthEvents.isEmpty ? nil : priorMonth,
            topZone: topZone
        )
    }

    private static func sum(_ events: [IrrigationEvent], from date: Date) -> Double {
        events.filter { $0.date >= date }.reduce(0) { $0 + $1.estimatedLiters }
    }
}
