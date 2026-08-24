import Foundation
import SwiftData

/// Spec Phase 7D — "Bioreactor." Device/sensor bindings deliberately
/// aren't fields here: 7F scopes Sensor to a bioreactor the same way
/// Sensor already scopes to plant/garden/zone/device, and 7G's
/// BioreactorDeviceBinding gives device roles (air pump, valve...)
/// real structure — a flat deviceIds/sensorIds array here would only
/// duplicate what those two, more precise mechanisms already express.
@Model
final class Bioreactor: Syncable {
    var id: UUID
    var name: String
    var code: String
    var bioreactorType: BioreactorType
    var totalVolumeLiters: Double
    var workingVolumeLiters: Double
    var status: BioreactorStatus
    var componentTypes: [BioreactorComponentType]
    var location: String
    /// Spec Phase 7G — "AUTOMATIC MODE: l'utilisateur doit activer
    /// explicitement." Defaults false so BioreactorCycleScheduler never
    /// actuates real hardware for a bioreactor the user hasn't
    /// deliberately opted in — it still tracks/journals cycles either
    /// way (see that type's own tick logic), just without ever calling
    /// the actuate closure for real when this is false.
    var automationEnabled: Bool = false
    /// Spec Phase 7G — "REPRISE doit recalculer proprement le planning."
    /// Stamped to `.now` whenever automation is (re)activated or the
    /// status Picker leaves `.paused` — BioreactorCycleScheduler floors
    /// its due-date anchor on this so a long pause/deactivation never
    /// creates a backlog of synthetic missed cycles on resume.
    var scheduleResumedAt: Date?
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var currentBatch: CultureBatch?
    /// Spec Phase 7E — which program version is currently assigned.
    /// Plain optional relationship added to an already-shipped model —
    /// safe without a migration default (nil is correct for every
    /// bioreactor that predates this field).
    var activeProgramVersion: BioreactorProgramVersion?

    @Relationship(deleteRule: .cascade, inverse: \BioreactorMaintenanceEvent.bioreactor)
    var maintenanceEvents: [BioreactorMaintenanceEvent] = []

    /// Spec Phase 7F — "réutiliser Sensor... ajouter les usages BioLab."
    /// Same cascade semantics as Plant/Garden/GardenZone's own `sensors`:
    /// a bioreactor's sensor history has no meaning once the bioreactor
    /// itself is deleted.
    @Relationship(deleteRule: .cascade, inverse: \Sensor.bioreactor)
    var sensors: [Sensor] = []

    /// Spec Phase 7G — "DEVICE MAPPING."
    @Relationship(deleteRule: .cascade, inverse: \BioreactorDeviceBinding.bioreactor)
    var deviceBindings: [BioreactorDeviceBinding] = []

    /// Spec's "QR / NFC" section.
    @Relationship(deleteRule: .cascade, inverse: \SmartTag.bioreactor)
    var smartTags: [SmartTag] = []

    init(
        name: String, code: String, bioreactorType: BioreactorType, totalVolumeLiters: Double, workingVolumeLiters: Double,
        componentTypes: [BioreactorComponentType] = [], location: String = ""
    ) {
        self.id = UUID()
        self.name = name
        self.code = code
        self.bioreactorType = bioreactorType
        self.totalVolumeLiters = totalVolumeLiters
        self.workingVolumeLiters = workingVolumeLiters
        self.status = .idle
        self.componentTypes = componentTypes
        self.location = location
        self.automationEnabled = false
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
