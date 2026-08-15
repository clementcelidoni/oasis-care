import Foundation
import SwiftData

/// Development-only sample data so a fresh simulator install isn't empty.
/// Only inserts anything the first time (when the store has zero plants).
enum DemoData {
    static func seedIfNeeded(context: ModelContext) {
        let existingCount = (try? context.fetchCount(FetchDescriptor<Plant>())) ?? 0
        guard existingCount == 0 else { return }

        let home = Garden(name: "Ma maison")
        context.insert(home)

        let livingRoom = GardenZone(name: "Salon", garden: home)
        let terrace = GardenZone(name: "Terrasse", garden: home)
        context.insert(livingRoom)
        context.insert(terrace)

        let monstera = Plant(
            customName: "Monstera du salon",
            commonName: "Monstera deliciosa",
            scientificName: "Monstera deliciosa",
            type: .houseplant,
            isIndoor: true,
            notes: "Près de la fenêtre, lumière indirecte.",
            healthStatus: .healthy,
            garden: home,
            zone: livingRoom
        )

        let olivier = Plant(
            customName: "Olivier",
            commonName: "Olivier",
            scientificName: "Olea europaea",
            type: .tree,
            isIndoor: false,
            notes: "En pot sur la terrasse.",
            healthStatus: .healthy,
            garden: home,
            zone: terrace
        )

        let phoenix = Plant(
            customName: "Phoenix",
            commonName: "Palmier des Canaries",
            scientificName: "Phoenix canariensis",
            type: .palm,
            isIndoor: false,
            healthStatus: .monitor,
            garden: home,
            zone: terrace
        )

        let alocasia = Plant(
            customName: "Alocasia",
            commonName: "Alocasia Frydek",
            scientificName: "Alocasia micholitziana 'Frydek'",
            type: .houseplant,
            isIndoor: true,
            notes: "Aime l'humidité, à surveiller en hiver.",
            healthStatus: .attention,
            garden: home,
            zone: livingRoom
        )

        for plant in [monstera, olivier, phoenix, alocasia] {
            context.insert(plant)
        }

        let calendar = Calendar.current
        let threeDaysAgo = calendar.date(byAdding: .day, value: -3, to: .now) ?? .now
        let tenDaysAgo = calendar.date(byAdding: .day, value: -10, to: .now) ?? .now

        CareScheduleEngine.setSchedule(.watering, frequencyDays: 7, for: monstera, in: context)
        CareScheduleEngine.recordCare(.watering, for: monstera, on: threeDaysAgo, in: context)

        CareScheduleEngine.setSchedule(.watering, frequencyDays: 10, for: olivier, in: context)
        CareScheduleEngine.recordCare(.watering, for: olivier, on: tenDaysAgo, in: context)

        CareScheduleEngine.setSchedule(.watering, frequencyDays: 5, for: alocasia, in: context)
        CareScheduleEngine.setSchedule(.fertilizing, frequencyDays: 28, for: alocasia, in: context)
    }
}
