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
        photoData: Data? = nil,
        in context: ModelContext
    ) -> CareEvent {
        let processedPhotoData = photoData.flatMap { ImageProcessing.prepareForStorage($0)?.detailData } ?? photoData
        let event = CareEvent(
            plant: plant,
            type: type,
            date: date,
            notes: notes,
            quantity: quantity,
            unit: unit,
            product: product,
            photoData: processedPhotoData
        )
        context.insert(event)
        plant.careEvents.append(event)

        if let schedule = plant.schedule(for: type) {
            schedule.lastCompletedDate = date
            schedule.nextDueDate = Calendar.current.date(byAdding: .day, value: schedule.frequencyDays, to: date)
            schedule.markDirty()
            NotificationService.scheduleReminder(for: schedule, plant: plant)
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
        preferredTime: Date? = nil,
        reminderEnabled: Bool = true,
        for plant: Plant,
        in context: ModelContext
    ) {
        let schedule: CareSchedule
        if let existing = plant.schedule(for: type) {
            existing.frequencyDays = frequencyDays
            existing.isActive = true
            existing.preferredTime = preferredTime
            existing.reminderEnabled = reminderEnabled
            if let last = existing.lastCompletedDate {
                existing.nextDueDate = Calendar.current.date(byAdding: .day, value: frequencyDays, to: last)
            }
            existing.markDirty()
            schedule = existing
        } else {
            let newSchedule = CareSchedule(
                plant: plant,
                type: type,
                frequencyDays: frequencyDays,
                preferredTime: preferredTime,
                reminderEnabled: reminderEnabled
            )
            context.insert(newSchedule)
            plant.careSchedules.append(newSchedule)
            schedule = newSchedule
        }
        NotificationService.scheduleReminder(for: schedule, plant: plant)
    }

    struct BulkCareResult {
        var events: [CareEvent]
        var undo: () -> Void
    }

    /// Records the same care type for several plants, each getting its own
    /// CareEvent and its own schedule recalculation — never one shared event
    /// across plants, so per-plant history stays accurate. Returns an undo
    /// closure that deletes the created events and restores every touched
    /// schedule's prior lastCompletedDate/nextDueDate.
    @discardableResult
    static func recordCareForMultiple(
        _ type: CareEventType,
        plants: [Plant],
        on date: Date = .now,
        in context: ModelContext
    ) -> BulkCareResult {
        struct PriorScheduleState {
            var schedule: CareSchedule
            var lastCompletedDate: Date?
            var nextDueDate: Date?
        }

        var priorStates: [PriorScheduleState] = []
        var createdEvents: [CareEvent] = []

        for plant in plants {
            if let schedule = plant.schedule(for: type) {
                priorStates.append(PriorScheduleState(schedule: schedule, lastCompletedDate: schedule.lastCompletedDate, nextDueDate: schedule.nextDueDate))
            }
            createdEvents.append(recordCare(type, for: plant, on: date, in: context))
        }

        let undo = {
            for event in createdEvents {
                event.plant?.careEvents.removeAll { $0.id == event.id }
                context.delete(event)
            }
            for prior in priorStates {
                prior.schedule.lastCompletedDate = prior.lastCompletedDate
                prior.schedule.nextDueDate = prior.nextDueDate
                prior.schedule.markDirty()
                if let plant = prior.schedule.plant {
                    NotificationService.scheduleReminder(for: prior.schedule, plant: plant)
                }
            }
        }

        return BulkCareResult(events: createdEvents, undo: undo)
    }

    static func deactivateSchedule(_ type: CareEventType, for plant: Plant) {
        guard let schedule = plant.schedule(for: type) else { return }
        schedule.isActive = false
        schedule.markDirty()
        NotificationService.cancelReminder(for: schedule)
    }

    /// Pushes a schedule's next due date forward by a number of days —
    /// the only thing SmartWateringService's rain suggestion (spec §20)
    /// is allowed to do, and only when the user explicitly taps
    /// "Reporter". Never called automatically: "Ne jamais changer
    /// silencieusement le planning."
    static func postpone(_ schedule: CareSchedule, byDays days: Int, plant: Plant) {
        let base = schedule.nextDueDate ?? .now
        schedule.nextDueDate = Calendar.current.date(byAdding: .day, value: days, to: base)
        schedule.markDirty()
        NotificationService.scheduleReminder(for: schedule, plant: plant)
    }

    /// Adds a photo to a plant's history and sets it as the current main
    /// photo, logging a `.photoUpdate` care event so it shows up in the
    /// timeline alongside watering/fertilizing. Image data is downsized and
    /// compressed before storage.
    @discardableResult
    static func addPhoto(
        imageData: Data,
        for plant: Plant,
        on date: Date = .now,
        notes: String = "",
        in context: ModelContext
    ) -> PlantPhoto {
        let processed = ImageProcessing.prepareForStorage(imageData)
        let detailData = processed?.detailData ?? imageData
        let thumbnailData = processed?.thumbnailData ?? imageData

        let photo = PlantPhoto(plant: plant, imageData: detailData, thumbnailData: thumbnailData, date: date, notes: notes)
        context.insert(photo)
        plant.photos.append(photo)
        plant.photoData = detailData
        plant.thumbnailData = thumbnailData
        plant.markDirty()

        recordCare(.photoUpdate, for: plant, on: date, notes: notes, in: context)

        return photo
    }
}
