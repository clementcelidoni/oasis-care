import Foundation
import SwiftData

/// Which dashboard sections are visible — spec §14 ("Personnaliser
/// l'accueil"). One row per local store (this app is single-user
/// per-device), fetched via DashboardService.preferences(in:) which
/// creates it on first use. Synced like other per-user settings so it
/// follows the account across devices.
///
/// Section reordering is explicitly hedged in the spec ("si
/// raisonnable") — skipped for now in favor of a fixed, spec-matching
/// order; only visibility is customizable.
@Model
final class DashboardPreferences: Syncable {
    var id: UUID
    var showToday: Bool
    var showAlerts: Bool
    var showWeather: Bool
    var showOasisAI: Bool
    var showWater: Bool
    var showRecentActivity: Bool
    var showUpcoming: Bool
    var showHealth: Bool
    var showEvolution: Bool
    // Inline default (Phase 5A added this to an existing model with
    // real rows — an init-only default is invisible to SwiftData's
    // migration inference; see Garden.weatherEnabled's history).
    var showConnectedHome: Bool = true
    var showDeviceHealth: Bool = true
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    init() {
        self.id = UUID()
        self.showToday = true
        self.showAlerts = true
        self.showWeather = true
        self.showOasisAI = true
        self.showWater = true
        self.showRecentActivity = true
        self.showUpcoming = true
        self.showHealth = true
        self.showEvolution = true
        self.showConnectedHome = true
        self.showDeviceHealth = true
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
