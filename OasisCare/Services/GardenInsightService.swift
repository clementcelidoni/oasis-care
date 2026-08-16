import Foundation

/// Detects things worth surfacing to the user — the dashboard's
/// "Alertes importantes" (spec §6) and the fuller version at §66-67
/// ("GardenInsightService... Priorités"). Built once here rather than
/// a throwaway version now and a "real" one later in Phase 4H: this
/// file is what 4H extends (irrigation/weather signals once those
/// exist, natural-language search) rather than replaces.
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

    /// Everything computed here comes from data the app already has
    /// locally — no network call, safe to run on every dashboard
    /// render. Capped by the caller (dashboard shows ~4-5, spec §6),
    /// not here, so other callers (a future "voir toutes les alertes")
    /// can use the full list.
    static func insights(plants: [Plant]) -> [Insight] {
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
                let lastInspection = plant.careEvents.filter { $0.type == .inspection }.map(\.date).max()
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

        return results.sorted { $0.priority > $1.priority }
    }
}
