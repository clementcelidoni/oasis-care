import Foundation
import SwiftData

@Model
final class GardenZone {
    var id: UUID
    var name: String
    var notes: String
    var garden: Garden?

    @Relationship(deleteRule: .nullify, inverse: \Plant.zone)
    var plants: [Plant] = []

    init(name: String, notes: String = "", garden: Garden? = nil) {
        self.id = UUID()
        self.name = name
        self.notes = notes
        self.garden = garden
    }
}
