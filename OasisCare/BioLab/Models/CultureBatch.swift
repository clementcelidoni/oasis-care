import Foundation
import SwiftData

/// Spec Phase 7B — "CultureBatch." No separate MotherPlant model: a
/// mother plant is just a real Plant used as an explant donor (spec's
/// own "lier directement à Plant si l'architecture actuelle le
/// permet") — it keeps normal care tracking, shows up in Végétaux, and
/// this is its only BioLab-specific fact.
///
/// No separate CultureLineage model either ("ou système équivalent"):
/// `parentBatch` (for splits) and `motherPlant` (for the batch's
/// origin) already express the full genealogy as direct relationships,
/// walked at display time by CultureLineageService — a dedicated join
/// table would only duplicate what these two references already say,
/// and would need its own sync/consistency upkeep for no real benefit.
///
/// `workspaceId` deliberately isn't a stored property — same
/// convention as every other Syncable model in this app (see SmartTag's
/// own comment): it's push-time-only, added when building the Supabase
/// row, never persisted locally.
@Model
final class CultureBatch: Syncable {
    var id: UUID
    var batchCode: String
    /// Saisie utilisateur — free text rather than a hard link to
    /// SpeciesProfile, since tissue culture routinely works at
    /// cultivar granularity finer than that cross-user cache, and a
    /// batch must never be blocked on a profile that doesn't exist yet.
    var speciesName: String
    var cultureStage: CultureStage
    var status: CultureBatchStatus
    var startedAt: Date
    var expectedEndAt: Date?
    var initialExplantCount: Int
    var currentCount: Int
    var notes: String
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var motherPlant: Plant?
    /// Best-effort enrichment only (Phase 3D's cross-user cache),
    /// resolved by name when one happens to match — never required.
    var speciesProfile: SpeciesProfile?
    var parentBatch: CultureBatch?
    /// Spec Phase 7C — the exact, immutable version used. A plain
    /// optional relationship added to an already-shipped model is safe
    /// without a migration default (unlike a non-optional scalar): nil
    /// is the correct, natural value for every batch that predates this
    /// field.
    var mediumRecipeVersion: MediumRecipeVersion?

    @Relationship(deleteRule: .nullify, inverse: \CultureBatch.parentBatch)
    var childBatches: [CultureBatch] = []

    /// Spec Phase 7H.
    @Relationship(deleteRule: .cascade, inverse: \BioreactorInspection.cultureBatch)
    var inspections: [BioreactorInspection] = []

    init(
        batchCode: String,
        speciesName: String,
        cultureStage: CultureStage = .initiation,
        initialExplantCount: Int,
        motherPlant: Plant? = nil,
        parentBatch: CultureBatch? = nil,
        speciesProfile: SpeciesProfile? = nil,
        notes: String = ""
    ) {
        self.id = UUID()
        self.batchCode = batchCode
        self.speciesName = speciesName
        self.cultureStage = cultureStage
        self.status = .active
        self.startedAt = .now
        self.initialExplantCount = initialExplantCount
        self.currentCount = initialExplantCount
        self.notes = notes
        self.createdAt = .now
        self.motherPlant = motherPlant
        self.parentBatch = parentBatch
        self.speciesProfile = speciesProfile
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
