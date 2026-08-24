import Foundation
import SwiftData

/// Spec Phase 7H — "BioreactorInspection." Scoped primarily to the
/// CultureBatch being assessed (matching the spec's own TIMELINE example,
/// which tracks a batch's condition over its lifetime — J0 inoculation
/// through J28 récupération — not a specific vessel), with an optional
/// note of which Bioreactor it was actually in at the time: a batch can
/// move between bioreactors, and Phase 7I's "pourquoi BR04 multiplie
/// moins vite que BR03" needs that per-vessel correlation. Editable like
/// TreeInspection (a report is more likely to need a correction than a
/// numeric reading), not append-only like PlantMeasurement.
@Model
final class BioreactorInspection: Syncable {
    var id: UUID
    var date: Date
    /// Free text — spec names this field but gives it no enumerated
    /// scale, unlike contamination/hyperhydricity below.
    var cultureAppearance: String
    var contaminationStatus: ContaminationStatus
    var hyperhydricityStatus: ObservedSeverity
    var necrosisStatus: ObservedSeverity
    var browningStatus: ObservedSeverity
    /// Free text, not ObservedSeverity — growth is the absence/presence
    /// of a good thing, not a defect, so that severity scale would read
    /// backwards here. Spec gives no scale for this field either way.
    var growthStatus: String
    var estimatedCount: Int?
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var cultureBatch: CultureBatch?
    var bioreactor: Bioreactor?

    @Relationship(deleteRule: .cascade, inverse: \BioLabInspectionPhoto.inspection)
    var photos: [BioLabInspectionPhoto] = []

    init(
        cultureBatch: CultureBatch?, bioreactor: Bioreactor? = nil, date: Date = .now,
        cultureAppearance: String = "", contaminationStatus: ContaminationStatus = .noneObserved,
        hyperhydricityStatus: ObservedSeverity = .none, necrosisStatus: ObservedSeverity = .none,
        browningStatus: ObservedSeverity = .none, growthStatus: String = "",
        estimatedCount: Int? = nil, notes: String = ""
    ) {
        self.id = UUID()
        self.cultureBatch = cultureBatch
        self.bioreactor = bioreactor
        self.date = date
        self.cultureAppearance = cultureAppearance
        self.contaminationStatus = contaminationStatus
        self.hyperhydricityStatus = hyperhydricityStatus
        self.necrosisStatus = necrosisStatus
        self.browningStatus = browningStatus
        self.growthStatus = growthStatus
        self.estimatedCount = estimatedCount
        self.notes = notes
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
