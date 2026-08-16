import Foundation

/// App-wide notification preferences, stored via UserDefaults so both
/// SwiftUI views (`@AppStorage`, using the same keys) and plain services
/// (`NotificationService`) can read/write them without going through
/// SwiftData — these are simple scalar app settings, not per-plant data.
///
/// `notificationsEnabled` defaults to false: reminders are opt-in, enabled
/// from Réglages rather than requesting permission at first launch.
enum NotificationSettings {
    static let notificationsEnabledKey = "notificationsEnabled"
    static let defaultReminderHourKey = "defaultReminderHour"
    static let defaultReminderMinuteKey = "defaultReminderMinute"
    static let remindOverdueKey = "remindOverdue"

    static let defaultHour = 9
    static let defaultMinute = 0

    static var notificationsEnabled: Bool {
        UserDefaults.standard.bool(forKey: notificationsEnabledKey)
    }

    static var remindOverdue: Bool {
        UserDefaults.standard.object(forKey: remindOverdueKey) as? Bool ?? true
    }

    static var defaultHourValue: Int {
        UserDefaults.standard.object(forKey: defaultReminderHourKey) as? Int ?? defaultHour
    }

    static var defaultMinuteValue: Int {
        UserDefaults.standard.object(forKey: defaultReminderMinuteKey) as? Int ?? defaultMinute
    }

    /// Today's date at the global default reminder time — a seed value for
    /// a time-only DatePicker before a schedule has its own preferredTime,
    /// and the fallback NotificationService uses when a schedule doesn't
    /// override the time itself.
    static func defaultReminderTimeToday() -> Date {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: .now)
        components.hour = defaultHourValue
        components.minute = defaultMinuteValue
        return Calendar.current.date(from: components) ?? .now
    }
}
