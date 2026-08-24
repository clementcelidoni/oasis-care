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

    /// Raises `type` if `isActive` and none exists yet, or resolves the
    /// existing one if `isActive` just became false — the shared shape
    /// every periodic detector below uses, so "the condition cleared" is
    /// always handled the same way instead of leaving stale alerts
    /// around forever (nothing called `resolve` anywhere before this).
    private static func updateAlert(
        _ type: BioLabAlertType, isActive: Bool, priority: BioLabAlertPriority, message: @autoclosure () -> String,
        bioreactor: Bioreactor?, cultureBatch: CultureBatch? = nil, context: ModelContext
    ) {
        let existing = (try? context.fetch(FetchDescriptor<BioLabAlert>()))?.first {
            $0.alertType == type && $0.isActive && $0.bioreactor?.id == bioreactor?.id && $0.cultureBatch?.id == cultureBatch?.id
        }
        if isActive {
            guard existing == nil else { return }
            let alert = BioLabAlert(alertType: type, priority: priority, message: message(), bioreactor: bioreactor, cultureBatch: cultureBatch)
            context.insert(alert)
        } else if let existing {
            resolve(existing)
        }
    }

    /// Spec "ALERTES — détecter : pompe non répondante, pression
    /// anormale, débit anormal, niveau de milieu anormal, capteur
    /// offline, température hors seuil, inspection en retard." Called
    /// periodically from the same 30s loop as BioreactorCycleScheduler.tick
    /// (BioLabDashboardView) — same foreground-only limitation applies.
    /// "changement de milieu prévu" is deliberately not detected: no
    /// medium-change interval/schedule concept exists anywhere in this
    /// app to check against, and inventing one would mean guessing at a
    /// protocol number spec never gives.
    static func scan(bioreactors: [Bioreactor], activeBatches: [CultureBatch], context: ModelContext) {
        for bioreactor in bioreactors {
            scanSensors(for: bioreactor, context: context)
            scanPump(for: bioreactor, context: context)
        }
        for batch in activeBatches {
            scanInspectionRecency(for: batch, context: context)
        }
    }

    private static func isOutOfRange(_ sensor: Sensor) -> Bool {
        guard let value = sensor.latestReading?.value else { return false }
        if let minimum = sensor.minimumExpected, value < minimum { return true }
        if let maximum = sensor.maximumExpected, value > maximum { return true }
        return false
    }

    private static func scanSensors(for bioreactor: Bioreactor, context: ModelContext) {
        updateAlert(
            .sensorOffline, isActive: bioreactor.sensors.contains { $0.isStale }, priority: .warning,
            message: "\(bioreactor.code) : au moins un capteur n'a pas transmis de mesure récente.",
            bioreactor: bioreactor, context: context
        )

        let pressureSensors = bioreactor.sensors.filter { $0.type == .pressure }
        updateAlert(
            .abnormalPressure, isActive: pressureSensors.contains(where: isOutOfRange), priority: .warning,
            message: "\(bioreactor.code) : pression hors de la plage attendue.", bioreactor: bioreactor, context: context
        )

        let flowSensors = bioreactor.sensors.filter { $0.type == .airFlow || $0.type == .liquidFlow }
        updateAlert(
            .abnormalFlow, isActive: flowSensors.contains(where: isOutOfRange), priority: .warning,
            message: "\(bioreactor.code) : débit hors de la plage attendue.", bioreactor: bioreactor, context: context
        )

        let levelSensors = bioreactor.sensors.filter { $0.type == .liquidLevel }
        updateAlert(
            .abnormalMediumLevel, isActive: levelSensors.contains(where: isOutOfRange), priority: .warning,
            message: "\(bioreactor.code) : niveau de milieu hors de la plage attendue.", bioreactor: bioreactor, context: context
        )

        let temperatureSensors = bioreactor.sensors.filter { $0.type == .mediumTemperature || $0.type == .airTemperature }
        updateAlert(
            .temperatureOutOfRange, isActive: temperatureSensors.contains(where: isOutOfRange), priority: .important,
            message: "\(bioreactor.code) : température hors du seuil attendu.", bioreactor: bioreactor, context: context
        )
    }

    /// "Non répondante" — the air pump's own two most recent commands
    /// (whatever triggered them, manual test or automation) both failed.
    /// A single failed attempt isn't enough to call a pump unresponsive;
    /// two in a row is a much stronger signal without waiting so long
    /// the alert becomes useless.
    private static func scanPump(for bioreactor: Bioreactor, context: ModelContext) {
        guard let device = bioreactor.deviceBindings.first(where: { $0.role == .airPump })?.device else {
            updateAlert(.unresponsivePump, isActive: false, priority: .critical, message: "", bioreactor: bioreactor, context: context)
            return
        }
        let recentLogs = ((try? context.fetch(FetchDescriptor<DeviceCommandLog>())) ?? [])
            .filter { $0.device?.id == device.id }
            .sorted { $0.requestedAt > $1.requestedAt }
            .prefix(2)
        let allFailed = recentLogs.count == 2 && recentLogs.allSatisfy { !$0.succeeded }
        updateAlert(
            .unresponsivePump, isActive: allFailed, priority: .critical,
            message: "\(bioreactor.code) : la pompe à air n'a pas répondu aux deux dernières commandes.",
            bioreactor: bioreactor, context: context
        )
    }

    /// No inspection at all after two weeks of activity — deliberately
    /// not a shorter, species/stage-specific interval, which this app
    /// has no real basis to pick without inventing a protocol number.
    private static let lateInspectionThresholdDays = 14

    private static func scanInspectionRecency(for batch: CultureBatch, context: ModelContext) {
        let daysSinceStart = Calendar.current.dateComponents([.day], from: batch.startedAt, to: .now).day ?? 0
        let isLate = batch.inspections.isEmpty && daysSinceStart >= lateInspectionThresholdDays
        updateAlert(
            .lateInspection, isActive: isLate, priority: .info,
            message: "Lot \(batch.batchCode) : aucune inspection enregistrée depuis \(daysSinceStart) jours.",
            bioreactor: nil, cultureBatch: batch, context: context
        )
    }

    /// Spec's own CRITIQUE (Phase 7H/7I) already means contaminationStatus
    /// is always a human's own judgment — this only turns that judgment
    /// into a visible alert, called from BioreactorInspectionFormView at
    /// save time rather than the periodic scan above (it's an event, not
    /// a condition to keep re-checking).
    static func reportContaminationIfNeeded(_ inspection: BioreactorInspection, context: ModelContext) {
        switch inspection.contaminationStatus {
        case .confirmed:
            raise(
                .suspectedContamination, priority: .critical,
                message: "Lot \(inspection.cultureBatch?.batchCode ?? "?") : contamination confirmée.",
                bioreactor: inspection.bioreactor, cultureBatch: inspection.cultureBatch, context: context
            )
        case .suspected:
            raise(
                .suspectedContamination, priority: .warning,
                message: "Lot \(inspection.cultureBatch?.batchCode ?? "?") : contamination suspectée.",
                bioreactor: inspection.bioreactor, cultureBatch: inspection.cultureBatch, context: context
            )
        case .noneObserved, .unknown:
            break
        }
    }
}
