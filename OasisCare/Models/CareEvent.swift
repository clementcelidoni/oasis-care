import Foundation
import SwiftData

/// An immutable record of a single completed care action. Never mutate an
/// existing event's date to "reschedule" it — create a new one instead, so
/// the plant's history always reflects what actually happened.
@Model
final class CareEvent {
    var id: UUID
    var type: CareEventType
    var date: Date
    var notes: String
    var createdAt: Date
    var quantity: Double?
    var unit: String?
    var product: String?
    var plant: Plant?

    init(
        plant: Plant?,
        type: CareEventType,
        date: Date = .now,
        notes: String = "",
        quantity: Double? = nil,
        unit: String? = nil,
        product: String? = nil
    ) {
        self.id = UUID()
        self.plant = plant
        self.type = type
        self.date = date
        self.notes = notes
        self.createdAt = .now
        self.quantity = quantity
        self.unit = unit
        self.product = product
    }
}
