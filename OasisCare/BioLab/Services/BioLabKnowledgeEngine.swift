import Foundation

/// Enhancement Phase 7P — "capitaliser les résultats obtenus DANS le
/// laboratoire de l'utilisateur." Computes real, observed performance
/// per recipe version from this workspace's own batches — same
/// nil-vs-real-zero discipline as `BioLabAnalyticsService`, just keyed
/// by recipe version instead of species. Deliberately workspace-private
/// data (§24 "NE PAS CONFONDRE SAVOIR GLOBAL ET DONNÉES INTERNES") —
/// nothing here is ever sent anywhere outside this workspace's own sync.
enum BioLabKnowledgeEngine {
    /// One entry per version that has at least one batch using it —
    /// a version nobody has used yet simply has no entry, not a
    /// zero-filled one.
    static func performance(
        for versions: [MediumRecipeVersion], batches: [CultureBatch], acclimatizationBatches: [AcclimatizationBatch]
    ) -> [RecipeVersionPerformance] {
        versions.compactMap { version in
            let versionBatches = batches.filter { $0.mediumRecipeVersion?.id == version.id }
            guard !versionBatches.isEmpty else { return nil }
            return performance(versionId: version.id, batches: versionBatches, acclimatizationBatches: acclimatizationBatches)
        }
    }

    private static func performance(
        versionId: UUID, batches: [CultureBatch], acclimatizationBatches: [AcclimatizationBatch]
    ) -> RecipeVersionPerformance {
        let multiplicationRatios = batches.compactMap { batch -> Double? in
            guard batch.initialExplantCount > 0 else { return nil }
            return Double(batch.currentCount) / Double(batch.initialExplantCount)
        }
        let averageMultiplicationRate = multiplicationRatios.isEmpty ? nil : multiplicationRatios.reduce(0, +) / Double(multiplicationRatios.count)

        // Same "confirmed only, never suspected" rule as
        // BioLabAnalyticsService.speciesStats — never overstate
        // certainty this app doesn't have.
        let contaminatedCount = batches.filter { batch in
            batch.inspections.contains { $0.contaminationStatus == .confirmed }
        }.count
        let hyperhydricCount = batches.filter { batch in
            batch.inspections.contains { $0.hyperhydricityStatus != .none && $0.hyperhydricityStatus != .unknown }
        }.count

        let nonDiscarded = batches.filter { $0.status != .discarded }
        let rootedOrLater: Set<CultureStage> = [.rooting, .preAcclimatization, .acclimatization, .completed]
        let rootedCount = nonDiscarded.filter { rootedOrLater.contains($0.cultureStage) }.count

        let batchIDs = Set(batches.map(\.id))
        let survivalRates = acclimatizationBatches
            .filter { batch in batch.cultureBatch.map { batchIDs.contains($0.id) } ?? false }
            .compactMap(\.survivalRate)
        let survivalRate = survivalRates.isEmpty ? nil : survivalRates.reduce(0, +) / Double(survivalRates.count)

        return RecipeVersionPerformance(
            versionId: versionId, batchCount: batches.count, averageMultiplicationRate: averageMultiplicationRate,
            contaminationRate: Double(contaminatedCount) / Double(batches.count),
            hyperhydricityRate: Double(hyperhydricCount) / Double(batches.count),
            rootingRate: nonDiscarded.isEmpty ? nil : Double(rootedCount) / Double(nonDiscarded.count),
            survivalRate: survivalRate
        )
    }
}

/// Enhancement §27 "PONDÉRATION CONFIGURABLE" — "Ne pas hardcoder un
/// score scientifique universel." These default weights are this app's
/// own reasonable UX starting point, not a scientific claim (same
/// documented-default spirit as Sensor.isStale's 6-hour threshold) —
/// adjustable per spec's own "ceci est un profil utilisateur."
enum ProtocolPerformanceScore {
    struct Weights: Hashable {
        var multiplication: Double
        var rooting: Double
        var hyperhydricity: Double
        var contamination: Double
        var survival: Double

        static let `default` = Weights(multiplication: 0.4, rooting: 0.2, hyperhydricity: 0.15, contamination: 0.15, survival: 0.1)
    }

    struct Scored: Identifiable {
        var versionId: UUID
        var id: UUID { versionId }
        /// §28 "Score interne Oasis" — 0-100, relative to the other
        /// versions actually being scored together in this same call.
        /// Never an absolute, portable, or comparable-across-species
        /// number — nil when there's nothing to meaningfully compare
        /// against (a single candidate, or no metric available at all).
        var score: Double?
        var batchCount: Int
    }

    /// §26 "une recette basée sur un seul lot ne doit pas être présentée
    /// comme meilleure de manière certaine" — scoring only ever compares
    /// versions *relative to each other* (min-max normalized per
    /// metric), never against an invented absolute "good" threshold,
    /// which is exactly what would be needed to score a single version
    /// in isolation. Metrics missing for a given version simply don't
    /// contribute to its score rather than counting as zero.
    static func score(_ performances: [RecipeVersionPerformance], weights: Weights = .default) -> [Scored] {
        guard performances.count > 1 else {
            return performances.map { Scored(versionId: $0.versionId, score: nil, batchCount: $0.batchCount) }
        }

        let multiplication = normalized(performances.map { ($0.versionId, $0.averageMultiplicationRate) }, higherIsBetter: true)
        let rooting = normalized(performances.map { ($0.versionId, $0.rootingRate) }, higherIsBetter: true)
        let survival = normalized(performances.map { ($0.versionId, $0.survivalRate) }, higherIsBetter: true)
        let hyperhydricity = normalized(performances.map { ($0.versionId, $0.hyperhydricityRate) }, higherIsBetter: false)
        let contamination = normalized(performances.map { ($0.versionId, $0.contaminationRate) }, higherIsBetter: false)

        return performances.map { performance in
            var weightedSum = 0.0
            var totalWeight = 0.0
            for (normalizedValues, weight) in [
                (multiplication, weights.multiplication), (rooting, weights.rooting), (survival, weights.survival),
                (hyperhydricity, weights.hyperhydricity), (contamination, weights.contamination)
            ] {
                guard let value = normalizedValues[performance.versionId] else { continue }
                weightedSum += value * weight
                totalWeight += weight
            }
            let score = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : nil
            return Scored(versionId: performance.versionId, score: score, batchCount: performance.batchCount)
        }
    }

    /// Min-max scales the non-nil values of `pairs` to 0...1, flipping
    /// the direction when lower is actually better (contamination,
    /// hyperhydricity). All-equal or single-value inputs normalize to a
    /// neutral 0.5 rather than an arbitrary 0 or 1.
    private static func normalized(_ pairs: [(UUID, Double?)], higherIsBetter: Bool) -> [UUID: Double] {
        let real = pairs.compactMap { id, value in value.map { (id, $0) } }
        guard let minValue = real.map(\.1).min(), let maxValue = real.map(\.1).max() else { return [:] }
        guard maxValue > minValue else { return Dictionary(uniqueKeysWithValues: real.map { ($0.0, 0.5) }) }
        return Dictionary(uniqueKeysWithValues: real.map { id, value in
            let scaled = (value - minValue) / (maxValue - minValue)
            return (id, higherIsBetter ? scaled : 1 - scaled)
        })
    }
}
