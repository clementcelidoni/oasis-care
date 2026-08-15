import Foundation
import SwiftData

/// Single entry point for logging care actions and maintaining their
/// recurring schedules. Every care type (watering, fertilizing, pruning, …)
/// goes through the same two steps, so behavior stays consistent as more
/// intervention types get quick actions of their own.
enum CareScheduleEngine {

    /// Logs a completed care action and, if the plant has an active
    /// schedule for that type, advances its next due date from this event's
    /// date — never from the previous target date.
    @discardableResult
    static func recordCare(
        _ type: CareEventType,
        for plant: Plant,
        on date: Date = .now,
        notes: String = "",
        quantity: Double? = nil,
        unit: String? = nil,
        product: String? = nil,
        in context: ModelContext
    ) -> CareEvent {
        let event = CareEvent(
            plant: plant,
            type: type,
            date: date,
            notes: notes,
            quantity: quantity,
            unit: unit,
            product: product
        )
        context.insert(event)
        plant.careEvents.append(event)

        if let schedule = plant.schedule(for: type) {
            schedule.lastCompletedDate = date
            schedule.nextDueDate = Calendar.current.date(byAdding: .day, value: schedule.frequencyDays, to: date)
        }

        return event
    }

    /// Creates or updates the recurring schedule for a care type. If the
    /// schedule already has a last-completed date, the due date is
    /// recalculated from it; otherwise it stays nil until the first event
    /// establishes a baseline (the schedule shows as due immediately).
    static func setSchedule(
        _ type: CareEventType,
        frequencyDays: Int,
        for plant: Plant,
        in context: ModelContext
    ) {
        if let existing = plant.schedule(for: type) {
            existing.frequencyDays = frequencyDays
            existing.isActive = true
            if let last = existing.lastCompletedDate {
                existing.nextDueDate = Calendar.current.date(byAdding: .day, value: frequencyDays, to: last)
            }
        } else {
            let schedule = CareSchedule(plant: plant, type: type, frequencyDays: frequencyDays)
            context.insert(schedule)
            plant.careSchedules.append(schedule)
        }
    }

    static func deactivateSchedule(_ type: CareEventType, for plant: Plant) {
        plant.schedule(for: type)?.isActive = false
    }
}
