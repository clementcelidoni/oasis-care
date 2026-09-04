import Foundation

/// Device-local memory of "I looked at this watering suggestion and I'm
/// keeping my setting."
///
/// WHY THIS EXISTS. The dashboard offered two buttons — "Passer à N j"
/// and "Garder N j" — and the second had an EMPTY action closure
/// (DashboardCards.swift, before this file). It rendered, it was
/// tappable, and it did nothing: the only way out of the suggestion was
/// to accept it. A refusal that leaves no trace isn't a refusal, it's a
/// dead control.
///
/// WHAT THE KEY IS, AND WHY. Plant plus the CONFIGURED frequency —
/// deliberately NOT the suggested one. "Keep my 7 days" means a decision
/// about the setting, not about one particular computed average. Keying
/// on the suggestion would let the card come back the moment the average
/// drifts from 5 to 4 days, which is the same nagging in a new costume.
/// Change the schedule yourself and the key changes: suggestions resume,
/// because you have re-engaged with the setting and a fresh opinion is
/// welcome again.
///
/// Deliberately not synced/SwiftData, same reasoning as WeatherCache and
/// HealthAlertNotificationTracker: disposable bookkeeping about what this
/// device has already shown, not garden data worth merging across
/// devices. The cost of being wrong is one extra suggestion on an iPad.
enum WateringSuggestionDismissals {
    private static let key = "wateringSuggestionDismissals"

    private static var record: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: key) ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: key) }
    }

    static func identifier(plantID: UUID, configuredDays: Int) -> String {
        "\(plantID.uuidString)#\(configuredDays)"
    }

    static func isDismissed(plantID: UUID, configuredDays: Int) -> Bool {
        record.contains(identifier(plantID: plantID, configuredDays: configuredDays))
    }

    static func dismiss(plantID: UUID, configuredDays: Int) {
        record.insert(identifier(plantID: plantID, configuredDays: configuredDays))
    }

    /// Called when the user changes a watering schedule on purpose — by
    /// accepting a suggestion or by editing the plant. The old decision
    /// was about the old setting and no longer says anything.
    static func forget(plantID: UUID, configuredDays: Int) {
        var current = record
        current.remove(identifier(plantID: plantID, configuredDays: configuredDays))
        record = current
    }
}
