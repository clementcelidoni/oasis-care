import Foundation
import SwiftData

/// Spec §40-41 — a physical QR sticker or NFC chip that resolves to a
/// plant via a random, unguessable token, never by embedding the plant's
/// own data in the tag. `workspaceId`/`gardenId`/`zoneId` from the spec's
/// field list aren't stored here: workspaceId is push-time-only (like
/// every other synced model in this app), and garden/zone are always
/// derivable via `plant.garden`/`plant.zone` — storing a snapshot would
/// just go stale the moment a plant moves.
@Model
final class SmartTag: Syncable {
    var id: UUID
    var publicToken: String
    var type: SmartTagType
    var active: Bool
    var createdAt: Date
    var lastScannedAt: Date?
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var plant: Plant?

    init(plant: Plant?, type: SmartTagType) {
        self.id = UUID()
        self.publicToken = Self.generateToken()
        self.type = type
        self.active = true
        self.createdAt = .now
        self.plant = plant
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var url: String { SmartTagConfig.url(forToken: publicToken) }

    /// 128 bits from Foundation's CSPRNG-backed UUID generator — same
    /// entropy class as a session token, just reformatted without dashes
    /// for a cleaner URL (spec §41: "token aléatoire non prévisible").
    private static func generateToken() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}
