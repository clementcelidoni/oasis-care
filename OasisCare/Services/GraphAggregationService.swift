import Foundation
import SwiftData

/// Spec §58-60/§93-94 — turns raw SensorReading rows into a graph-ready
/// series (downsampled for longer periods, since SensorReading "peut
/// devenir énorme" per §93) and resolves which real events (irrigation/
/// ventilation/heating/misting) can be superimposed on a given sensor's
/// graph.
///
/// The full server-side story §93 asks for — retention, partitioning,
/// materialized aggregate tables — is Postgres/ops infrastructure, not
/// client code; what's built here is the client-side half (query-time
/// downsampling, per §94's three bucket sizes) that keeps the graph
/// itself fast and light regardless of how much history exists. Actual
/// row-count capping/pruning at the database layer is a Phase 6 /
/// ops-configuration item.
///
/// Every fetch here reads a relationship array or an unfiltered
/// FetchDescriptor and filters in plain Swift afterwards, deliberately
/// avoiding #Predicate over optional relationship chains (e.g.
/// `$0.sensor?.id == id`) — this codebase's existing #Predicate usage
/// (RootTabView, SmartTagService) only ever targets simple scalar
/// properties, and SwiftData's support for relationship-traversal
/// predicates is untested territory here, matching the same caution
/// already applied to other uncertain SwiftData/HomeKit surfaces this
/// phase.
enum GraphAggregationService {
    struct ReadingPoint: Identifiable {
        let id = UUID()
        var date: Date
        var value: Double
    }

    struct Overlay: Identifiable {
        var id: EventOverlayKind { kind }
        var kind: EventOverlayKind
        var intervals: [DateInterval]
    }

    static func points(for sensor: Sensor, period: GraphPeriod, context: ModelContext) -> [ReadingPoint] {
        let lookback = period == .cycleComplete ? (cycleCompleteLookback(for: sensor) ?? period.lookback) : period.lookback
        let cutoff = Date.now.addingTimeInterval(-lookback)
        let readings = sensor.readings
            .filter { $0.timestamp >= cutoff }
            .sorted { $0.timestamp < $1.timestamp }

        guard let bucketSeconds = period.bucketSeconds else {
            return readings.map { ReadingPoint(date: $0.timestamp, value: $0.value) }
        }

        let grouped = Dictionary(grouping: readings) { reading in
            (reading.timestamp.timeIntervalSinceReferenceDate / bucketSeconds).rounded(.down) * bucketSeconds
        }
        return grouped.keys.sorted().map { bucketStart in
            let values = grouped[bucketStart]!.map(\.value)
            let average = values.reduce(0, +) / Double(values.count)
            return ReadingPoint(date: Date(timeIntervalSinceReferenceDate: bucketStart), value: average)
        }
    }

    /// Which overlay kinds make sense for this sensor, based on which
    /// greenhouse/irrigation zone (if any) actually uses it as one of
    /// their designated sensors — offered whenever the relevant actuator
    /// is linked, regardless of whether it has logged any events yet.
    static func availableOverlayKinds(for sensor: Sensor, context: ModelContext) -> [EventOverlayKind] {
        var kinds: [EventOverlayKind] = []
        if irrigationZone(for: sensor, context: context) != nil {
            kinds.append(.irrigation)
        }
        if let greenhouse = greenhouse(for: sensor, context: context) {
            if greenhouse.fanDevice != nil { kinds.append(.ventilation) }
            if greenhouse.heaterDevice != nil { kinds.append(.heating) }
            if greenhouse.misterDevice != nil { kinds.append(.misting) }
        }
        if sensor.bioreactor != nil {
            kinds.append(.immersion)
            kinds.append(.aeration)
        }
        return kinds
    }

    /// Spec Phase 7F — "Cycle complet" only makes sense, and is only
    /// offered, for a bioreactor sensor whose active program actually
    /// defines a usable interval — never guessed for anything else.
    static func availablePeriods(for sensor: Sensor) -> [GraphPeriod] {
        var periods = GraphPeriod.allCases.filter { $0 != .cycleComplete }
        if cycleCompleteLookback(for: sensor) != nil {
            periods.append(.cycleComplete)
        }
        return periods
    }

    /// One full repetition of whichever enabled cycle (immersion or
    /// aeration) repeats less often, so a "Cycle complet" window is
    /// guaranteed to contain at least one complete instance of both.
    private static func cycleCompleteLookback(for sensor: Sensor) -> TimeInterval? {
        guard let program = sensor.bioreactor?.activeProgramVersion else { return nil }
        var minutes: [Int] = []
        if program.immersionEnabled { minutes.append(program.immersionIntervalMinutes) }
        if program.aerationEnabled { minutes.append(program.aerationIntervalMinutes) }
        guard let longest = minutes.max(), longest > 0 else { return nil }
        return TimeInterval(longest * 60)
    }

    static func overlay(for kind: EventOverlayKind, sensor: Sensor, period: GraphPeriod, context: ModelContext) -> Overlay {
        let lookback = period == .cycleComplete ? (cycleCompleteLookback(for: sensor) ?? period.lookback) : period.lookback
        let windowStart = Date.now.addingTimeInterval(-lookback)
        let windowEnd = Date.now
        let intervals: [DateInterval]

        switch kind {
        case .irrigation:
            if let zone = irrigationZone(for: sensor, context: context) {
                intervals = zone.events.compactMap { event in
                    let end = event.date.addingTimeInterval(TimeInterval(event.durationMinutes) * 60)
                    return clamped(start: event.date, end: end, to: windowStart, windowEnd)
                }
            } else {
                intervals = []
            }
        case .ventilation, .heating, .misting:
            let device = greenhouse(for: sensor, context: context).flatMap { greenhouse -> ConnectedDevice? in
                switch kind {
                case .ventilation: return greenhouse.fanDevice
                case .heating: return greenhouse.heaterDevice
                case .misting: return greenhouse.misterDevice
                case .irrigation, .immersion, .aeration: return nil
                }
            }
            intervals = device.map {
                onOffIntervals(device: $0, windowStart: windowStart, windowEnd: windowEnd, context: context)
            } ?? []
        case .immersion, .aeration:
            let cycleType: BioreactorCycleType = kind == .immersion ? .immersion : .aeration
            if let bioreactor = sensor.bioreactor {
                let bioreactorID = bioreactor.id
                let executions = ((try? context.fetch(FetchDescriptor<BioreactorCycleExecution>())) ?? [])
                    .filter { $0.bioreactor?.id == bioreactorID && $0.cycleType == cycleType && $0.actualStart != nil }
                intervals = executions.compactMap { execution in
                    guard let start = execution.actualStart else { return nil }
                    let end = execution.actualEnd ?? (execution.status == .running ? .now : start)
                    return clamped(start: start, end: end, to: windowStart, windowEnd)
                }
            } else {
                intervals = []
            }
        }
        return Overlay(kind: kind, intervals: intervals)
    }

    private static func clamped(start: Date, end: Date, to windowStart: Date, _ windowEnd: Date) -> DateInterval? {
        guard end >= windowStart, start <= windowEnd else { return nil }
        let clampedStart = Swift.max(start, windowStart)
        let clampedEnd = Swift.min(end, windowEnd)
        guard clampedEnd >= clampedStart else { return nil }
        return DateInterval(start: clampedStart, end: clampedEnd)
    }

    /// Pairs each successful turnOn with the next successful turnOff for
    /// this device into "was active" intervals — an unterminated trailing
    /// turnOn (still on right now) extends to `.now`.
    private static func onOffIntervals(device: ConnectedDevice, windowStart: Date, windowEnd: Date, context: ModelContext) -> [DateInterval] {
        let deviceID = device.id
        let logs = ((try? context.fetch(FetchDescriptor<DeviceCommandLog>())) ?? [])
            .filter { $0.device?.id == deviceID && $0.succeeded }
            .sorted { $0.requestedAt < $1.requestedAt }

        var openedAt: Date?
        var raw: [(start: Date, end: Date)] = []
        for log in logs {
            switch log.command {
            case .turnOn:
                if openedAt == nil { openedAt = log.requestedAt }
            case .turnOff:
                if let start = openedAt {
                    raw.append((start, log.requestedAt))
                    openedAt = nil
                }
            default:
                break
            }
        }
        if let start = openedAt {
            raw.append((start, .now))
        }
        return raw.compactMap { clamped(start: $0.start, end: $0.end, to: windowStart, windowEnd) }
    }

    private static func irrigationZone(for sensor: Sensor, context: ModelContext) -> IrrigationZone? {
        let sensorID = sensor.id
        return ((try? context.fetch(FetchDescriptor<IrrigationZone>())) ?? [])
            .first { $0.soilSensor?.id == sensorID || $0.flowSensor?.id == sensorID }
    }

    private static func greenhouse(for sensor: Sensor, context: ModelContext) -> Greenhouse? {
        let sensorID = sensor.id
        return ((try? context.fetch(FetchDescriptor<Greenhouse>())) ?? [])
            .first {
                $0.temperatureSensor?.id == sensorID || $0.humiditySensor?.id == sensorID
                    || $0.lightSensor?.id == sensorID || $0.soilSensor?.id == sensorID
            }
    }
}
