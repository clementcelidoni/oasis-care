import Foundation
import SwiftData

/// Spec Phase 7E — "Un programme doit être versionné." Same immutable-
/// version discipline as MediumRecipeVersion (Phase 7C): no "edit
/// version" UI exists, only "create a new version," so a
/// BioreactorCycleExecution's programVersion reference always reflects
/// exactly what ran, no matter how many newer versions the program
/// later gains.
@Model
final class BioreactorProgram: Syncable {
    var id: UUID
    var name: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \BioreactorProgramVersion.program)
    var versions: [BioreactorProgramVersion] = []

    init(name: String) {
        self.id = UUID()
        self.name = name
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var latestVersion: BioreactorProgramVersion? {
        versions.max { $0.versionNumber < $1.versionNumber }
    }
}

/// `maxImmersionDurationSeconds`/`maxAerationDurationSeconds`: spec's
/// own CRITIQUE — "le système ne doit jamais pouvoir rester
/// indéfiniment dans un état d'immersion." Enforced independently of
/// the "normal" expected duration by BioreactorCycleScheduler's
/// watchdog check — see that service's own doc comment for the
/// foreground-only limitation this app has no way around.
@Model
final class BioreactorProgramVersion: Syncable {
    var id: UUID
    var versionNumber: Int
    var immersionEnabled: Bool
    var immersionDurationSeconds: Int
    var immersionIntervalMinutes: Int
    var aerationEnabled: Bool
    var aerationDurationSeconds: Int
    var aerationIntervalMinutes: Int
    var photoperiodEnabled: Bool
    var lightStartMinutesSinceMidnight: Int?
    var lightEndMinutesSinceMidnight: Int?
    var targetTemperature: Double?
    var maxImmersionDurationSeconds: Int
    var maxAerationDurationSeconds: Int
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var program: BioreactorProgram?

    init(
        program: BioreactorProgram?, versionNumber: Int,
        immersionEnabled: Bool, immersionDurationSeconds: Int, immersionIntervalMinutes: Int,
        aerationEnabled: Bool, aerationDurationSeconds: Int, aerationIntervalMinutes: Int,
        photoperiodEnabled: Bool = false, lightStartMinutesSinceMidnight: Int? = nil, lightEndMinutesSinceMidnight: Int? = nil,
        targetTemperature: Double? = nil, maxImmersionDurationSeconds: Int, maxAerationDurationSeconds: Int,
        notes: String = ""
    ) {
        self.id = UUID()
        self.program = program
        self.versionNumber = versionNumber
        self.immersionEnabled = immersionEnabled
        self.immersionDurationSeconds = immersionDurationSeconds
        self.immersionIntervalMinutes = immersionIntervalMinutes
        self.aerationEnabled = aerationEnabled
        self.aerationDurationSeconds = aerationDurationSeconds
        self.aerationIntervalMinutes = aerationIntervalMinutes
        self.photoperiodEnabled = photoperiodEnabled
        self.lightStartMinutesSinceMidnight = lightStartMinutesSinceMidnight
        self.lightEndMinutesSinceMidnight = lightEndMinutesSinceMidnight
        self.targetTemperature = targetTemperature
        self.maxImmersionDurationSeconds = maxImmersionDurationSeconds
        self.maxAerationDurationSeconds = maxAerationDurationSeconds
        self.notes = notes
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
