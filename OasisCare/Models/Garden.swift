import Foundation
import SwiftData

@Model
final class Garden {
    var id: UUID
    var name: String
    var address: String?
    var notes: String
    var dateCreated: Date

    @Relationship(deleteRule: .cascade, inverse: \GardenZone.garden)
    var zones: [GardenZone] = []

    @Relationship(deleteRule: .nullify, inverse: \Plant.garden)
    var plants: [Plant] = []

    init(name: String, address: String? = nil, notes: String = "", dateCreated: Date = .now) {
        self.id = UUID()
        self.name = name
        self.address = address
        self.notes = notes
        self.dateCreated = dateCreated
    }
}
