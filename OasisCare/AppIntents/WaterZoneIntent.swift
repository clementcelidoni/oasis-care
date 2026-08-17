import AppIntents
import SwiftData
import Foundation

/// Spec §77-78 — "Arroser la zone tropicale." A voice/Shortcuts command
/// with real physical impact still goes through IrrigationController.
/// startZone → DeviceCommandService.openValve, so it inherits every
/// existing guard rail unconditionally: the 30-minute hard ceiling, the
/// "already active" refusal, the "device offline" refusal, and the full
/// audit log — there is no separate, looser path for Siri to reach a
/// valve. Also clamps here first, before even reaching that service, so
/// an unreasonable request never gets that far in the first place.
struct WaterZoneIntent: AppIntent {
    static var title: LocalizedStringResource = "Arroser une zone"
    static var description = IntentDescription("Démarre l'arrosage d'une zone connectée, dans les limites de sécurité de l'application (30 minutes maximum).")

    @Parameter(title: "Zone")
    var zone: IrrigationZoneEntity

    @Parameter(title: "Durée (minutes)")
    var durationMinutes: Int?

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let context = ModelContext(SharedModelContainer.shared)
        guard let realZone = try context.fetch(FetchDescriptor<IrrigationZone>()).first(where: { $0.id == zone.id }) else {
            return .result(dialog: "Zone introuvable.")
        }
        guard realZone.valveDevice != nil else {
            return .result(dialog: "\(realZone.name) n'a pas de vanne connectée.")
        }

        let requested = durationMinutes ?? realZone.durationMinutes ?? 8
        let clamped = max(1, min(requested, 30))
        let result = await IrrigationController.startZone(realZone, durationMinutes: clamped, context: context)

        switch result {
        case .success:
            return .result(dialog: "Arrosage de \(realZone.name) démarré pour \(clamped) minutes.")
        case .failure(let error):
            return .result(dialog: "Impossible de démarrer l'arrosage de \(realZone.name) : \(error.localizedDescription)")
        }
    }
}
