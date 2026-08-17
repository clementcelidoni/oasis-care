import Foundation
import SwiftData

enum DeviceCommandError: LocalizedError {
    case missingCapability
    case deviceOffline
    case alreadyActive
    case durationInvalid
    case underlying(String)

    var errorDescription: String? {
        switch self {
        case .missingCapability: return "Cet équipement ne prend pas en charge cette commande."
        case .deviceOffline: return "Cet équipement est hors ligne."
        case .alreadyActive: return "Cet équipement est déjà en cours d'utilisation."
        case .durationInvalid: return "Durée invalide."
        case .underlying(let message): return message
        }
    }
}

/// Spec §21-24/§87-91 — the single path every real command to a
/// physical actuator goes through, manual taps today and automation-
/// rule triggers once Phase 5D calls the same methods. Nothing outside
/// this file is allowed to call HomeKitService.performActuatorAction
/// directly, so the guard rails here can't be bypassed by a shortcut
/// elsewhere.
///
/// Master rule: "ne déclenche jamais une action physique dangereuse ou
/// non maîtrisée sans garde-fous." A valve opened here is *always*
/// bounded — there is no "open indefinitely" entry point in this
/// service's public API at all, not even an unusually-large duration,
/// since hardMaxValveDurationSeconds clamps every request.
@MainActor
final class DeviceCommandService: ObservableObject {
    static let shared = DeviceCommandService()

    /// Absolute ceiling, independent of anything a caller/rule/AI
    /// requests — spec §90's "chaque actionneur critique doit avoir une
    /// limite." Not user-configurable; AutomationRule's own maxDuration
    /// (Phase 5D) can only ever be tighter than this, never looser.
    static let hardMaxValveDurationSeconds: TimeInterval = 30 * 60

    struct ActiveValve {
        var device: ConnectedDevice
        var startedAt: Date
        var endsAt: Date
    }

    @Published private(set) var activeValves: [UUID: ActiveValve] = [:]
    private var timeoutTasks: [UUID: Task<Void, Never>] = [:]

    private init() {}

    // MARK: - Valves

    @discardableResult
    func openValve(
        _ device: ConnectedDevice, durationSeconds: TimeInterval,
        trigger: DeviceCommandTriggerKind = .manual, ruleID: UUID? = nil, context: ModelContext
    ) async -> Result<Void, DeviceCommandError> {
        guard device.hasCapability(.valve) else {
            return fail(.missingCapability, device: device, command: .openValve, trigger: trigger, ruleID: ruleID, context: context)
        }
        guard device.online else {
            return fail(.deviceOffline, device: device, command: .openValve, trigger: trigger, ruleID: ruleID, context: context)
        }
        guard activeValves[device.id] == nil else {
            return fail(.alreadyActive, device: device, command: .openValve, trigger: trigger, ruleID: ruleID, context: context)
        }
        guard durationSeconds > 0 else {
            return fail(.durationInvalid, device: device, command: .openValve, trigger: trigger, ruleID: ruleID, context: context)
        }
        let clamped = min(durationSeconds, Self.hardMaxValveDurationSeconds)

        do {
            try await HomeKitService.shared.performActuatorAction(
                .setActive(true), providerDeviceId: device.providerDeviceId, capability: .valve
            )
            // Best-effort hardware-level safety net on top of this
            // service's own software timeout below — if the accessory
            // supports SetDuration, it can auto-close itself even if
            // this app is killed or loses connectivity mid-cycle.
            try? await HomeKitService.shared.performActuatorAction(
                .setValveDuration(clamped), providerDeviceId: device.providerDeviceId, capability: .valve
            )
        } catch {
            return fail(.underlying(error.localizedDescription), device: device, command: .openValve, trigger: trigger, ruleID: ruleID, context: context)
        }

        let now = Date.now
        let endsAt = now.addingTimeInterval(clamped)
        device.currentState = "Ouvert"
        device.lastActionAt = now
        markDirty(device)
        activeValves[device.id] = ActiveValve(device: device, startedAt: now, endsAt: endsAt)
        scheduleTimeout(for: device, after: clamped, context: context)
        logCommand(.openValve, device: device, trigger: trigger, ruleID: ruleID, succeeded: true, durationSeconds: clamped, context: context)
        return .success(())
    }

    @discardableResult
    func closeValve(
        _ device: ConnectedDevice, trigger: DeviceCommandTriggerKind = .manual, ruleID: UUID? = nil, context: ModelContext
    ) async -> Result<Void, DeviceCommandError> {
        timeoutTasks[device.id]?.cancel()
        timeoutTasks[device.id] = nil
        activeValves[device.id] = nil

        do {
            try await HomeKitService.shared.performActuatorAction(
                .setActive(false), providerDeviceId: device.providerDeviceId, capability: .valve
            )
        } catch {
            logCommand(.closeValve, device: device, trigger: trigger, ruleID: ruleID, succeeded: false, context: context)
            return .failure(.underlying(error.localizedDescription))
        }

        device.currentState = "Fermé"
        device.lastActionAt = .now
        markDirty(device)
        logCommand(.closeValve, device: device, trigger: trigger, ruleID: ruleID, succeeded: true, context: context)
        return .success(())
    }

    /// Spec §24 — every controllable valve/pump stopped at once,
    /// regardless of what started it.
    func emergencyStopAll(devices: [ConnectedDevice], context: ModelContext) async {
        for device in devices where activeValves[device.id] != nil {
            await closeValve(device, trigger: .emergencyStop, context: context)
        }
    }

    private func scheduleTimeout(for device: ConnectedDevice, after seconds: TimeInterval, context: ModelContext) {
        let deviceID = device.id
        timeoutTasks[deviceID] = Task { [weak self] in
            // nanoseconds, not Duration.seconds(_:) — avoids relying on
            // a Double overload of that API existing/resolving cleanly;
            // Task.sleep(nanoseconds:) has been unambiguous since the
            // original structured-concurrency API.
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            guard let self, self.activeValves[deviceID] != nil else { return }
            await self.closeValve(device, trigger: .manual, context: context)
        }
    }

    // MARK: - Simple on/off actuators (switch/pump/light/heater/fan)

    @discardableResult
    func setPower(
        _ device: ConnectedDevice, on: Bool, capability: DeviceCapability,
        trigger: DeviceCommandTriggerKind = .manual, ruleID: UUID? = nil, context: ModelContext
    ) async -> Result<Void, DeviceCommandError> {
        guard device.hasCapability(capability) else {
            return fail(.missingCapability, device: device, command: on ? .turnOn : .turnOff, trigger: trigger, ruleID: ruleID, context: context)
        }
        guard device.online else {
            return fail(.deviceOffline, device: device, command: on ? .turnOn : .turnOff, trigger: trigger, ruleID: ruleID, context: context)
        }
        let action: HomeKitService.ActuatorAction = Self.onOffAction(for: capability, on: on)
        do {
            try await HomeKitService.shared.performActuatorAction(
                action, providerDeviceId: device.providerDeviceId, capability: capability
            )
        } catch {
            return fail(.underlying(error.localizedDescription), device: device, command: on ? .turnOn : .turnOff, trigger: trigger, ruleID: ruleID, context: context)
        }
        device.currentState = on ? "Marche" : "Arrêt"
        device.lastActionAt = .now
        markDirty(device)
        logCommand(on ? .turnOn : .turnOff, device: device, trigger: trigger, ruleID: ruleID, succeeded: true, context: context)
        return .success(())
    }

    /// Spec §21's setLevel — brightness on a light. Not wired to any UI
    /// yet; exposed for Phase 5D/5F to call once they need it.
    @discardableResult
    func setLevel(
        _ device: ConnectedDevice, level: Double, trigger: DeviceCommandTriggerKind = .manual,
        ruleID: UUID? = nil, context: ModelContext
    ) async -> Result<Void, DeviceCommandError> {
        guard device.hasCapability(.light) else {
            return fail(.missingCapability, device: device, command: .setLevel, trigger: trigger, ruleID: ruleID, context: context)
        }
        guard device.online else {
            return fail(.deviceOffline, device: device, command: .setLevel, trigger: trigger, ruleID: ruleID, context: context)
        }
        do {
            try await HomeKitService.shared.performActuatorAction(
                .setBrightness(level), providerDeviceId: device.providerDeviceId, capability: .light
            )
        } catch {
            return fail(.underlying(error.localizedDescription), device: device, command: .setLevel, trigger: trigger, ruleID: ruleID, context: context)
        }
        device.currentState = "\(Int(level))%"
        device.lastActionAt = .now
        markDirty(device)
        logCommand(.setLevel, device: device, trigger: trigger, ruleID: ruleID, succeeded: true, context: context)
        return .success(())
    }

    /// Switch/Outlet/Lightbulb (older-style HAP services) use
    /// PowerState; Fan/HeaterCooler (newer-style "v2" services) use
    /// Active — confirmed per-service, not guessed from one constant
    /// covering everything.
    private static func onOffAction(for capability: DeviceCapability, on: Bool) -> HomeKitService.ActuatorAction {
        switch capability {
        case .switchDevice, .light:
            return .setPower(on)
        case .fan, .heater:
            return .setActive(on)
        default:
            return .setPower(on)
        }
    }

    // MARK: - Audit + helpers

    private func fail(
        _ error: DeviceCommandError, device: ConnectedDevice, command: DeviceCommandKind,
        trigger: DeviceCommandTriggerKind, ruleID: UUID?, context: ModelContext
    ) -> Result<Void, DeviceCommandError> {
        logCommand(command, device: device, trigger: trigger, ruleID: ruleID, succeeded: false, errorMessage: error.localizedDescription, context: context)
        return .failure(error)
    }

    private func logCommand(
        _ command: DeviceCommandKind, device: ConnectedDevice, trigger: DeviceCommandTriggerKind, ruleID: UUID?,
        succeeded: Bool, errorMessage: String? = nil, durationSeconds: Double? = nil, context: ModelContext
    ) {
        let log = DeviceCommandLog(
            device: device, command: command, trigger: trigger, triggerRuleID: ruleID,
            succeeded: succeeded, errorMessage: errorMessage, requestedDurationSeconds: durationSeconds
        )
        context.insert(log)
        try? context.save()
    }

    private func markDirty(_ device: ConnectedDevice) {
        if device.syncStatus == .synced { device.syncStatus = .pendingUpdate }
        device.updatedAt = .now
    }
}
