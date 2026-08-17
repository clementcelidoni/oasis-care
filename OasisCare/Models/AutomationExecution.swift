import Foundation
import SwiftData

/// Spec §32 — one row per evaluation that actually fired (not every
/// polling tick, only real decisions), for §91's audit trail and the
/// "aurait déclenché" simulation display (Phase 5D builder UI).
/// Append-only, like CareEvent.
@Model
final class AutomationExecution {
    var id: UUID
    var rule: AutomationRule?
    var date: Date
    /// Human-readable snapshot of what was evaluated, e.g. "Humidité
    /// sol : 21 % (seuil 25 %) — Pluie prévue : 0 mm (seuil 5 mm)" — a
    /// plain string rather than structured data, since its only job is
    /// to be read by a person after the fact.
    var conditionsSummary: String
    var decision: Bool
    var actionSummary: String?
    var succeeded: Bool
    var errorMessage: String?
    var syncStatus: SyncStatus?

    init(rule: AutomationRule?, conditionsSummary: String, decision: Bool, actionSummary: String? = nil, succeeded: Bool, errorMessage: String? = nil) {
        self.id = UUID()
        self.rule = rule
        self.date = .now
        self.conditionsSummary = conditionsSummary
        self.decision = decision
        self.actionSummary = actionSummary
        self.succeeded = succeeded
        self.errorMessage = errorMessage
        self.syncStatus = .pendingCreate
    }
}
