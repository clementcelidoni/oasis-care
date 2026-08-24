import Foundation
import SwiftData

/// Spec Phase 7G — "BioreactorController... s'appuie autant que possible
/// sur les couches connectées déjà développées." Every method here is a
/// thin translation from a BioLab-domain action to the one existing path
/// every real actuator command already goes through
/// (DeviceCommandService) — no new HomeKit/hardware code, no new safety
/// mechanism, just BioLab's own vocabulary (roles, bindings) on top.
///
/// "Ne pas supposer qu'un bioréacteur possède toutes ces fonctions" —
/// every method returns `nil` (rather than throwing or silently
/// succeeding) when the requested role has no device bound, so a caller
/// always knows the difference between "the command failed" and "this
/// bioreactor was never wired for that action."
@MainActor
enum BioreactorController {
    enum Action {
        case start
        case stop
    }

    static func device(for role: BioreactorDeviceRole, on bioreactor: Bioreactor) -> ConnectedDevice? {
        bioreactor.deviceBindings.first { $0.role == role }?.device
    }

    /// Air pump / liquid pump / light are simple on-off actuators. The
    /// valve goes through its own methods below instead — spec's
    /// existing valve safety ceiling (DeviceCommandService's
    /// hardMaxValveDurationSeconds, "jamais d'ouverture indéfinie") only
    /// applies to that path, not to setPower.
    @discardableResult
    static func setActuator(
        _ role: BioreactorDeviceRole, on bioreactor: Bioreactor, action: Action,
        trigger: DeviceCommandTriggerKind = .manual, context: ModelContext
    ) async -> Result<Void, DeviceCommandError>? {
        guard role != .valve, let device = device(for: role, on: bioreactor) else { return nil }
        return await DeviceCommandService.shared.setPower(
            device, on: action == .start, capability: role.matchingCapability, trigger: trigger, context: context
        )
    }

    @discardableResult
    static func openValve(
        on bioreactor: Bioreactor, durationSeconds: TimeInterval,
        trigger: DeviceCommandTriggerKind = .manual, context: ModelContext
    ) async -> Result<Void, DeviceCommandError>? {
        guard let device = device(for: .valve, on: bioreactor) else { return nil }
        return await DeviceCommandService.shared.openValve(device, durationSeconds: durationSeconds, trigger: trigger, context: context)
    }

    @discardableResult
    static func closeValve(
        on bioreactor: Bioreactor, trigger: DeviceCommandTriggerKind = .manual, context: ModelContext
    ) async -> Result<Void, DeviceCommandError>? {
        guard let device = device(for: .valve, on: bioreactor) else { return nil }
        return await DeviceCommandService.shared.closeValve(device, trigger: trigger, context: context)
    }

    /// BioreactorCycleScheduler's `actuate` bridge (see that type's own
    /// doc comment for the full safety context). Only ever called when
    /// `bioreactor.automationEnabled` — the scheduler itself already
    /// gates on that before scheduling a cycle at all, this is a second,
    /// cheap check at the actuation boundary itself.
    ///
    /// Standard temporary-immersion mechanism assumption: the air pump
    /// pressurizes the vessel to immerse the culture, and stopping it
    /// lets the medium drain back by gravity — the one component RITA/
    /// Plantform/temporary-immersion systems (BioreactorType) have in
    /// common. Valve and liquid pump stay manual-only (device mapping,
    /// maintenance tests): whether a specific vessel even has one, let
    /// alone how it should move for immersion vs. aeration, isn't
    /// something this app can know rather than guess — see the Phase 7
    /// report's limitations section.
    nonisolated static func actuateCycle(_ execution: BioreactorCycleExecution, starting: Bool, context: ModelContext) {
        Task {
            guard let bioreactor = execution.bioreactor, bioreactor.automationEnabled else { return }
            await setActuator(.airPump, on: bioreactor, action: starting ? .start : .stop, trigger: .automation, context: context)
        }
    }
}
