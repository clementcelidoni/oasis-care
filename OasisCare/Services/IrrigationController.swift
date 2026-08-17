import Foundation
import SwiftData

/// Phase 4D's "prepared seam" filled in for real (spec §33-40) — zone,
/// vanne, pompe, débit, durée, arrêt, historique. Manual logCycle stays
/// for zones with no linked hardware; startZone/stopZoneAndLog are the
/// real-hardware path, both going through DeviceCommandService so the
/// same guard rails/timeout/audit apply regardless of whether a run
/// was started from here or a raw AssociateDeviceSheet toggle.
/// @MainActor: reads DeviceCommandService.shared.activeValves directly
/// in hasUnexpectedFlow/isPotentiallyIneffective, which is itself
/// MainActor-isolated — matches every existing call site anyway, since
/// this is only ever called from SwiftUI view code.
@MainActor
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

    static func startZone(_ zone: IrrigationZone, durationMinutes: Int, context: ModelContext) async -> Result<Void, DeviceCommandError> {
        guard let valve = zone.valveDevice else { return .failure(.missingCapability) }
        return await DeviceCommandService.shared.openValve(valve, durationSeconds: TimeInterval(durationMinutes * 60), context: context)
    }

    /// Called by the connected-zone UI either when the user taps
    /// "Arrêter" or when it observes the valve is no longer active
    /// (closed by DeviceCommandService's own timeout) — either way this
    /// is what turns the run into a real IrrigationEvent (spec §37) and,
    /// when the zone has plants, a matching watering CareEvent so it
    /// shows up in each plant's own history too, not just the zone's.
    @discardableResult
    static func stopZoneAndLog(
        _ zone: IrrigationZone, elapsedSeconds: TimeInterval, soilMoistureBefore: Double?, context: ModelContext
    ) async -> IrrigationEvent {
        if let valve = zone.valveDevice {
            await DeviceCommandService.shared.closeValve(valve, context: context)
        }
        let durationMinutes = max(1, Int((elapsedSeconds / 60).rounded()))
        let measuredLiters = zone.flowSensor?.latestReading?.value
        let estimatedLiters = measuredLiters ?? zone.flowRate.map {
            IrrigationCalculator.zoneLitersUsed(flowRateLitersPerHour: $0, durationMinutes: durationMinutes)
        } ?? 0
        let event = IrrigationEvent(
            zone: zone, durationMinutes: durationMinutes, estimatedLiters: estimatedLiters, isAutomatic: false,
            soilMoistureBefore: soilMoistureBefore, soilMoistureAfter: zone.soilSensor?.latestReading?.value,
            measuredLiters: measuredLiters
        )
        context.insert(event)
        zone.events.append(event)
        for plant in zone.plants {
            let careEvent = CareEvent(plant: plant, type: .watering, date: .now, notes: "Arrosage connecté — \(zone.name)")
            context.insert(careEvent)
        }
        try? context.save()
        return event
    }

    // MARK: - Health checks (spec §39-40)

    /// Unexpected flow while nothing in this zone is open.
    static func hasUnexpectedFlow(_ zone: IrrigationZone) -> Bool {
        guard let flow = zone.flowSensor?.latestReading?.value, flow > 0 else { return false }
        guard let valveID = zone.valveDevice?.id else { return true }
        return DeviceCommandService.shared.activeValves[valveID] == nil
    }

    /// Valve reports active but flow reads zero — clogged emitter,
    /// closed valve upstream, stopped pump, a real leak elsewhere, or a
    /// misplaced sensor (spec §40 lists all five as open possibilities;
    /// this only flags the symptom, not which cause).
    static func isPotentiallyIneffective(_ zone: IrrigationZone) -> Bool {
        guard let valveID = zone.valveDevice?.id, DeviceCommandService.shared.activeValves[valveID] != nil else { return false }
        guard let flow = zone.flowSensor?.latestReading?.value else { return false }
        return flow == 0
    }
}
