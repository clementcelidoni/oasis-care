import Foundation

/// Device-local "already notified about this" memory for
/// DeviceHealthService — spec §65's "ne pas envoyer 15 notifications
/// identiques" applied across app-opens, not just within one evaluation
/// pass: without this, the exact same standing problem (e.g. an offline
/// device) would re-notify every single time HomeView.task runs, which
/// is every dashboard load. Deliberately not synced/SwiftData, same
/// reasoning as WeatherCache: disposable bookkeeping, not user data
/// worth merging across devices.
enum HealthAlertNotificationTracker {
    private static let key = "healthAlertNotificationTracker"
    private static let cooldown: TimeInterval = 24 * 3600

    private static var record: [String: Date] {
        get { (UserDefaults.standard.dictionary(forKey: key) as? [String: Date]) ?? [:] }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    static func wasRecentlyNotified(_ dedupeKey: String) -> Bool {
        guard let last = record[dedupeKey] else { return false }
        return Date.now.timeIntervalSince(last) < cooldown
    }

    static func markNotified(_ dedupeKey: String) {
        var current = record
        current[dedupeKey] = .now
        record = current
    }
}
