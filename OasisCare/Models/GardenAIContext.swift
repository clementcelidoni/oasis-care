import Foundation

/// What the garden-ai-assistant Edge Function knows when answering a
/// global question (spec §69: "Résumer intelligemment... Ne jamais
/// envoyer toute la base au modèle sans raison"). Built fresh per
/// question from already-computed dashboard data — never a raw dump of
/// every plant/event. Extended in Phase 4H with water/tree-inspection
/// summaries so questions like "Combien d'eau ai-je consommé ?" and
/// "Quels arbres sont à inspecter ?" (spec §68) have something to
/// answer from.
struct GardenAIContext: Encodable {
    var gardenName: String?
    var totalPlants: Int
    var healthyCount: Int
    var monitorCount: Int
    var attentionCount: Int
    var urgentCount: Int
    var todayTaskCounts: [String: Int]
    var overdueCount: Int
    var topInsights: [String]
    var recentEvents: [String]
    var weather: WeatherSummary?
    var waterTodayLiters: Double?
    var waterWeekLiters: Double?
    var waterMonthLiters: Double?
    var treesNeedingInspection: [String]?

    struct WeatherSummary: Encodable {
        var temperatureCelsius: Double?
        var condition: String?
    }

    static func build(
        gardenName: String?,
        plants: [Plant],
        todaySchedules: [CareSchedule],
        overdueCount: Int,
        insights: [GardenInsightService.Insight],
        recentEvents: [CareEvent],
        weather: WeatherSummary? = nil,
        irrigationEvents: [IrrigationEvent] = []
    ) -> GardenAIContext {
        var counts: [String: Int] = [:]
        for schedule in todaySchedules {
            counts[schedule.type.displayName, default: 0] += 1
        }

        let waterStats = IrrigationStatsService.stats(events: irrigationEvents)

        let now = Date.now
        let treesNeedingInspection = plants
            .filter { $0.type == .tree || $0.type == .palm }
            .filter { plant in
                guard let lastInspection = plant.treeInspections.map(\.date).max() else {
                    let monthsSinceAdded = Calendar.current.dateComponents([.month], from: plant.dateAdded, to: now).month ?? 0
                    return monthsSinceAdded >= 3
                }
                let months = Calendar.current.dateComponents([.month], from: lastInspection, to: now).month ?? 0
                return months >= 6
            }
            .map(\.customName)

        return GardenAIContext(
            gardenName: gardenName,
            totalPlants: plants.count,
            healthyCount: plants.filter { $0.healthStatus == .healthy }.count,
            monitorCount: plants.filter { $0.healthStatus == .monitor }.count,
            attentionCount: plants.filter { $0.healthStatus == .attention }.count,
            urgentCount: plants.filter { $0.healthStatus == .urgent }.count,
            todayTaskCounts: counts,
            overdueCount: overdueCount,
            topInsights: insights.prefix(8).map { "\($0.title) — \($0.subtitle)" },
            recentEvents: recentEvents.prefix(15).map { event in
                let plantName = event.plant?.customName ?? "?"
                return "\(DateFormatting.shortDate(event.date)) : \(plantName) — \(event.type.displayName)"
            },
            weather: weather,
            waterTodayLiters: irrigationEvents.isEmpty ? nil : waterStats.todayLiters,
            waterWeekLiters: irrigationEvents.isEmpty ? nil : waterStats.weekLiters,
            waterMonthLiters: irrigationEvents.isEmpty ? nil : waterStats.monthLiters,
            treesNeedingInspection: treesNeedingInspection.isEmpty ? nil : Array(treesNeedingInspection.prefix(10))
        )
    }
}
