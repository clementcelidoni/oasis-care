import Foundation

/// Spec §3 — HomeKit-independent read models. Only HomeKitService
/// imports HomeKit and translates HMHome/HMRoom/HMAccessory/HMService/
/// HMCharacteristic into these; everything else in the app (views,
/// DeviceCommandService, IrrigationController) works with these plain
/// types instead. Live/ephemeral — not persisted; ConnectedDevice is the
/// persisted, synced record that references one of these by
/// `providerDeviceId`.

struct ConnectedHome: Identifiable, Hashable {
    let id: UUID
    let name: String
    let isPrimary: Bool
    let rooms: [ConnectedRoom]
    let accessories: [ConnectedAccessory]
}

struct ConnectedRoom: Identifiable, Hashable {
    let id: UUID
    let name: String
}

struct ConnectedAccessory: Identifiable, Hashable {
    let id: UUID
    let name: String
    /// HMAccessoryCategory.localizedDescription — descriptive only, see
    /// ConnectedDevice.category's doc comment.
    let category: String
    let manufacturer: String?
    let model: String?
    let firmwareVersion: String?
    let roomName: String?
    let isReachable: Bool
    let isBridged: Bool
    let services: [ConnectedService]

    /// Best-effort, dynamically-derived from this accessory's actual
    /// HMService types — never a static per-name lookup. See
    /// HomeKitService.capabilities(for:). HomeKit's standard service
    /// catalog has no native concept of soil-moisture/pH/conductivity/
    /// UV-sterilizer/mister, so accessories offering those (mostly
    /// garden-specific sensors) will under-report here; the "Associer"
    /// flow lets the user confirm or correct the Oasis-side meaning
    /// rather than trusting this list blindly.
    var detectedCapabilities: [DeviceCapability] {
        Array(Set(services.flatMap(\.impliedCapabilities)))
    }
}

struct ConnectedService: Identifiable, Hashable {
    let id: UUID
    let name: String
    /// Raw HMServiceType constant, kept as-is rather than re-modeled so a
    /// service type this app doesn't map yet still round-trips intact
    /// instead of being silently discarded.
    let serviceType: String
    let characteristics: [ConnectedCharacteristic]
    /// Computed once by HomeKitService (the only file allowed to import
    /// HomeKit) from the accessory's *actual* HMService types — see
    /// HomeKitService.capabilities(for:). Never guessed from a name.
    let impliedCapabilities: [DeviceCapability]
}

struct ConnectedCharacteristic: Identifiable, Hashable {
    let id: UUID
    /// Raw HMCharacteristicType constant.
    let characteristicType: String
    let value: ConnectedCharacteristicValue
    let isReadable: Bool
    let isWritable: Bool
    /// HMCharacteristicMetadata units string (e.g. "celsius", "percentage"),
    /// when the accessory reports it.
    let units: String?
    let minValue: Double?
    let maxValue: Double?
}

enum ConnectedCharacteristicValue: Hashable {
    case bool(Bool)
    case number(Double)
    case string(String)
    case data(Data)
    case none

    var asBool: Bool? {
        if case .bool(let value) = self { return value }
        if case .number(let value) = self { return value != 0 }
        return nil
    }

    var asNumber: Double? {
        if case .number(let value) = self { return value }
        return nil
    }
}
