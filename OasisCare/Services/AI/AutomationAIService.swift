import Foundation
import SwiftData

/// Calls the propose-automation Edge Function and turns an accepted
/// proposal into a real rule (spec §71). This is the ONLY place outside
/// AutomationRuleFormView that ever constructs an AutomationRule — and
/// even here, the rule is always created disabled, in manual mode: the
/// AI never activates anything, it only ever proposes.
enum AutomationAIService {
    enum BuildError: LocalizedError {
        case noMatchingDevice

        var errorDescription: String? {
            switch self {
            case .noMatchingDevice: return "Aucun équipement compatible trouvé dans cette portée pour cette action."
            }
        }
    }

    struct ProposalContext: Encodable {
        var scopeName: String?
        var availableSensorTypes: [String]
        var availableActionCapabilities: [String]
    }

    static func propose(goal: String, garden: Garden?, zone: GardenZone?, plant: Plant?) async throws -> AutomationProposal {
        struct RequestBody: Encodable {
            var goal: String
            var context: ProposalContext
        }
        return try await AIBackend.invoke(
            "propose-automation",
            body: RequestBody(goal: goal, context: buildContext(garden: garden, zone: zone, plant: plant))
        )
    }

    private static func buildContext(garden: Garden?, zone: GardenZone?, plant: Plant?) -> ProposalContext {
        var sensors: [Sensor] = []
        var devices: [ConnectedDevice] = []
        var nameParts: [String] = []

        if let plant {
            sensors += plant.sensors
            nameParts.append(plant.customName)
        }
        if let zone {
            sensors += zone.sensors
            devices += zone.connectedDevices
            nameParts.append(zone.name)
        }
        if let garden {
            sensors += garden.sensors
            devices += garden.connectedDevices
            nameParts.append(garden.name)
        }

        return ProposalContext(
            scopeName: nameParts.isEmpty ? nil : nameParts.joined(separator: " › "),
            availableSensorTypes: Set(sensors.map(\.type.displayName)).sorted(),
            availableActionCapabilities: Set(devices.flatMap(\.capabilities).filter(\.isActuator).map(\.displayName)).sorted()
        )
    }

    /// Spec §71's "l'utilisateur doit valider explicitement avant
    /// activation": calling this at all — from the reviewed-proposal
    /// sheet's own explicit "Créer" button — is that validation step.
    /// AutomationRule.init already defaults `enabled` to false
    /// regardless of mode, so the rule created here can't run until the
    /// user separately, later, turns it on from the automations list.
    @discardableResult
    static func createRule(
        from proposal: AutomationProposal, garden: Garden?, zone: GardenZone?, plant: Plant?, context: ModelContext
    ) throws -> AutomationRule {
        let rule = AutomationRule(name: proposal.ruleName, mode: .manual, scopeGarden: garden, scopeZone: zone, scopePlant: plant)
        context.insert(rule)

        let condition = AutomationCondition(type: proposal.conditionType, order: 0)
        condition.numericThreshold = proposal.conditionThreshold
        condition.rule = rule
        context.insert(condition)

        if let secondType = proposal.resolvedSecondConditionType {
            let second = AutomationCondition(type: secondType, order: 1)
            second.numericThreshold = proposal.secondConditionThreshold
            second.rule = rule
            context.insert(second)
        }

        let action = AutomationAction(type: proposal.actionType, order: 0)
        if proposal.actionType.requiresDevice {
            let devices = zone?.connectedDevices ?? garden?.connectedDevices ?? []
            guard let matched = devices.first(where: { $0.hasCapability(actuatorCapability(for: proposal.actionType)) }) else {
                context.delete(rule) // cascades away the condition(s) just inserted above
                throw BuildError.noMatchingDevice
            }
            action.device = matched
        }
        if proposal.actionType.requiresDuration {
            // 1800s mirrors DeviceCommandService.hardMaxValveDurationSeconds,
            // but duplicated rather than referenced directly so this
            // service doesn't need MainActor isolation just to read a
            // constant — the real, unconditional enforcement of that
            // ceiling happens in DeviceCommandService itself at
            // execution time regardless of what's stored here.
            let requestedSeconds = (proposal.actionDurationMinutes ?? 8) * 60
            action.durationSeconds = min(requestedSeconds, 1800)
        }
        action.rule = rule
        context.insert(action)

        try context.save()
        return rule
    }

    private static func actuatorCapability(for actionType: AutomationActionType) -> DeviceCapability {
        switch actionType {
        case .openValve, .closeValve: return .valve
        case .startPump, .stopPump: return .pump
        case .turnFanOn, .turnFanOff: return .fan
        case .turnHeaterOn, .turnHeaterOff: return .heater
        case .turnMisterOn, .turnMisterOff: return .mister
        case .turnLightOn, .turnLightOff: return .light
        case .sendNotification, .createCareEvent: return .other // unreachable — requiresDevice is false for both
        }
    }
}
