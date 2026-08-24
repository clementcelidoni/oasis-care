import Foundation
import SwiftData

/// Spec Phase 7G — "DEVICE MAPPING... Créer : BioreactorDeviceBinding."
/// One binding per (bioreactor, role) in practice — enforced by the
/// assignment UI always replacing any existing binding for that role
/// rather than a database constraint, the same "at most one per slot"
/// convention Bioreactor.currentBatch/activeProgramVersion already use.
@Model
final class BioreactorDeviceBinding: Syncable {
    var id: UUID
    var role: BioreactorDeviceRole
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var bioreactor: Bioreactor?
    var device: ConnectedDevice?

    init(bioreactor: Bioreactor?, role: BioreactorDeviceRole, device: ConnectedDevice?) {
        self.id = UUID()
        self.bioreactor = bioreactor
        self.role = role
        self.device = device
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
