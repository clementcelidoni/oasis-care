import AppIntents
import SwiftData
import Foundation

/// Spec §77 — "Quelle est l'humidité de la serre ?" Read-only: no
/// device command involved, just the linked sensor's last reading —
/// but still honestly flags staleness (spec §70's "ne pas
/// halluciner" applied to a spoken answer, not just written text) rather
/// than presenting an old value as current.
struct GreenhouseHumidityIntent: AppIntent {
    static var title: LocalizedStringResource = "Humidité de la serre"
    static var description = IntentDescription("Indique la dernière humidité mesurée dans une serre.")

    @Parameter(title: "Serre")
    var greenhouse: GreenhouseEntity

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let context = ModelContext(SharedModelContainer.shared)
        guard let realGreenhouse = try context.fetch(FetchDescriptor<Greenhouse>()).first(where: { $0.id == greenhouse.id }) else {
            return .result(dialog: "Serre introuvable.")
        }
        guard let sensor = realGreenhouse.humiditySensor, let reading = sensor.latestReading else {
            return .result(dialog: "Aucune donnée d'humidité disponible pour \(realGreenhouse.name).")
        }
        if sensor.isStale {
            return .result(dialog: "Dernière humidité connue pour \(realGreenhouse.name) : \(Int(reading.value)) %, mais cette donnée date de plus de 6 heures.")
        }
        return .result(dialog: "L'humidité de \(realGreenhouse.name) est de \(Int(reading.value)) %.")
    }
}
