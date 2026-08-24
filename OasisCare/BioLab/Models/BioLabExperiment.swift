import Foundation
import SwiftData

/// Spec Phase 7K — "BioLabExperiment... VARIABLE: identifier
/// explicitement independentVariables/controlledVariables/outcomes."
/// Free text for all three: spec asks for a dedicated place to name
/// them, not a structured/typed variable schema it never specifies —
/// inventing one would mean guessing at scientific structure spec
/// doesn't give.
@Model
final class BioLabExperiment: Syncable {
    var id: UUID
    var code: String
    var question: String
    var independentVariables: String
    var controlledVariables: String
    var outcomes: String
    var notes: String
    var startedAt: Date
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \ExperimentGroup.experiment)
    var groups: [ExperimentGroup] = []

    init(
        code: String, question: String, independentVariables: String = "", controlledVariables: String = "",
        outcomes: String = "", notes: String = "", startedAt: Date = .now
    ) {
        self.id = UUID()
        self.code = code
        self.question = question
        self.independentVariables = independentVariables
        self.controlledVariables = controlledVariables
        self.outcomes = outcomes
        self.notes = notes
        self.startedAt = startedAt
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}

/// Spec Phase 7K's own example — "Contrôle → Programme A, Test 1 →
/// Programme B..." — a group's condition is expressed as which program
/// version it runs; which batches are actually running under that
/// condition is expressed the other way, via CultureBatch.experimentGroup
/// (same "assign from the child record's own screen" convention as
/// Bioreactor.currentBatch/CultureBatch.mediumRecipeVersion), so
/// "moyenne/dispersion" per group can be computed from real batch data
/// rather than invented.
@Model
final class ExperimentGroup: Syncable {
    var id: UUID
    var name: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var experiment: BioLabExperiment?
    var programVersion: BioreactorProgramVersion?

    @Relationship(deleteRule: .nullify, inverse: \CultureBatch.experimentGroup)
    var batches: [CultureBatch] = []

    init(experiment: BioLabExperiment?, name: String, programVersion: BioreactorProgramVersion? = nil) {
        self.id = UUID()
        self.experiment = experiment
        self.name = name
        self.programVersion = programVersion
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
