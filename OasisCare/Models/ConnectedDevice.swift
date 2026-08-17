import Foundation
import SwiftData

/// Spec §9 — the provider-independent record of a physical smart-home
/// accessory (HomeKit, Matter-via-HomeKit, or manually declared).
/// `.nullify` on garden/zone (not `.cascade`, unlike some other
/// relationships in this codebase): the physical accessory still exists
/// and is still visible via HomeKitService even if its Oasis-side
/// garden/zone assignment is removed, so deleting a Garden shouldn't
/// delete the device record, only detach it — matching Garden.plants'
/// choice, not Garden.sensors'.
@Model
final class ConnectedDevice: Syncable {
    var id: UUID
    var provider: DeviceProvider
    /// HMAccessory.uniqueIdentifier.uuidString for HomeKit/Matter
    /// devices; a user-chosen stable string for `.manual`/`.api`.
    var providerDeviceId: String
    var name: String
    /// Raw, provider-reported category label (e.g. HomeKit's
    /// accessory.category.localizedDescription) — descriptive only,
    /// never used for authorization decisions. What the device is
    /// *allowed* to do is `capabilities`, always derived from what the
    /// accessory actually exposes (spec: "toujours détecter
    /// dynamiquement"), never assumed from this label.
    var category: String
    var manufacturer: String?
    var model: String?
    var firmwareVersion: String?
    var online: Bool
    var lastSeenAt: Date?
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var garden: Garden?
    var zone: GardenZone?

    @Relationship(deleteRule: .nullify, inverse: \Sensor.device)
    var sensors: [Sensor] = []

    var capabilitiesRaw: [String]
    var capabilities: [DeviceCapability] {
        get { capabilitiesRaw.compactMap(DeviceCapability.init(rawValue:)) }
        set { capabilitiesRaw = newValue.map(\.rawValue) }
    }

    init(
        provider: DeviceProvider,
        providerDeviceId: String,
        name: String,
        category: String,
        capabilities: [DeviceCapability] = [],
        manufacturer: String? = nil,
        model: String? = nil,
        firmwareVersion: String? = nil,
        online: Bool = false,
        garden: Garden? = nil,
        zone: GardenZone? = nil
    ) {
        self.id = UUID()
        self.provider = provider
        self.providerDeviceId = providerDeviceId
        self.name = name
        self.category = category
        self.capabilitiesRaw = capabilities.map(\.rawValue)
        self.manufacturer = manufacturer
        self.model = model
        self.firmwareVersion = firmwareVersion
        self.online = online
        self.lastSeenAt = online ? .now : nil
        self.createdAt = .now
        self.garden = garden
        self.zone = zone
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    func hasCapability(_ capability: DeviceCapability) -> Bool {
        capabilities.contains(capability)
    }

    var isActuator: Bool {
        capabilities.contains { $0.isActuator }
    }
}
