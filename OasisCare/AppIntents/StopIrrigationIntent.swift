import AppIntents
import SwiftData
import Foundation

/// Spec §77 — "Arrêter l'arrosage." No zone parameter: stops every
/// active valve at once, the same emergencyStopAll the in-app Emergency
/// Stop button already calls (spec §24) — one voice command, one
/// existing safe path, no new behavior invented for Siri specifically.
struct StopIrrigationIntent: AppIntent {
    static var title: LocalizedStringResource = "Arrêter l'arrosage"
    static var description = IntentDescription("Arrête immédiatement tout arrosage en cours, toutes zones confondues.")

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let context = ModelContext(SharedModelContainer.shared)
        let valveDevices = try context.fetch(FetchDescriptor<ConnectedDevice>()).filter { $0.hasCapability(.valve) }
        await DeviceCommandService.shared.emergencyStopAll(devices: valveDevices, context: context)
        return .result(dialog: "Arrosage arrêté.")
    }
}
