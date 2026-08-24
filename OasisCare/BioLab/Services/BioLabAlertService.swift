import Foundation
import SwiftData

/// Spec's "ALERTES" section — "déduplication: ne pas envoyer 30 fois la
/// même alerte." `raise` is the single entry point every detector in
/// this app should call (BioreactorCycleScheduler now, sensor/
/// inspection detectors from Phase 7F/7H later) so this one dedup rule
/// applies everywhere, rather than each detector reimplementing it.
enum BioLabAlertService {
    /// Creates a new alert unless an unresolved one of the same
    /// (type, bioreactor) already exists — that existing alert is left
    /// alone rather than duplicated or its message overwritten.
    @discardableResult
    static func raise(_ type: BioLabAlertType, priority: BioLabAlertPriority, message: String, bioreactor: Bioreactor? = nil, cultureBatch: CultureBatch? = nil, context: ModelContext) -> BioLabAlert? {
        let existing = (try? context.fetch(FetchDescriptor<BioLabAlert>()))?.first {
            $0.alertType == type && $0.isActive && $0.bioreactor?.id == bioreactor?.id && $0.cultureBatch?.id == cultureBatch?.id
        }
        guard existing == nil else { return nil }
        let alert = BioLabAlert(alertType: type, priority: priority, message: message, bioreactor: bioreactor, cultureBatch: cultureBatch)
        context.insert(alert)
        return alert
    }

    static func resolve(_ alert: BioLabAlert) {
        alert.resolvedAt = .now
        alert.markDirty()
    }
}
