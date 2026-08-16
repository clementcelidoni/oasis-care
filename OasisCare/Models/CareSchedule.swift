import Foundation
import SwiftData

/// A recurring reminder for one kind of care on one plant (e.g. "watering
/// every 7 days"). `nextDueDate` is always recomputed from the date of the
/// last real `CareEvent`, never advanced on its own — see CareScheduleEngine.
@Model
final class CareSchedule {
    var id: UUID
    var type: CareEventType
    var isActive: Bool
    var frequencyDays: Int
    var lastCompletedDate: Date?
    var nextDueDate: Date?
    var notes: String
    /// Only the hour/minute components matter; the date portion is
    /// arbitrary. Nil means "use the global default from Réglages".
    var preferredTime: Date?
    var reminderEnabled: Bool
    var plant: Plant?
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    init(
        plant: Plant?,
        type: CareEventType,
        frequencyDays: Int,
        isActive: Bool = true,
        notes: String = "",
        preferredTime: Date? = nil,
        reminderEnabled: Bool = true
    ) {
        self.id = UUID()
        self.plant = plant
        self.type = type
        self.isActive = isActive
        self.frequencyDays = frequencyDays
        self.notes = notes
        self.preferredTime = preferredTime
        self.reminderEnabled = reminderEnabled
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    /// True once this schedule needs attention: never completed yet, or its
    /// computed due date has arrived.
    var isDue: Bool {
        guard isActive else { return false }
        guard let nextDueDate else { return true }
        return nextDueDate <= .now
    }

    var isOverdue: Bool {
        guard isActive, let nextDueDate else { return false }
        return nextDueDate < Calendar.current.startOfDay(for: .now)
    }

    var status: CareStatus {
        if isOverdue { return .overdue }
        guard let nextDueDate else { return .dueToday }
        return Calendar.current.isDateInToday(nextDueDate) ? .dueToday : .upcoming
    }
}
