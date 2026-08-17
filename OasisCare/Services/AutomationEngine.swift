import Foundation
import SwiftData

/// Spec §25-32 — evaluates AutomationRule conditions against real data
/// and, for `.automatic` rules, executes their actions through
/// DeviceCommandService (never directly) once all guard rails pass.
///
/// Runs on-demand (app foreground, pull-to-refresh, a Timer while the
/// app is active) rather than as a true background daemon — iOS
/// background execution for open-ended periodic work needs either
/// BackgroundTasks (best-effort, not guaranteed at a precise time) or
/// a server-side scheduled Edge Function; neither is built this phase.
/// Noted as a Phase 6 recommendation rather than silently pretended
/// away, since a rule set to fire "05:00-09:00" cannot actually be
/// trusted to fire unattended yet.
@MainActor
enum AutomationEngine {
    struct WeatherContext {
        var rainForecastMm: Double?
    }

    // MARK: - Condition evaluation (pure, testable)

    static func evaluate(_ condition: AutomationCondition, rule: AutomationRule, weather: WeatherContext, now: Date = .now, calendar: Calendar = .current) -> Bool {
        switch condition.type {
        case .soilMoistureBelow, .temperatureBelow, .humidityBelow:
            guard let value = aggregatedValue(for: condition, rule: rule), let threshold = condition.numericThreshold else { return false }
            return value < threshold
        case .soilMoistureAbove, .temperatureAbove, .humidityAbove:
            guard let value = aggregatedValue(for: condition, rule: rule), let threshold = condition.numericThreshold else { return false }
            return value > threshold
        case .rainForecastBelow:
            guard let threshold = condition.numericThreshold else { return false }
            return (weather.rainForecastMm ?? 0) < threshold
        case .rainForecastAbove:
            guard let threshold = condition.numericThreshold else { return false }
            return (weather.rainForecastMm ?? 0) > threshold
        case .lastWateringOlderThan:
            guard let hours = condition.hoursThreshold else { return false }
            guard let lastWatering = lastWateringDate(for: rule) else { return true }
            return now.timeIntervalSince(lastWatering) / 3600 > hours
        case .timeBetween:
            guard let start = condition.timeRangeStartMinutes, let end = condition.timeRangeEndMinutes else { return false }
            let components = calendar.dateComponents([.hour, .minute], from: now)
            let minutesNow = (components.hour ?? 0) * 60 + (components.minute ?? 0)
            return start <= end ? (minutesNow >= start && minutesNow <= end) : (minutesNow >= start || minutesNow <= end)
        case .dayOfWeek:
            let weekday = calendar.component(.weekday, from: now)
            return condition.daysOfWeek.contains(weekday)
        case .sensorOnline:
            guard let sensor = condition.sensor else { return false }
            return !sensor.isStale
        case .deviceOnline:
            guard let device = condition.device else { return false }
            return device.online
        }
    }

    /// Spec §16-adjacent: a condition with no explicit sensor averages
    /// every matching-type sensor within the rule's scope, rather than
    /// picking one arbitrarily.
    private static func aggregatedValue(for condition: AutomationCondition, rule: AutomationRule) -> Double? {
        if let sensor = condition.sensor {
            return sensor.latestReading?.value
        }
        let type: SensorType?
        switch condition.type {
        case .soilMoistureBelow, .soilMoistureAbove: type = .soilMoisture
        case .temperatureBelow, .temperatureAbove: type = .airTemperature
        case .humidityBelow, .humidityAbove: type = .airHumidity
        default: type = nil
        }
        guard let type else { return nil }
        let sensors = scopedSensors(for: rule).filter { $0.type == type }
        let values = sensors.compactMap { $0.latestReading?.value }
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }

    private static func scopedSensors(for rule: AutomationRule) -> [Sensor] {
        if let plant = rule.scopePlant { return plant.sensors }
        if let zone = rule.scopeZone { return zone.sensors }
        if let garden = rule.scopeGarden { return garden.sensors }
        return []
    }

    private static func lastWateringDate(for rule: AutomationRule) -> Date? {
        let plants: [Plant]
        if let plant = rule.scopePlant { plants = [plant] }
        else if let zone = rule.scopeZone { plants = zone.plants }
        else if let garden = rule.scopeGarden { plants = garden.plants }
        else { plants = [] }
        return plants
            .flatMap(\.careEvents)
            .filter { $0.type == .watering }
            .map(\.date)
            .max()
    }

    /// All conditions AND-ed together — spec §28 offers OR too, but
    /// multiple simple rules achieving the same effect stays
    /// comprehensible (spec's own "éviter un moteur de règles
    /// incompréhensible"); this engine only implements AND.
    static func evaluate(_ rule: AutomationRule, weather: WeatherContext, now: Date = .now) -> Bool {
        guard !rule.conditions.isEmpty else { return false }
        return rule.conditions.allSatisfy { evaluate($0, rule: rule, weather: weather, now: now) }
    }

    static func conditionsSummary(_ rule: AutomationRule, weather: WeatherContext, now: Date = .now) -> String {
        rule.conditions
            .sorted { $0.order < $1.order }
            .map { condition in
                let met = evaluate(condition, rule: rule, weather: weather, now: now) ? "✓" : "✗"
                return "\(met) \(condition.type.displayName)"
            }
            .joined(separator: " · ")
    }

    // MARK: - Automatic execution

    /// Called from app-foreground/refresh points (HomeView.task,
    /// pull-to-refresh on MaisonConnecteeView) — see this file's own
    /// doc comment on why this isn't a true background daemon yet.
    static func runAutomaticRules(_ rules: [AutomationRule], weather: WeatherContext, context: ModelContext) async {
        for rule in rules where rule.enabled && rule.mode == .automatic {
            guard rule.canRunNow else { continue }
            let decision = evaluate(rule, weather: weather)
            guard decision else { continue }
            await execute(rule, weather: weather, context: context)
        }
    }

    @discardableResult
    static func execute(_ rule: AutomationRule, weather: WeatherContext, context: ModelContext) async -> AutomationExecution {
        let summary = conditionsSummary(rule, weather: weather)
        var actionDescriptions: [String] = []
        var succeeded = true
        var lastError: String?

        for action in rule.actions.sorted(by: { $0.order < $1.order }) {
            let result = await perform(action, rule: rule, context: context)
            actionDescriptions.append("\(action.type.displayName): \(result.isSuccess ? "OK" : "échec")")
            if case .failure(let error) = result {
                succeeded = false
                lastError = error
            }
        }

        rule.lastTriggeredAt = .now
        if rule.syncStatus == .synced { rule.syncStatus = .pendingUpdate }
        let execution = AutomationExecution(
            rule: rule, conditionsSummary: summary, decision: true,
            actionSummary: actionDescriptions.joined(separator: ", "), succeeded: succeeded, errorMessage: lastError
        )
        context.insert(execution)
        try? context.save()
        return execution
    }

    private enum ActionResult {
        case success
        case failure(String)
        var isSuccess: Bool { if case .success = self { return true }; return false }
    }

    private static func actionResult(from result: Result<Void, DeviceCommandError>) -> ActionResult {
        switch result {
        case .success: return .success
        case .failure(let error): return .failure(error.localizedDescription)
        }
    }

    private static func perform(_ action: AutomationAction, rule: AutomationRule, context: ModelContext) async -> ActionResult {
        guard !action.type.requiresDevice || action.device != nil else {
            return .failure("Aucun équipement configuré.")
        }
        let commandService = DeviceCommandService.shared
        let ruleID = rule.id
        switch action.type {
        case .openValve:
            guard let device = action.device else { return .failure("Aucune vanne configurée.") }
            let result = await commandService.openValve(
                device, durationSeconds: action.durationSeconds ?? 480, trigger: .automation, ruleID: ruleID, context: context
            )
            return actionResult(from: result)
        case .closeValve:
            guard let device = action.device else { return .failure("Aucun équipement configuré.") }
            let result = await commandService.closeValve(device, trigger: .automation, ruleID: ruleID, context: context)
            return actionResult(from: result)
        case .startPump, .stopPump, .turnFanOn, .turnFanOff, .turnHeaterOn, .turnHeaterOff,
             .turnMisterOn, .turnMisterOff, .turnLightOn, .turnLightOff:
            guard let device = action.device else { return .failure("Aucun équipement configuré.") }
            let on = [.startPump, .turnFanOn, .turnHeaterOn, .turnMisterOn, .turnLightOn].contains(action.type)
            let targetCapability = capability(for: action.type)
            let result = await commandService.setPower(device, on: on, capability: targetCapability, trigger: .automation, ruleID: ruleID, context: context)
            return actionResult(from: result)
        case .sendNotification:
            NotificationService.sendImmediate(title: "Oasis Care", body: action.message ?? "Une automatisation s'est déclenchée.")
            return .success
        case .createCareEvent:
            guard let plant = rule.scopePlant else { return .success }
            let event = CareEvent(plant: plant, type: .watering, date: .now, notes: action.message ?? "Créé par automatisation")
            context.insert(event)
            return .success
        }
    }

    private static func capability(for type: AutomationActionType) -> DeviceCapability {
        switch type {
        case .startPump, .stopPump: return .pump
        case .turnFanOn, .turnFanOff: return .fan
        case .turnHeaterOn, .turnHeaterOff: return .heater
        case .turnMisterOn, .turnMisterOff: return .mister
        case .turnLightOn, .turnLightOff: return .light
        default: return .switchDevice
        }
    }

    // MARK: - Simulation (spec §31)

    /// Replays a rule's non-time-of-execution conditions against
    /// historical readings to show "cette règle aurait déclenché" —
    /// dayOfWeek/timeBetween are evaluated against each reading's own
    /// timestamp; sensor-based conditions use the reading nearest that
    /// timestamp from each relevant sensor.
    static func simulate(_ rule: AutomationRule, overPastDays days: Int, now: Date = .now, calendar: Calendar = .current) -> [Date] {
        guard let start = calendar.date(byAdding: .day, value: -days, to: now) else { return [] }
        let sensors = Set(rule.conditions.compactMap(\.sensor) + scopedSensors(for: rule))
        let timestamps = Set(sensors.flatMap(\.readings).map(\.timestamp).filter { $0 >= start && $0 <= now })
        return timestamps.sorted().filter { timestamp in
            rule.conditions.allSatisfy { condition in
                switch condition.type {
                case .timeBetween, .dayOfWeek:
                    return evaluate(condition, rule: rule, weather: WeatherContext(rainForecastMm: nil), now: timestamp, calendar: calendar)
                case .sensorOnline, .deviceOnline, .rainForecastBelow, .rainForecastAbove:
                    // Not meaningfully replayable from sensor-reading
                    // history alone — assumed satisfied so the
                    // simulation still reflects the conditions it can.
                    return true
                default:
                    guard let sensor = condition.sensor ?? scopedSensors(for: rule).first(where: { $0.type == impliedType(condition.type) }) else { return false }
                    guard let reading = sensor.readings.filter({ $0.timestamp <= timestamp }).max(by: { $0.timestamp < $1.timestamp }) else { return false }
                    guard let threshold = condition.numericThreshold else { return false }
                    return condition.type == .soilMoistureBelow || condition.type == .temperatureBelow || condition.type == .humidityBelow
                        ? reading.value < threshold
                        : reading.value > threshold
                }
            }
        }
    }

    private static func impliedType(_ conditionType: AutomationConditionType) -> SensorType? {
        switch conditionType {
        case .soilMoistureBelow, .soilMoistureAbove: return .soilMoisture
        case .temperatureBelow, .temperatureAbove: return .airTemperature
        case .humidityBelow, .humidityAbove: return .airHumidity
        default: return nil
        }
    }
}
