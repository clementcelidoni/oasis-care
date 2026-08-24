import Foundation

/// Spec Phase 7K "ANALYSE — Oasis peut : calculer moyennes ; dispersion ;
/// comparer groupes ; afficher graphiques." Deliberately stops there:
/// spec's own explicit warning — "ne pas présenter une différence
/// descriptive comme statistiquement significative sans test approprié"
/// — is why this computes only a mean and a standard deviation per
/// group (both properly labeled, plain descriptive statistics) and
/// never a p-value, confidence interval, or "significant"/"not
/// significant" verdict. A real hypothesis test needs a specific,
/// correctly-chosen procedure (which test, one- or two-tailed, sample
/// size assumptions...) this app has no basis to pick correctly, so
/// building one would risk presenting false statistical rigor — exactly
/// what the CRITIQUE forbids.
enum BioLabExperimentAnalytics {
    struct GroupStats: Identifiable {
        var id: UUID
        var name: String
        var batchCount: Int
        var averageMultiplicationRate: Double?
        var standardDeviation: Double?
    }

    static func groupStats(for experiment: BioLabExperiment) -> [GroupStats] {
        experiment.groups.map { group in
            let rates = group.batches.compactMap { batch -> Double? in
                guard batch.initialExplantCount > 0 else { return nil }
                return Double(batch.currentCount) / Double(batch.initialExplantCount)
            }
            let mean = rates.isEmpty ? nil : rates.reduce(0, +) / Double(rates.count)
            let standardDeviation: Double? = {
                guard let mean, rates.count > 1 else { return nil }
                let variance = rates.reduce(0) { $0 + pow($1 - mean, 2) } / Double(rates.count - 1)
                return variance.squareRoot()
            }()

            return GroupStats(
                id: group.id, name: group.name, batchCount: group.batches.count,
                averageMultiplicationRate: mean, standardDeviation: standardDeviation
            )
        }
    }
}
