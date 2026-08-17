import AppIntents
import SwiftData
import Foundation

/// Spec §77/§79 — "Activer la scène Serre nuit." Runs the exact same
/// SceneService.activate every in-app scene tap calls.
struct ActivateSceneIntent: AppIntent {
    static var title: LocalizedStringResource = "Activer une scène"
    static var description = IntentDescription("Active une scène Oasis Care — une combinaison enregistrée de réglages d'équipements.")

    @Parameter(title: "Scène")
    var scene: OasisSceneEntity

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let context = ModelContext(SharedModelContainer.shared)
        guard let realScene = try context.fetch(FetchDescriptor<OasisScene>()).first(where: { $0.id == scene.id }) else {
            return .result(dialog: "Scène introuvable.")
        }
        await SceneService.activate(realScene, context: context)
        return .result(dialog: "Scène \(realScene.name) activée.")
    }
}
