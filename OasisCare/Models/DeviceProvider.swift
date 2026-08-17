import Foundation

/// Spec §9 — how a ConnectedDevice was added. Kept separate from
/// DeviceCapability (what it can do) since a single provider can carry
/// devices with any combination of capabilities.
enum DeviceProvider: String, Codable, CaseIterable, Identifiable {
    /// Includes Matter accessories — once commissioned into the user's
    /// Apple Home (via Home.app or HMHome.addAndSetupAccessories),
    /// existing HomeKit APIs work with Matter accessories exactly like
    /// native HomeKit ones. Oasis Care has no separate Matter
    /// commissioning stack of its own — see HomeKitService.
    case homeKit
    /// Reserved for a future non-HomeKit Matter integration path, if
    /// Apple ever exposes one to general third-party apps. Not used
    /// anywhere yet.
    case matter
    case manual
    case api
    case future

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .homeKit: return "HomeKit"
        case .matter: return "Matter"
        case .manual: return "Manuel"
        case .api: return "API"
        case .future: return "À venir"
        }
    }
}
