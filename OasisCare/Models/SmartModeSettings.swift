import Foundation
import SwiftData

/// Spec §72/§75/§76 — user-controlled seasonal/situational modes.
/// Canicule (§73) and Gel (§74) aren't here: those are transient,
/// weather-driven conditions the app detects automatically each time
/// (SmartWateringService.heatwaveAlert/frostAlert), not something the
/// user switches on — same split as everywhere else in this app between
/// a real measured/forecast condition and a standing preference.
@Model
final class SmartModeSettings: Syncable {
    var id: UUID
    var vacationModeEnabled: Bool
    /// Spec §72's own example ("du 20 août au 3 septembre") — the
    /// toggle can stay on across trips; only the date range decides
    /// whether it's *actually* active right now (isVacationActiveNow).
    var vacationStartDate: Date?
    var vacationEndDate: Date?
    var winterModeEnabled: Bool
    var waterSavingModeEnabled: Bool
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    init() {
        self.id = UUID()
        self.vacationModeEnabled = false
        self.vacationStartDate = nil
        self.vacationEndDate = nil
        self.winterModeEnabled = false
        self.waterSavingModeEnabled = false
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    func isVacationActiveNow(_ date: Date = .now) -> Bool {
        guard vacationModeEnabled, let start = vacationStartDate, let end = vacationEndDate else { return false }
        return date >= start && date <= end
    }
}
