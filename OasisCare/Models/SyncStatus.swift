import Foundation

/// Tracks whether a locally-changed record has reached Supabase yet.
/// Deletion isn't represented here — SwiftData deleting an object removes
/// its stored properties along with it, so a still-pending cloud delete is
/// tracked separately (see PendingDeletion) rather than as a status value
/// on an object that may no longer exist locally.
enum SyncStatus: String, Codable {
    case synced
    case pendingCreate
    case pendingUpdate
    case syncError
}
