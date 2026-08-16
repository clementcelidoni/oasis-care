import Foundation

/// Detects things worth surfacing to the user — the dashboard's
/// "Alertes importantes" (spec §6) and the fuller version at §66-67
/// ("GardenInsightService... Priorités"). Built once in Phase 4A rather
/// than a throwaway version then a "real" one later: this is that
/// "real" version now, extended (not replaced) with the irrigation and
/// real-tree-inspection signals that only exist as of Phase 4D/4F.
enum GardenInsightService {
    enum Priority: Int, Comparable {
        case info, upcoming, important, urgent

        static func < (lhs: Priority, rhs: Priority) -> Bool { lhs.rawValue < rhs.rawValue }

        var displayName: String {
            switch self {
            case .info: return "Info"
            case .upcoming: return "À prévoir"
            case .important: return "Important"
            case .urgent: return "Urgent"
            }
        }
    }

    struct Insight: Identifiable {
        var id = UUID()
        var icon: String
        var title: String
        var subtitle: String
        var priority: Priority
        var plant: Plant?
    }

    private static let overdueImportantThreshold = 3
    private static let overdueUrgentThreshold = 10
    private static let uninspectedMonthsThreshold = 6
    private static let neverInspectedMonthsThreshold = 3
    /// Spec §66's own example ("3 végétaux d'une même zone") — three or
    /// more, since one or two struggling neighbors is common enough to
    /// not be worth an alert on its own (spec §67: "éviter les alertes
    /// excessives").
    private static let zoneClusterMinimumCount = 3
    private static let waterAnomalyMinimumHistoryDays = 14
    /// "Anormalement élevée" (spec §66) — 50% above the zone's own
    /// recent-week average, not an absolute number, since a fair
    /// baseline differs zone to zone.
    private static let waterAnomalyRatioThreshold = 1.5

    /// Everything computed here comes from data the app already has
    /// locally — no network call, safe to run on every dashboard
    /// render. Capped by the caller (dashboard shows ~4-5, spec §6),
    /// not here, so other callers (a future "voir toutes les alertes")
    /// can use the full list. `irrigationZones` defaults to empty for
    /// callers that don't have irrigation data in scope (e.g. a single
    /// plant's own insights) — the water-anomaly check simply produces
    /// nothing in that case, everything else still runs.
    static func insights(plants: [Plant], irrigationZones: [IrrigationZone] = []) -> [Insight] {
        var results: [Insight] = []
        let now = Date()

        for plant in plants {
            for schedule in plant.careSchedules where schedule.isActive {
                guard schedule.isOverdue, let due = schedule.nextDueDate else { continue }
                let days = Calendar.current.dateComponents([.day], from: due, to: now).day ?? 0
                if days >= overdueUrgentThreshold {
                    results.append(Insight(
                        icon: schedule.type.icon,
                        title: plant.customName,
                        subtitle: "\(schedule.type.displayName) en retard de \(days) jours",
                        priority: .urgent,
                        plant: plant
                    ))
                } else if days >= overdueImportantThreshold {
                    results.append(Insight(
                        icon: schedule.type.icon,
                        title: plant.customName,
                        subtitle: "\(schedule.type.displayName) en retard de \(days) jours",
                        priority: .important,
                        plant: plant
                    ))
                }
            }

            switch plant.healthStatus {
            case .urgent:
                results.append(Insight(icon: "exclamationmark.triangle.fill", title: plant.customName, subtitle: "État urgent signalé", priority: .urgent, plant: plant))
            case .attention:
                results.append(Insight(icon: "exclamationmark.circle.fill", title: plant.customName, subtitle: "À surveiller de près", priority: .important, plant: plant))
            case .monitor, .healthy:
                break
            }

            if plant.type == .tree || plant.type == .palm {
                let lastInspection = plant.treeInspections.map(\.date).max()
                if let lastInspection {
                    let months = Calendar.current.dateComponents([.month], from: lastInspection, to: now).month ?? 0
                    if months >= uninspectedMonthsThreshold {
                        results.append(Insight(icon: "eye.slash", title: plant.customName, subtitle: "Aucune inspection depuis \(months) mois", priority: .important, plant: plant))
                    }
                } else {
                    let monthsSinceAdded = Calendar.current.dateComponents([.month], from: plant.dateAdded, to: now).month ?? 0
                    if monthsSinceAdded >= neverInspectedMonthsThreshold {
                        results.append(Insight(icon: "eye.slash", title: plant.customName, subtitle: "Jamais inspecté", priority: .upcoming, plant: plant))
                    }
                }
            }
        }

        results.append(contentsOf: zoneClusterInsights(plants: plants))
        results.append(contentsOf: waterAnomalyInsights(zones: irrigationZones))

        return results.sorted { $0.priority > $1.priority }
    }

    /// Spec §66: "3 végétaux d'une même zone présentent un problème
    /// similaire" — one insight per struggling zone, not one per plant,
    /// so a real cluster reads as a single actionable signal rather
    /// than flooding the list.
    private static func zoneClusterInsights(plants: [Plant]) -> [Insight] {
        let byZone = Dictionary(grouping: plants.filter { $0.healthStatus != .healthy }) { $0.zone?.id }
        var results: [Insight] = []
        for (zoneID, strugglingPlants) in byZone {
            guard zoneID != nil, strugglingPlants.count >= zoneClusterMinimumCount,
                  let zoneName = strugglingPlants.first?.zone?.name else { continue }
            results.append(Insight(
                icon: "exclamationmark.triangle.fill",
                title: "Zone \(zoneName)",
                subtitle: "\(strugglingPlants.count) végétaux présentent un problème similaire",
                priority: .important,
                plant: nil
            ))
        }
        return results
    }

    /// Spec §66: "Consommation d'eau Zone 2 anormalement élevée" —
    /// compares each zone's last 7 days against the 7 days before that,
    /// mirroring IrrigationStatsService's own week-over-week logic.
    private static func waterAnomalyInsights(zones: [IrrigationZone]) -> [Insight] {
        let now = Date.now
        let calendar = Calendar.current
        guard let weekAgo = calendar.date(byAdding: .day, value: -7, to: now),
              let twoWeeksAgo = calendar.date(byAdding: .day, value: -14, to: now) else { return [] }

        var results: [Insight] = []
        for zone in zones {
            let oldestEventDate = zone.events.map(\.date).min() ?? now
            guard now.timeIntervalSince(oldestEventDate) >= Double(waterAnomalyMinimumHistoryDays * 24 * 60 * 60) else { continue }

            let recentLiters = zone.events.filter { $0.date >= weekAgo }.reduce(0) { $0 + $1.estimatedLiters }
            let priorLiters = zone.events.filter { $0.date >= twoWeeksAgo && $0.date < weekAgo }.reduce(0) { $0 + $1.estimatedLiters }
            guard priorLiters > 0, recentLiters / priorLiters >= waterAnomalyRatioThreshold else { continue }

            results.append(Insight(
                icon: "drop.triangle.fill",
                title: "Zone \(zone.name)",
                subtitle: "Consommation d'eau anormalement élevée cette semaine",
                priority: .important,
                plant: nil
            ))
        }
        return results
    }
}
