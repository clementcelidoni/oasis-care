import Foundation
import SwiftData

/// Spec Phase 7H — "PHOTOS: Vue globale / Détail tissus / Milieu /
/// Bocal / Équipement." A dedicated model rather than reusing PlantPhoto:
/// PlantPhoto's sync (SyncEngine's pushPlantPhotos/restore) hard-requires
/// a non-null plant_id end to end (storage path, DTO, restore guard) —
/// a BioLab inspection photo has no Plant at all, so bolting it onto
/// PlantPhoto would either silently never sync (if plant stayed nil) or
/// require touching PlantPhoto's existing, working sync path that real
/// plant photos already depend on. A small, separate, append-only model
/// (same shape as PlantPhoto: no updatedAt, syncStatus set once at
/// init) keeps this isolated with no regression risk to that path.
@Model
final class BioLabInspectionPhoto {
    var id: UUID
    var imageData: Data
    var thumbnailData: Data
    var category: BioLabPhotoCategory
    var date: Date
    var syncStatus: SyncStatus?

    var inspection: BioreactorInspection?

    init(inspection: BioreactorInspection?, imageData: Data, thumbnailData: Data, category: BioLabPhotoCategory, date: Date = .now) {
        self.id = UUID()
        self.inspection = inspection
        self.imageData = imageData
        self.thumbnailData = thumbnailData
        self.category = category
        self.date = date
        self.syncStatus = .pendingCreate
    }
}
