import Foundation
import SwiftData

/// Spec §61-65 — detects device/sensor problems worth surfacing, the
/// same "computed fresh, never persisted" shape as GardenInsightService
/// (Phase 4A/4H): every HealthAlert here is recomputed on demand from
/// data the app already has; nothing is stored as its own SwiftData
/// model. What IS persisted is only a device-local "already notified"
/// marker (HealthAlertNotificationTracker), matching WeatherCache's
/// non-synced pattern.
///
/// @MainActor because irrigationFlowAlerts reads IrrigationController's
/// checks, which are themselves MainActor-isolated (they read
/// DeviceCommandService.shared.activeValves) — matches every other
/// caller of those checks, since this is only ever invoked from
/// SwiftUI view code (HomeView.task, the same foreground-only cadence
/// already used for AutomationEngine/GreenhouseClimateService).
@MainActor
enum DeviceHealthService {
    struct HealthAlert: Identifiable {
        var id: String { dedupeKey }
        var dedupeKey: String
        var kind: HealthAlertKind
        var level: AlertLevel
        var title: String
        var subtitle: String
        var device: ConnectedDevice?
        var sensor: Sensor?
    }

    private static let stuckValueMinimumReadings = 5
    private static let stuckValueMinimumSpan: TimeInterval = 3 * 3600
    private static let consumptionAnomalyRatioThreshold = 0.35
    private static let trendMinimumHistoryDays = 21
    private static let trendRecentWindowDays = 5
    private static let trendSpikeRatio = 2.0

    static func evaluate(devices: [ConnectedDevice], sensors: [Sensor], irrigationZones: [IrrigationZone]) -> [HealthAlert] {
        var alerts: [HealthAlert] = []
        alerts.append(contentsOf: deviceOfflineAlerts(devices: devices))
        alerts.append(contentsOf: sensorAlerts(sensors: sensors))
        alerts.append(contentsOf: irrigationFlowAlerts(zones: irrigationZones))
        return alerts.sorted { $0.level > $1.level }
    }

    /// Spec §65 — groups newly-surfaced alerts by kind before notifying
    /// (one notification for "3 capteurs sans données", not three
    /// identical-shaped ones) and skips anything already notified
    /// within the last 24h via HealthAlertNotificationTracker.
    static func notifyIfNeeded(_ alerts: [HealthAlert]) {
        let newOnes = alerts.filter { !HealthAlertNotificationTracker.wasRecentlyNotified($0.dedupeKey) }
        guard !newOnes.isEmpty else { return }

        for (kind, group) in Dictionary(grouping: newOnes, by: \.kind) {
            if group.count == 1, let alert = group.first {
                NotificationService.sendImmediate(title: alert.title, body: alert.subtitle)
            } else {
                let names = group.prefix(3).map(\.title).joined(separator: ", ")
                NotificationService.sendImmediate(
                    title: kind.displayName,
                    body: "\(group.count) éléments concernés : \(names)\(group.count > 3 ? "…" : "")"
                )
            }
            for alert in group { HealthAlertNotificationTracker.markNotified(alert.dedupeKey) }
        }
    }

    // MARK: - Device checks

    private static func deviceOfflineAlerts(devices: [ConnectedDevice]) -> [HealthAlert] {
        devices.filter { !$0.online && $0.garden != nil }.map { device in
            HealthAlert(
                dedupeKey: "deviceOffline-\(device.id.uuidString)",
                kind: .deviceOffline, level: .warning,
                title: device.name, subtitle: "Appareil hors ligne", device: device, sensor: nil
            )
        }
    }

    // MARK: - Sensor checks

    private static func sensorAlerts(sensors: [Sensor]) -> [HealthAlert] {
        var alerts: [HealthAlert] = []
        for sensor in sensors where sensor.enabled {
            if sensor.isStale {
                alerts.append(HealthAlert(
                    dedupeKey: "staleSensor-\(sensor.id.uuidString)",
                    kind: .staleSensor, level: .warning,
                    title: sensor.name, subtitle: "Aucune donnée depuis plus de 6 h", device: sensor.device, sensor: sensor
                ))
            }
            if let impossible = impossibleValueAlert(sensor) { alerts.append(impossible) }
            if isStuck(sensor) {
                alerts.append(HealthAlert(
                    dedupeKey: "stuckValue-\(sensor.id.uuidString)",
                    kind: .stuckValue, level: .warning,
                    title: sensor.name, subtitle: "Valeur inchangée depuis plusieurs lectures", device: sensor.device, sensor: sensor
                ))
            }
            if let anomaly = consumptionAnomalyAlert(sensor) { alerts.append(anomaly) }
            if let trend = trendAlert(sensor) { alerts.append(trend) }
        }
        return alerts
    }

    private static func impossibleValueAlert(_ sensor: Sensor) -> HealthAlert? {
        guard let latest = sensor.latestReading else { return nil }
        let tooLow = sensor.minimumExpected.map { latest.value < $0 } ?? false
        let tooHigh = sensor.maximumExpected.map { latest.value > $0 } ?? false
        guard tooLow || tooHigh else { return nil }
        return HealthAlert(
            dedupeKey: "impossibleValue-\(sensor.id.uuidString)",
            kind: .impossibleValue, level: .important,
            title: sensor.name,
            subtitle: "Valeur \(latest.value.formatted()) \(sensor.unit) hors de la plage attendue",
            device: sensor.device, sensor: sensor
        )
    }

    /// A real sensor's raw readings essentially never repeat to the
    /// exact same Double across several lectures spread over hours by
    /// chance — this many identical values in a row is a stuck/frozen
    /// reading, not genuine stability.
    private static func isStuck(_ sensor: Sensor) -> Bool {
        let recent = sensor.readings.sorted { $0.timestamp > $1.timestamp }.prefix(stuckValueMinimumReadings)
        guard recent.count == stuckValueMinimumReadings,
              let newest = recent.first, let oldest = recent.last,
              newest.timestamp.timeIntervalSince(oldest.timestamp) >= stuckValueMinimumSpan
        else { return false }
        return Set(recent.map(\.value)).count == 1
    }

    /// Spec §62's own example ("Pompe bassin: débit inférieur de 45 % à
    /// la moyenne habituelle") — scoped to flow/energy sensors, the two
    /// types that actually represent a literal consumption/throughput
    /// figure rather than an ambient reading. Same last-7-days-vs-
    /// prior-7-days windowing as GardenInsightService's water-anomaly
    /// check, for consistency.
    private static func consumptionAnomalyAlert(_ sensor: Sensor) -> HealthAlert? {
        guard sensor.type == .waterFlow || sensor.type == .energyConsumption else { return nil }
        let now = Date.now
        guard let weekAgo = Calendar.current.date(byAdding: .day, value: -7, to: now),
              let twoWeeksAgo = Calendar.current.date(byAdding: .day, value: -14, to: now) else { return nil }
        let recent = sensor.readings.filter { $0.timestamp >= weekAgo }
        let prior = sensor.readings.filter { $0.timestamp >= twoWeeksAgo && $0.timestamp < weekAgo }
        guard !recent.isEmpty, !prior.isEmpty else { return nil }
        let recentAvg = recent.map(\.value).reduce(0, +) / Double(recent.count)
        let priorAvg = prior.map(\.value).reduce(0, +) / Double(prior.count)
        guard priorAvg > 0 else { return nil }
        let deviation = (recentAvg - priorAvg) / priorAvg
        guard abs(deviation) >= consumptionAnomalyRatioThreshold else { return nil }
        let percent = Int((abs(deviation) * 100).rounded())
        let direction = deviation < 0 ? "inférieure de \(percent) %" : "supérieure de \(percent) %"
        return HealthAlert(
            dedupeKey: "abnormalConsumption-\(sensor.id.uuidString)",
            kind: .abnormalConsumption, level: .important,
            title: sensor.name, subtitle: "\(direction) à la moyenne habituelle",
            device: sensor.device, sensor: sensor
        )
    }

    /// Spec §63's own example ("le sol sèche beaucoup plus rapidement
    /// depuis 5 jours") — scoped to humidity-like types, where "drying"
    /// is a meaningful concept. Compares the average daily drop over the
    /// last 5 days against the average daily drop over the preceding
    /// ~2.5 weeks; flags only when the recent drop is genuinely
    /// positive (still drying, not recovering) and at least double the
    /// established baseline rate.
    private static func trendAlert(_ sensor: Sensor) -> HealthAlert? {
        guard sensor.type == .soilMoisture || sensor.type == .airHumidity else { return nil }
        let now = Date.now
        let calendar = Calendar.current
        guard let recentStart = calendar.date(byAdding: .day, value: -trendRecentWindowDays, to: now),
              let baselineStart = calendar.date(byAdding: .day, value: -trendMinimumHistoryDays, to: now) else { return nil }

        let sorted = sensor.readings.sorted { $0.timestamp < $1.timestamp }
        guard let oldest = sorted.first?.timestamp, oldest <= baselineStart else { return nil }
        guard let recentDrop = averageDailyDrop(sorted, from: recentStart, to: now),
              let baselineDrop = averageDailyDrop(sorted, from: baselineStart, to: recentStart) else { return nil }
        guard recentDrop > 0, baselineDrop > 0, recentDrop >= baselineDrop * trendSpikeRatio else { return nil }

        return HealthAlert(
            dedupeKey: "unusualTrend-\(sensor.id.uuidString)",
            kind: .unusualTrend, level: .warning,
            title: sensor.name,
            subtitle: "Baisse beaucoup plus rapide que d'habitude depuis \(trendRecentWindowDays) jours",
            device: sensor.device, sensor: sensor
        )
    }

    /// Average per-day drop between the first and last reading actually
    /// found inside [start, end) — a plain two-point slope is enough to
    /// catch "much faster than usual" (the spec's own bar) without
    /// overfitting noisy sensor data with a full regression.
    private static func averageDailyDrop(_ sorted: [SensorReading], from start: Date, to end: Date) -> Double? {
        let inWindow = sorted.filter { $0.timestamp >= start && $0.timestamp < end }
        guard let first = inWindow.first, let last = inWindow.last, first.timestamp < last.timestamp else { return nil }
        let days = last.timestamp.timeIntervalSince(first.timestamp) / 86400
        guard days > 0 else { return nil }
        return (first.value - last.value) / days
    }

    // MARK: - Irrigation flow checks (spec §61's "débit incohérent")

    private static func irrigationFlowAlerts(zones: [IrrigationZone]) -> [HealthAlert] {
        var alerts: [HealthAlert] = []
        for zone in zones {
            if IrrigationController.isPotentiallyIneffective(zone) {
                alerts.append(HealthAlert(
                    dedupeKey: "incoherentFlow-\(zone.id.uuidString)",
                    kind: .incoherentFlow, level: .important,
                    title: "Zone \(zone.name)", subtitle: "Arrosage actif mais aucun débit détecté",
                    device: zone.valveDevice, sensor: zone.flowSensor
                ))
            }
            if IrrigationController.hasUnexpectedFlow(zone) {
                alerts.append(HealthAlert(
                    dedupeKey: "unexpectedFlow-\(zone.id.uuidString)",
                    kind: .incoherentFlow, level: .important,
                    title: "Zone \(zone.name)", subtitle: "Débit détecté alors qu'aucun arrosage n'est actif",
                    device: zone.valveDevice, sensor: zone.flowSensor
                ))
            }
        }
        return alerts
    }
}
