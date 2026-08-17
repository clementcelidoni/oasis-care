import Foundation

/// Spec §18: "Si Internet disparaît : afficher la dernière météo connue...
/// Ne pas faire planter l'application." Deliberately not synced/SwiftData
/// — this is a disposable, device-local cache of transient external
/// data, not user data worth backing up or merging across devices; each
/// device just re-fetches when it has a connection again.
enum WeatherCache {
    private static func key(for gardenID: UUID) -> String {
        "weatherCache.\(gardenID.uuidString)"
    }

    private static func fetchedAtKey(for gardenID: UUID) -> String {
        "weatherCache.fetchedAt.\(gardenID.uuidString)"
    }

    static func save(_ data: WeatherService.WeatherData, for gardenID: UUID) {
        guard let encoded = try? JSONEncoder().encode(data) else { return }
        UserDefaults.standard.set(encoded, forKey: key(for: gardenID))
        UserDefaults.standard.set(Date.now, forKey: fetchedAtKey(for: gardenID))
    }

    static func load(for gardenID: UUID) -> WeatherService.WeatherData? {
        guard let saved = UserDefaults.standard.data(forKey: key(for: gardenID)) else { return nil }
        return try? JSONDecoder().decode(WeatherService.WeatherData.self, from: saved)
    }

    /// When this garden's cached weather was actually fetched — spec
    /// §70's "ne pas halluciner" needs this alongside the data itself,
    /// since presenting a multi-day-old forecast as current would be
    /// exactly the kind of unlabeled staleness that rule warns against
    /// (see PlantAIContext.WeatherContext).
    static func fetchedAt(for gardenID: UUID) -> Date? {
        UserDefaults.standard.object(forKey: fetchedAtKey(for: gardenID)) as? Date
    }
}
