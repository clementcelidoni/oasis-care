import Foundation

/// Enhancement §25 "PERFORMANCE D'UNE RECETTE" — every rate here follows
/// `BioLabAnalyticsService`'s own established discipline: an *observed*
/// rate from this workspace's own recorded batches, nil (never a
/// fabricated 0) wherever the underlying data genuinely doesn't exist
/// yet. `batchCount` must always be shown alongside any rate (§26: "Basé
/// sur N lots") so a single-batch result is never mistaken for a
/// well-supported one.
///
/// Deliberately missing `averageDuration` from spec's own list:
/// `CultureBatch` has no real "reached completed on this date" record,
/// only `startedAt` — estimating a duration from "now" for a batch that
/// finished a while ago would silently grow with the passage of time
/// rather than reflect what actually happened, which is its own kind of
/// invented number. Adding a real `completedAt` timestamp is a
/// documented Phase 8 candidate rather than an honest fit here now.
struct RecipeVersionPerformance {
    var versionId: UUID
    var batchCount: Int
    var averageMultiplicationRate: Double?
    var contaminationRate: Double?
    var hyperhydricityRate: Double?
    var rootingRate: Double?
    var survivalRate: Double?
}
