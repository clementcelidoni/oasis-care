import Foundation
import SwiftData

/// One irrigation cycle for a zone (spec §37). A dedicated model
/// rather than reusing CareEvent: CareEvent is plant-scoped and has no
/// notion of a zone, duration, or estimated volume, and the spec
/// explicitly allows either approach ("créer... ou réutiliser
/// correctement CareEvent") — bolting zone/duration/volume onto a
/// plant-intervention model would be the less correct of the two.
/// Append-only like CareEvent: no updatedAt, never edited after the
/// fact.
@Model
final class IrrigationEvent {
    var id: UUID
    var date: Date
    var durationMinutes: Int
    var estimatedLiters: Double
    /// Always false today — spec §39 explicitly forbids real hardware
    /// automation in Phase 4. Reserved for when IrrigationController
    /// actually controls something.
    var isAutomatic: Bool
    var notes: String
    var zone: IrrigationZone?
    var syncStatus: SyncStatus?

    init(
        zone: IrrigationZone?,
        date: Date = .now,
        durationMinutes: Int,
        estimatedLiters: Double,
        isAutomatic: Bool = false,
        notes: String = ""
    ) {
        self.id = UUID()
        self.zone = zone
        self.date = date
        self.durationMinutes = durationMinutes
        self.estimatedLiters = estimatedLiters
        self.isAutomatic = isAutomatic
        self.notes = notes
        self.syncStatus = .pendingCreate
    }
}
