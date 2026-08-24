import Foundation

/// Spec §58's five graph periods, paired with §94's three aggregate
/// bucket sizes (5 min / 1 h / 1 jour) — longer periods use coarser
/// buckets so a year of readings doesn't mean fetching and rendering
/// tens of thousands of raw points, per §93's data-volume warning.
enum GraphPeriod: String, CaseIterable, Identifiable {
    case hours24
    case days7
    case days30
    case months3
    case year1
    /// Spec Phase 7F — bioreactor sensor graphs additionally offer "Cycle
    /// complet". Not a fixed duration like the cases above: it's resolved
    /// dynamically per-sensor by GraphAggregationService (one full
    /// repetition of the bioreactor's slower enabled immersion/aeration
    /// interval), so this case is only ever offered by
    /// `GraphAggregationService.availablePeriods(for:)` when that can
    /// actually be computed — never added to a non-bioreactor sensor's
    /// picker. The static `lookback`/`bucketSeconds` below are an
    /// unreachable-in-practice fallback, kept only so this remains a
    /// total function.
    case cycleComplete

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .hours24: return "24 h"
        case .days7: return "7 j"
        case .days30: return "30 j"
        case .months3: return "3 mois"
        case .year1: return "1 an"
        case .cycleComplete: return "Cycle complet"
        }
    }

    var lookback: TimeInterval {
        switch self {
        case .hours24: return 24 * 3600
        case .days7: return 7 * 86400
        case .days30: return 30 * 86400
        case .months3: return 90 * 86400
        case .year1: return 365 * 86400
        case .cycleComplete: return 24 * 3600
        }
    }

    /// nil means raw, unaggregated readings.
    var bucketSeconds: TimeInterval? {
        switch self {
        case .hours24, .cycleComplete: return nil
        case .days7: return 5 * 60
        case .days30: return 3600
        case .months3, .year1: return 86400
        }
    }
}
