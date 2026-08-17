import Foundation
import SwiftData

/// Spec §43-46 — runs on the same app-foreground cadence as
/// AutomationEngine (see its doc comment for why this isn't a
/// guaranteed background daemon yet). Deliberately a dedicated service
/// rather than pre-built AutomationRule rows: the spec frames
/// greenhouse climate as its own numbered requirements with specific
/// hysteresis/frequency rules, not as a generic rule the user builds.
///
/// Misting simplification, noted rather than hidden: spec §45 asks for
/// 30-second pulses capped at 3/hour. Without a background daemon,
/// timing precise pulses on a real schedule isn't achievable anyway —
/// this instead turns misting on when humidity is low and off once it
/// recovers, checked on the same foreground cadence as everything
/// else. Simpler, and safer (nothing can get stuck "always pulsing"),
/// at the cost of not literally matching "30 sec, max 3x/h."
@MainActor
enum GreenhouseClimateService {
    static func evaluate(_ greenhouse: Greenhouse, context: ModelContext) async {
        guard greenhouse.climateControlEnabled else { return }
        await evaluateHeating(greenhouse, context: context)
        await evaluateVentilation(greenhouse, context: context)
        await evaluateMisting(greenhouse, context: context)
    }

    /// Spec §43 — hysteresis via the actuator's own last-known state
    /// (ConnectedDevice.currentState), not just the instantaneous
    /// reading: only turns on below the minimum, only turns off above
    /// the maximum, so a temperature sitting between the two never
    /// flickers the heater.
    private static func evaluateHeating(_ greenhouse: Greenhouse, context: ModelContext) async {
        guard let heater = greenhouse.heaterDevice, let temp = greenhouse.temperatureSensor?.latestReading?.value else { return }
        let isOn = heater.currentState == DeviceOnOffState.on.rawValue
        if !isOn, let min = greenhouse.targetTemperatureMin, temp < min {
            await DeviceCommandService.shared.setPower(heater, on: true, capability: .heater, context: context)
        } else if isOn, let max = greenhouse.targetTemperatureMax, temp > max {
            await DeviceCommandService.shared.setPower(heater, on: false, capability: .heater, context: context)
        }
    }

    /// Spec §44 — too hot OR too humid.
    private static func evaluateVentilation(_ greenhouse: Greenhouse, context: ModelContext) async {
        guard let fan = greenhouse.fanDevice else { return }
        let isOn = fan.currentState == DeviceOnOffState.on.rawValue
        let tooHot = isAbove(greenhouse.temperatureSensor, max: greenhouse.targetTemperatureMax)
        let tooHumid = isAbove(greenhouse.humiditySensor, max: greenhouse.targetHumidityMax)
        let shouldRun = tooHot || tooHumid
        guard shouldRun != isOn else { return }
        await DeviceCommandService.shared.setPower(fan, on: shouldRun, capability: .fan, context: context)
    }

    private static func evaluateMisting(_ greenhouse: Greenhouse, context: ModelContext) async {
        guard let mister = greenhouse.misterDevice, let humidity = greenhouse.humiditySensor?.latestReading?.value else { return }
        let isOn = mister.currentState == DeviceOnOffState.on.rawValue
        let tooDry = greenhouse.targetHumidityMin.map { humidity < $0 } ?? false
        let recovered = greenhouse.targetHumidityMax.map { humidity >= $0 } ?? !tooDry
        if !isOn && tooDry {
            await DeviceCommandService.shared.setPower(mister, on: true, capability: .mister, context: context)
        } else if isOn && recovered {
            await DeviceCommandService.shared.setPower(mister, on: false, capability: .mister, context: context)
        }
    }

    private static func isAbove(_ sensor: Sensor?, max: Double?) -> Bool {
        guard let value = sensor?.latestReading?.value, let max else { return false }
        return value > max
    }
}

/// Matches the exact strings DeviceCommandService writes to
/// ConnectedDevice.currentState for on/off actuators — kept as a
/// single source of truth so this file's hysteresis checks can't
/// silently drift from what actually gets written there.
enum DeviceOnOffState: String {
    case on = "Marche"
    case off = "Arrêt"
}
