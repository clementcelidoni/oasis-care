import Foundation
import SwiftData

/// Spec Phase 7E — cycle scheduling, execution journaling, and the
/// CRITIQUE safety watchdog, all in one place so the watchdog can never
/// be bypassed by a code path that starts a cycle some other way.
///
/// ## The foreground-only limitation — read before relying on this
///
/// `tick(...)` must be called periodically while the app is open (see
/// BioLabDashboardView's `.task`) to do anything at all — starting,
/// stopping, or timing out a cycle. This app has no true background
/// daemon, the same documented limitation as Phase 5's AutomationEngine
/// ("évalué uniquement au premier plan"): iOS does not grant a normal
/// app reliable, guaranteed background execution on the schedule a
/// biological safety watchdog needs, and neither BackgroundTasks
/// (best-effort, not guaranteed to fire) nor a server-side scheduled
/// function (which would violate spec's own "ne jamais dépendre du
/// cloud pour... déclencher un timeout de sécurité") are acceptable
/// substitutes for a real safety ceiling.
///
/// This is exactly why spec itself says "préférer un contrôleur local
/// lorsque l'équipement le permet": if a bioreactor's own hardware
/// (or its ConnectedDevice) has its own onboard timer or safety cutoff,
/// that is the actual safety mechanism for immersion/aeration duration
/// — this scheduler is a convenience layer and a *software* safety net
/// on top, not a substitute for hardware that can enforce a limit even
/// while this iPhone is locked or the app is closed. Every screen that
/// lets the user configure `maxImmersionDurationSeconds`/
/// `maxAerationDurationSeconds` says this explicitly.
enum BioreactorCycleScheduler {
    /// Missed-cycle grace window before a not-yet-started due cycle is
    /// logged as missed rather than merely "a bit late" — generous on
    /// purpose, since a phone being briefly closed shouldn't spam
    /// missed-cycle alerts the moment the app reopens a few minutes
    /// late.
    static let missedCycleGraceSeconds: TimeInterval = 30 * 60

    static func nextCycleDate(type: BioreactorCycleType, program: BioreactorProgramVersion, lastCycleStart: Date, now: Date = .now) -> Date? {
        let enabled = type == .immersion ? program.immersionEnabled : program.aerationEnabled
        guard enabled else { return nil }
        let intervalMinutes = type == .immersion ? program.immersionIntervalMinutes : program.aerationIntervalMinutes
        guard intervalMinutes > 0 else { return nil }
        return Calendar.current.date(byAdding: .minute, value: intervalMinutes, to: lastCycleStart)
    }

    private static func expectedDuration(type: BioreactorCycleType, program: BioreactorProgramVersion) -> Int {
        type == .immersion ? program.immersionDurationSeconds : program.aerationDurationSeconds
    }

    private static func maxDuration(type: BioreactorCycleType, program: BioreactorProgramVersion) -> Int {
        type == .immersion ? program.maxImmersionDurationSeconds : program.maxAerationDurationSeconds
    }

    /// `actuate` is the only bridge to real hardware. `true` means
    /// "start," `false` means "stop." BioLabDashboardView wires this to
    /// BioreactorController.actuateCycle, which itself no-ops for any
    /// bioreactor without automationEnabled or without an air pump
    /// bound — every other guarantee here (the watchdog, the journal,
    /// the missed-cycle alert) stays fully real either way, it just
    /// never claims a pump moved.
    static func tick(bioreactors: [Bioreactor], executions: [BioreactorCycleExecution], now: Date = .now, actuate: (BioreactorCycleExecution, Bool) -> Void, context: ModelContext) {
        for bioreactor in bioreactors {
            guard let program = bioreactor.activeProgramVersion else { continue }
            let bioreactorExecutions = executions.filter { $0.bioreactor?.id == bioreactor.id }
            for type in BioreactorCycleType.allCases {
                tickOneType(bioreactor: bioreactor, program: program, type: type, executions: bioreactorExecutions, now: now, actuate: actuate, context: context)
            }
        }
    }

    private static func tickOneType(
        bioreactor: Bioreactor, program: BioreactorProgramVersion, type: BioreactorCycleType,
        executions: [BioreactorCycleExecution], now: Date, actuate: (BioreactorCycleExecution, Bool) -> Void, context: ModelContext
    ) {
        let typedExecutions = executions.filter { $0.cycleType == type }

        // 1. Watchdog first, unconditionally — a cycle stuck past its
        // absolute maximum gets force-stopped before anything else runs,
        // regardless of what "normal completion" below would have done.
        if let running = typedExecutions.first(where: { $0.status == .running }), let start = running.actualStart {
            let elapsed = now.timeIntervalSince(start)
            let maxSeconds = Double(maxDuration(type: type, program: program))
            if elapsed >= maxSeconds {
                actuate(running, false)
                running.actualEnd = now
                running.actualDurationSeconds = Int(elapsed)
                running.status = .timeout
                running.failureReason = "Durée maximale de sécurité atteinte (\(maxDuration(type: type, program: program)) s) — arrêt forcé."
                running.updatedAt = .now
                BioLabAlertService.raise(
                    .cycleTooLong, priority: .critical,
                    message: "\(bioreactor.code) : \(type.label.lowercased()) arrêtée après dépassement de la durée maximale de sécurité.",
                    bioreactor: bioreactor, context: context
                )
                return
            }
            if elapsed >= Double(expectedDuration(type: type, program: program)) {
                actuate(running, false)
                running.actualEnd = now
                running.actualDurationSeconds = Int(elapsed)
                running.status = .completed
                running.updatedAt = .now
            }
            // Still running within its expected window — nothing else to do this tick.
            return
        }

        // 2. Spec Phase 7G — "AUTOMATIC MODE: l'utilisateur doit activer
        // explicitement," and pausing (the existing Statut picker's
        // `.paused` case) must stop new cycles from being scheduled at
        // all, not just stop actuation. The watchdog above still always
        // runs regardless — pausing future scheduling must never weaken
        // the safety cutoff on a cycle already in flight.
        guard bioreactor.automationEnabled, bioreactor.status != .paused else { return }

        // 3. Nothing running: is a new cycle due, or was one missed?
        // Anchored on plannedStart, not actualStart: a missed cycle
        // never gets an actualStart, and anchoring on actualStart would
        // leave the schedule stuck recomputing the same missed slot
        // forever instead of advancing to the next one. Also floored on
        // scheduleResumedAt (Phase 7G's "reprise doit recalculer
        // proprement le planning") so a bioreactor that was paused or
        // deactivated for a long time doesn't come back to a backlog of
        // synthetic missed cycles — the moment it resumes becomes the
        // new baseline instead of whatever the schedule was before.
        let lastStart = max(
            typedExecutions.map(\.plannedStart).max() ?? bioreactor.createdAt,
            bioreactor.scheduleResumedAt ?? .distantPast
        )
        guard let due = nextCycleDate(type: type, program: program, lastCycleStart: lastStart, now: now) else { return }
        guard now >= due else { return }

        let alreadyLogged = typedExecutions.contains { $0.plannedStart == due }
        guard !alreadyLogged else { return }

        if now.timeIntervalSince(due) >= missedCycleGraceSeconds {
            let missed = BioreactorCycleExecution(
                bioreactor: bioreactor, programVersion: program, cycleType: type,
                plannedStart: due, expectedDurationSeconds: expectedDuration(type: type, program: program)
            )
            missed.status = .failed
            missed.failureReason = "Cycle manqué — l'application n'était pas ouverte au moment prévu."
            context.insert(missed)
            BioLabAlertService.raise(
                .missedCycle, priority: .warning,
                message: "\(bioreactor.code) : \(type.label.lowercased()) manquée (prévue \(due.formatted(date: .omitted, time: .shortened))).",
                bioreactor: bioreactor, context: context
            )
            return
        }

        let execution = BioreactorCycleExecution(
            bioreactor: bioreactor, programVersion: program, cycleType: type,
            plannedStart: due, expectedDurationSeconds: expectedDuration(type: type, program: program)
        )
        execution.actualStart = now
        execution.status = .running
        context.insert(execution)
        actuate(execution, true)
    }
}
