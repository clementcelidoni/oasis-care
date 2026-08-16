import Foundation
import SwiftData

/// One entry in a plant's photo history, for tracking growth over time.
/// The most recently added photo also becomes the plant's main photo
/// (`Plant.photoData`) — see `CareScheduleEngine.addPhoto`.
@Model
final class PlantPhoto {
    var id: UUID
    var imageData: Data
    var thumbnailData: Data
    var date: Date
    var notes: String
    var plant: Plant?
    var syncStatus: SyncStatus?

    init(plant: Plant?, imageData: Data, thumbnailData: Data, date: Date = .now, notes: String = "") {
        self.id = UUID()
        self.plant = plant
        self.imageData = imageData
        self.thumbnailData = thumbnailData
        self.date = date
        self.notes = notes
        self.syncStatus = .pendingCreate
    }
}
