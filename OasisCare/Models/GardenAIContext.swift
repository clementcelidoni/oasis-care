import Foundation

/// What the garden-ai-assistant Edge Function knows when answering a
/// global question (spec §69: "Résumer intelligemment... Ne jamais
/// envoyer toute la base au modèle sans raison"). Built fresh per
/// question from already-computed dashboard data — never a raw dump of
/// every plant/event.
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
        weather: WeatherSummary? = nil
    ) -> GardenAIContext {
        var counts: [String: Int] = [:]
        for schedule in todaySchedules {
            counts[schedule.type.displayName, default: 0] += 1
        }

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
            weather: weather
        )
    }
}
