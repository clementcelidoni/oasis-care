import Foundation

/// What's sent to compare-biolab-performance for one side of a
/// comparison — spec Phase 7I's own example (BR03/BR04: immersion,
/// température moyenne, recette, multiplication). Built from a
/// bioreactor's current configuration and whichever batch currently
/// occupies it, since that's what the spec's example actually compares
/// (an operational snapshot, not two arbitrary historical batches).
struct BioLabComparisonSubject: Encodable {
    var code: String
    var bioreactorType: String
    var immersionSummary: String?
    var aerationSummary: String?
    var averageTemperature: Double?
    var currentBatchCode: String?
    var recipeVersion: Int?
    var multiplicationRate: Double?

    static func build(for bioreactor: Bioreactor) -> BioLabComparisonSubject {
        var immersionSummary: String?
        var aerationSummary: String?
        if let program = bioreactor.activeProgramVersion {
            if program.immersionEnabled {
                immersionSummary = "\(program.immersionDurationSeconds) s toutes les \(program.immersionIntervalMinutes) min"
            }
            if program.aerationEnabled {
                aerationSummary = "\(program.aerationDurationSeconds) s toutes les \(program.aerationIntervalMinutes) min"
            }
        }

        let temperatures = bioreactor.sensors
            .filter { $0.type == .mediumTemperature || $0.type == .airTemperature }
            .compactMap { $0.latestReading?.value }
        let averageTemperature = temperatures.isEmpty ? nil : temperatures.reduce(0, +) / Double(temperatures.count)

        let batch = bioreactor.currentBatch
        let multiplicationRate = batch.flatMap { batch -> Double? in
            guard batch.initialExplantCount > 0 else { return nil }
            return Double(batch.currentCount) / Double(batch.initialExplantCount)
        }

        return BioLabComparisonSubject(
            code: bioreactor.code, bioreactorType: bioreactor.bioreactorType.label,
            immersionSummary: immersionSummary, aerationSummary: aerationSummary,
            averageTemperature: averageTemperature, currentBatchCode: batch?.batchCode,
            recipeVersion: batch?.mediumRecipeVersion?.versionNumber, multiplicationRate: multiplicationRate
        )
    }
}

/// Decoded response from compare-biolab-performance. Spec Phase 7I's own
/// CRITIQUE — "pas de causalité inventée" — is why this has no "cause"
/// field at all: `differences` are plainly observed facts, `hypotheses`
/// are always phrased as something "à tester," never a stated cause.
struct BioLabComparisonResult: Codable {
    var differences: [String]?
    var hypotheses: [String]?
    var confidence: String?
    var provider: String?
    var model: String?

    var confidenceLevel: AIConfidence {
        AIConfidence(rawValue: confidence ?? "") ?? .unknown
    }
}
