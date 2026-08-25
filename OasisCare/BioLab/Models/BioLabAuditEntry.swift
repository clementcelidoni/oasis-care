import Foundation
import SwiftData

/// Enhancement Phase 7T "INTÉGRITÉ ET AUDIT." Scope note: this covers
/// the specific events §48/§49 name as the highest-priority ones
/// (recipe versioning, batch split) as a real, working append-only log
/// — not a full field-level oldValue/newValue diff retrofitted across
/// every mutation in the app, which would touch a very large number of
/// call sites for a benefit this app's small, mostly single-operator
/// workspace doesn't clearly need yet. `detail` is a plain, human-
/// readable summary rather than a separate structured oldValue/newValue
/// pair per field, which is why the enumerated fields those two
/// sub-sections name individually.
struct BioLabAuditAction {
    static let versioned = "versioned"
    static let split = "split"
    static let stageChanged = "stage_changed"
}

@Model
final class BioLabAuditEntry: Syncable {
    var id: UUID
    /// Postgres table name of the audited record — same convention as
    /// DeletionService.EntityType, for the same reason (a stable string
    /// that survives the model's own Swift type name changing).
    var entityType: String
    var entityId: UUID
    var action: String
    var detail: String
    /// The signed-in account's email at the time of the action, nil for
    /// a guest session — never a guessed or default name.
    var performedBy: String?
    var occurredAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    init(entityType: String, entityId: UUID, action: String, detail: String, performedBy: String?) {
        self.id = UUID()
        self.entityType = entityType
        self.entityId = entityId
        self.action = action
        self.detail = detail
        self.performedBy = performedBy
        self.occurredAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
