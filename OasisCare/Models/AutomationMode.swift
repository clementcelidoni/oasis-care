import Foundation

/// Spec's "Philosophie d'automatisation" — the three levels every rule
/// operates under.
enum AutomationMode: String, Codable, CaseIterable, Identifiable, Hashable {
    /// Oasis only ever surfaces a recommendation; nothing fires without
    /// an explicit tap, every time.
    case manual
    /// Oasis prepares the action (device, duration) and asks the user
    /// to confirm before each run — no standing "fire and forget."
    case assisted
    /// Opt-in: the user has explicitly turned this rule on to run
    /// without per-run confirmation, still bounded by the rule's own
    /// limits and DeviceCommandService's hard ceiling.
    case automatic

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .manual: return "Manuel"
        case .assisted: return "Assisté"
        case .automatic: return "Automatique"
        }
    }

    var explanation: String {
        switch self {
        case .manual: return "Oasis observe et recommande. Aucune action sans vous."
        case .assisted: return "Oasis prépare l'action ; vous confirmez avant chaque exécution."
        case .automatic: return "Oasis exécute automatiquement, dans les limites que vous avez définies."
        }
    }
}
