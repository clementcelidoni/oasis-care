import AppIntents

/// Spec §77 — registers the French phrases Siri/Shortcuts can match to
/// each intent. Auto-discovered by the system at launch; nothing else
/// needs to reference this type. Each phrase references at most one
/// parameter, per App Intents' own "a single phrase can only use a
/// single parameter" rule — WaterZoneIntent's duration is left unspoken
/// on purpose, it always falls back sensibly when not given.
struct OasisCareShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WaterZoneIntent(),
            phrases: [
                "Arroser \(\.$zone) avec \(.applicationName)",
                "Démarrer l'arrosage de \(\.$zone) avec \(.applicationName)"
            ],
            shortTitle: "Arroser une zone",
            systemImageName: "drop.fill"
        )
        AppShortcut(
            intent: StopIrrigationIntent(),
            phrases: [
                "Arrêter l'arrosage avec \(.applicationName)"
            ],
            shortTitle: "Arrêter l'arrosage",
            systemImageName: "stop.fill"
        )
        AppShortcut(
            intent: GreenhouseHumidityIntent(),
            phrases: [
                "Quelle est l'humidité de \(\.$greenhouse) avec \(.applicationName)"
            ],
            shortTitle: "Humidité de la serre",
            systemImageName: "humidity.fill"
        )
        AppShortcut(
            intent: ActivateSceneIntent(),
            phrases: [
                "Activer \(\.$scene) avec \(.applicationName)"
            ],
            shortTitle: "Activer une scène",
            systemImageName: "sparkles"
        )
    }
}
