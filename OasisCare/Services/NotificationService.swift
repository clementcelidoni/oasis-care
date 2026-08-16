import Foundation
import SwiftData
import UserNotifications

/// Single entry point for local reminder notifications — mirrors
/// CareScheduleEngine's "one path in, consistent behavior" shape. Every
/// scheduling call is keyed by a stable identifier derived from the
/// CareSchedule's id, and always removes any existing pending request
/// before adding a new one, so re-scheduling never duplicates.
enum NotificationService {
    static func identifier(for schedule: CareSchedule) -> String {
        "schedule-\(schedule.id.uuidString)"
    }

    static func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    static func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Cancels any existing pending notification for this schedule, then
    /// schedules a fresh one from its current `nextDueDate` — unless
    /// notifications are off globally, the schedule itself has reminders
    /// off, it's inactive, or there's no due date yet.
    static func scheduleReminder(for schedule: CareSchedule, plant: Plant) {
        let id = identifier(for: schedule)
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])

        guard
            NotificationSettings.notificationsEnabled,
            schedule.isActive,
            schedule.reminderEnabled,
            let dueDate = schedule.nextDueDate
        else { return }

        let time = schedule.preferredTime ?? NotificationSettings.defaultReminderTimeToday()
        let calendar = Calendar.current
        let timeComponents = calendar.dateComponents([.hour, .minute], from: time)

        var fireComponents = calendar.dateComponents([.year, .month, .day], from: dueDate)
        fireComponents.hour = timeComponents.hour
        fireComponents.minute = timeComponents.minute
        guard let fireDate = calendar.date(from: fireComponents) else { return }

        let finalFireDate: Date
        if fireDate < .now {
            guard NotificationSettings.remindOverdue else { return }
            finalFireDate = nextOccurrence(ofHour: timeComponents.hour ?? NotificationSettings.defaultHour, minute: timeComponents.minute ?? NotificationSettings.defaultMinute, after: .now)
        } else {
            finalFireDate = fireDate
        }

        let content = UNMutableNotificationContent()
        content.title = "🌿 Oasis Rare Care"
        content.body = "\(plant.customName)\n\(bodyText(for: schedule.type))"
        content.sound = .default
        content.userInfo = ["plantID": plant.id.uuidString]

        let trigger = UNCalendarNotificationTrigger(
            dateMatching: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: finalFireDate),
            repeats: false
        )
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
    }

    static func cancelReminder(for schedule: CareSchedule) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier(for: schedule)])
    }

    static func cancelAll() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    /// Re-derives every active schedule's notification from scratch — used
    /// when notifications are turned on, or a setting affecting scheduling
    /// (default time, remind-overdue) changes.
    static func rescheduleAll(context: ModelContext) {
        let schedules = (try? context.fetch(FetchDescriptor<CareSchedule>())) ?? []
        for schedule in schedules {
            guard let plant = schedule.plant else { continue }
            scheduleReminder(for: schedule, plant: plant)
        }
    }

    private static func nextOccurrence(ofHour hour: Int, minute: Int, after date: Date) -> Date {
        let calendar = Calendar.current
        var components = calendar.dateComponents([.year, .month, .day], from: date)
        components.hour = hour
        components.minute = minute
        let todayAtTime = calendar.date(from: components) ?? date
        return todayAtTime > date ? todayAtTime : (calendar.date(byAdding: .day, value: 1, to: todayAtTime) ?? todayAtTime)
    }

    private static func bodyText(for type: CareEventType) -> String {
        switch type {
        case .watering: return "Arrosage prévu aujourd'hui."
        case .fertilizing: return "Engrais prévu aujourd'hui."
        case .pruning: return "Taille prévue aujourd'hui."
        case .trimming: return "Élagage prévu aujourd'hui."
        case .repotting: return "Rempotage prévu aujourd'hui."
        case .treatment: return "Traitement prévu aujourd'hui."
        case .inspection: return "Inspection prévue aujourd'hui."
        case .misting: return "Brumisation prévue aujourd'hui."
        case .cleaning: return "Nettoyage prévu aujourd'hui."
        case .rotating: return "Rotation du pot prévue aujourd'hui."
        default: return "Intervention prévue aujourd'hui."
        }
    }
}
