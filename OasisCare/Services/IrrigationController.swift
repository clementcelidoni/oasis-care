import Foundation
import SwiftData

/// Prepared seam for real hardware control (spec §39) — "aucune
/// ouverture réelle d'électrovanne en Phase 4." logCycle logs a
/// completed irrigation cycle exactly as a real controller would once
/// one exists, but nothing here talks to any hardware; it's called
/// today only from a user tapping "Enregistrer un cycle" by hand.
enum IrrigationController {
    @discardableResult
    static func logCycle(for zone: IrrigationZone, durationMinutes: Int? = nil, in context: ModelContext) -> IrrigationEvent {
        let duration = durationMinutes ?? zone.durationMinutes ?? 15
        let liters = zone.flowRate.map {
            IrrigationCalculator.zoneLitersUsed(flowRateLitersPerHour: $0, durationMinutes: duration)
        } ?? 0
        let event = IrrigationEvent(zone: zone, durationMinutes: duration, estimatedLiters: liters, isAutomatic: false)
        context.insert(event)
        zone.events.append(event)
        return event
    }
}
