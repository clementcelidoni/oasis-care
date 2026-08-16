import Foundation
import SwiftData

/// Records that a locally-deleted object still needs its cloud counterpart
/// removed. SwiftData deleting an object removes its stored properties
/// along with it, so this exists independently — created right before the
/// local delete, cleared by the sync engine once the cloud delete succeeds.
/// Only the top-level deleted object needs a row here: Postgres mirrors the
/// same cascade/nullify FK rules as the local SwiftData relationships, so
/// deleting a garden's cloud row cascades to its zones there too.
@Model
final class PendingDeletion {
    var id: UUID
    var entityType: String
    var deletedAt: Date

    init(id: UUID, entityType: String, deletedAt: Date = .now) {
        self.id = id
        self.entityType = entityType
        self.deletedAt = deletedAt
    }
}
