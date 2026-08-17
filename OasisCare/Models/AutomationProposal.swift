import Foundation

/// Spec §71's structured response from propose-automation — an
/// ephemeral suggestion the user reviews and either discards or turns
/// into a real AutomationRule (see AutomationAIService.createRule);
/// never persisted itself.
struct AutomationProposal: Decodable {
    var canPropose: Bool
    var explanation: String
    var ruleName: String
    var conditionType: AutomationConditionType
    var conditionThreshold: Double?
    /// Raw string rather than `AutomationConditionType?` — the server's
    /// "no second condition" sentinel is the literal string "none",
    /// which isn't a real case and would fail to decode as one.
    var secondConditionType: String
    var secondConditionThreshold: Double?
    var actionType: AutomationActionType
    var actionDurationMinutes: Double?
    var summary: String

    var resolvedSecondConditionType: AutomationConditionType? {
        AutomationConditionType(rawValue: secondConditionType)
    }
}
