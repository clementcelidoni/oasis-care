import XCTest
import SwiftData
@testable import OasisCare

/// Covers the Phase 2 success criteria around scheduling/history logic
/// (spec section 17): next due date math, event creation, overdue
/// detection, deactivation, and bulk actions never sharing one event
/// across plants. Notification *delivery* isn't exercised here — that
/// needs a real UNUserNotificationCenter authorization the CI simulator
/// can't grant — but the schedule state that drives it (nextDueDate,
/// lastCompletedDate) is fully covered, since that's what NotificationService
/// actually reads.
final class CareScheduleEngineTests: XCTestCase {
    var container: ModelContainer!
    var context: ModelContext!

    override func setUpWithError() throws {
        let schema = Schema([Plant.self, Garden.self, GardenZone.self, CareEvent.self, CareSchedule.self, PlantPhoto.self])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        container = try ModelContainer(for: schema, configurations: [configuration])
        context = ModelContext(container)
    }

    override func tearDownWithError() throws {
        container = nil
        context = nil
    }

    private func makePlant(name: String = "Plante test") -> Plant {
        let plant = Plant(customName: name)
        context.insert(plant)
        return plant
    }

    // MARK: - Next due date

    func testRecordCareAdvancesNextDueDateFromCompletionDate() throws {
        let plant = makePlant()
        CareScheduleEngine.setSchedule(.watering, frequencyDays: 7, for: plant, in: context)

        let completionDate = Calendar.current.date(byAdding: .day, value: -1, to: .now)!
        CareScheduleEngine.recordCare(.watering, for: plant, on: completionDate, in: context)

        let schedule = try XCTUnwrap(plant.schedule(for: .watering))
        let expectedNextDue = Calendar.current.date(byAdding: .day, value: 7, to: completionDate)!
        XCTAssertEqual(schedule.lastCompletedDate, completionDate)
        XCTAssertEqual(
            Calendar.current.dateComponents([.year, .month, .day], from: try XCTUnwrap(schedule.nextDueDate)),
            Calendar.current.dateComponents([.year, .month, .day], from: expectedNextDue)
        )
    }

    func testRecordCareAdvancesFromEventDateNotPreviousDueDate() throws {
        // Watering "late" must push the next date from the actual watering
        // date, never from the missed target date - otherwise an overdue
        // schedule would never catch up to the present.
        let plant = makePlant()
        CareScheduleEngine.setSchedule(.watering, frequencyDays: 7, for: plant, in: context)
        let firstCompletion = Calendar.current.date(byAdding: .day, value: -20, to: .now)!
        CareScheduleEngine.recordCare(.watering, for: plant, on: firstCompletion, in: context)

        let secondCompletion = Date.now
        CareScheduleEngine.recordCare(.watering, for: plant, on: secondCompletion, in: context)

        let schedule = try XCTUnwrap(plant.schedule(for: .watering))
        let expected = Calendar.current.date(byAdding: .day, value: 7, to: secondCompletion)!
        XCTAssertEqual(
            Calendar.current.dateComponents([.year, .month, .day], from: try XCTUnwrap(schedule.nextDueDate)),
            Calendar.current.dateComponents([.year, .month, .day], from: expected)
        )
    }

    // MARK: - CareEvent creation

    func testRecordCareCreatesEvent() {
        let plant = makePlant()
        let event = CareScheduleEngine.recordCare(.fertilizing, for: plant, notes: "Engrais liquide", in: context)

        XCTAssertEqual(plant.careEvents.count, 1)
        XCTAssertEqual(plant.careEvents.first?.id, event.id)
        XCTAssertEqual(event.type, .fertilizing)
        XCTAssertEqual(event.notes, "Engrais liquide")
    }

    // MARK: - Overdue / due boundaries

    func testOverdueAndDueBoundaries() throws {
        let plant = makePlant()
        CareScheduleEngine.setSchedule(.watering, frequencyDays: 7, for: plant, in: context)
        let schedule = try XCTUnwrap(plant.schedule(for: .watering))
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: .now)

        schedule.nextDueDate = calendar.date(byAdding: .day, value: -3, to: startOfToday)
        XCTAssertTrue(schedule.isOverdue, "A due date days in the past should be overdue")
        XCTAssertTrue(schedule.isDue)

        schedule.nextDueDate = startOfToday
        XCTAssertFalse(schedule.isOverdue, "Midnight today hasn't rolled into a prior day yet")
        XCTAssertTrue(schedule.isDue, "A due date at or before now should be due")

        schedule.nextDueDate = calendar.date(byAdding: .day, value: 5, to: startOfToday)
        XCTAssertFalse(schedule.isOverdue)
        XCTAssertFalse(schedule.isDue, "A due date days in the future should not be due yet")
    }

    // MARK: - Deactivation

    func testDeactivatedScheduleIsNeverDue() throws {
        let plant = makePlant()
        CareScheduleEngine.setSchedule(.watering, frequencyDays: 7, for: plant, in: context)
        let schedule = try XCTUnwrap(plant.schedule(for: .watering))
        schedule.nextDueDate = Calendar.current.date(byAdding: .day, value: -5, to: .now)

        CareScheduleEngine.deactivateSchedule(.watering, for: plant)

        XCTAssertFalse(schedule.isActive)
        XCTAssertFalse(schedule.isDue)
        XCTAssertFalse(schedule.isOverdue)
    }

    // MARK: - setSchedule never duplicates

    func testSetScheduleTwiceUpdatesInPlaceRatherThanDuplicating() {
        let plant = makePlant()
        CareScheduleEngine.setSchedule(.watering, frequencyDays: 7, for: plant, in: context)
        CareScheduleEngine.setSchedule(.watering, frequencyDays: 10, for: plant, in: context)

        XCTAssertEqual(plant.careSchedules.filter { $0.type == .watering }.count, 1)
        XCTAssertEqual(plant.schedule(for: .watering)?.frequencyDays, 10)
    }

    // MARK: - Bulk actions

    func testBulkCareCreatesIndividualEventPerPlant() {
        let plantA = makePlant(name: "A")
        let plantB = makePlant(name: "B")
        let plantC = makePlant(name: "C")

        let result = CareScheduleEngine.recordCareForMultiple(.watering, plants: [plantA, plantB, plantC], in: context)

        XCTAssertEqual(result.events.count, 3)
        XCTAssertEqual(plantA.careEvents.count, 1)
        XCTAssertEqual(plantB.careEvents.count, 1)
        XCTAssertEqual(plantC.careEvents.count, 1)
        XCTAssertEqual(Set(result.events.map(\.id)).count, 3, "each plant must get its own event, never a shared one")
    }

    func testBulkCareUndoRestoresPriorScheduleState() throws {
        let plant = makePlant()
        CareScheduleEngine.setSchedule(.watering, frequencyDays: 7, for: plant, in: context)
        let priorCompletion = Calendar.current.date(byAdding: .day, value: -10, to: .now)!
        CareScheduleEngine.recordCare(.watering, for: plant, on: priorCompletion, in: context)
        let schedule = try XCTUnwrap(plant.schedule(for: .watering))
        let priorLast = schedule.lastCompletedDate
        let priorNext = schedule.nextDueDate

        let result = CareScheduleEngine.recordCareForMultiple(.watering, plants: [plant], in: context)
        XCTAssertEqual(plant.careEvents.count, 2)

        result.undo()

        XCTAssertEqual(plant.careEvents.count, 1)
        XCTAssertEqual(schedule.lastCompletedDate, priorLast)
        XCTAssertEqual(schedule.nextDueDate, priorNext)
    }
}
