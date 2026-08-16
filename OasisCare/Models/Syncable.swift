import Foundation

/// Adopted by every mutable synced model (not CareEvent/PlantPhoto — those
/// are append-only and never edited after creation, so they only need
/// syncStatus set once, at init). Call `markDirty()` at the end of any
/// mutation that isn't already covered by a fresh `.pendingCreate` object,
/// or the sync engine will never notice the change and it will silently
/// never reach the cloud.
protocol Syncable: AnyObject {
    var syncStatus: SyncStatus? { get set }
    var updatedAt: Date? { get set }
}

extension Syncable {
    func markDirty() {
        syncStatus = (syncStatus == .pendingCreate) ? .pendingCreate : .pendingUpdate
        updatedAt = .now
    }
}
