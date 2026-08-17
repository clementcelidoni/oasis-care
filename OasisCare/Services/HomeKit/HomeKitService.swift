import Foundation
import HomeKit

enum HomeKitServiceError: LocalizedError {
    case homeNotFound
    case accessoryNotFound
    case serviceNotFound
    case characteristicNotFound
    case notWritable
    case underlying(String)

    var errorDescription: String? {
        switch self {
        case .homeNotFound: return "Maison introuvable."
        case .accessoryNotFound: return "Équipement introuvable — il a peut-être été retiré de Maison."
        case .serviceNotFound: return "Fonction introuvable sur cet équipement."
        case .characteristicNotFound: return "Caractéristique introuvable sur cet équipement."
        case .notWritable: return "Cette caractéristique ne peut pas être modifiée."
        case .underlying(let message): return message
        }
    }
}

/// Spec §2/§3 — the only file in Oasis Care that imports HomeKit.
/// Everything else (views, DeviceCommandService, IrrigationController)
/// works with the Connected* wrapper types from ConnectedHomeGraph.swift,
/// so the rest of the app never depends on HMAccessory directly.
///
/// `start()` must only be called from a place with context (opening
/// "Maison connectée", or beginning to associate an equipment) — never
/// from app launch — per spec §1's "ne jamais demander la permission au
/// premier lancement sans contexte." Creating an HMHomeManager is itself
/// what triggers the system permission prompt on first use.
@MainActor
final class HomeKitService: NSObject, ObservableObject {
    static let shared = HomeKitService()

    @Published private(set) var accessState: HomeAccessState = .unknown
    @Published private(set) var homes: [ConnectedHome] = []
    @Published private(set) var lastError: String?

    private var manager: HMHomeManager?

    private override init() {
        super.init()
    }

    var isStarted: Bool { manager != nil }

    func start() {
        guard manager == nil else { return }
        let manager = HMHomeManager()
        manager.delegate = self
        self.manager = manager
        refresh()
    }

    func refresh() {
        guard let manager else { return }
        accessState = Self.accessState(for: manager.authorizationStatus)
        homes = manager.homes.map(Self.connectedHome(from:))
    }

    // MARK: - Adding accessories (spec §8 — HomeKit and Matter both go
    // through this: Apple's own system flow is "l'expérience système
    // appropriée" the spec itself allows for. Oasis Care has no
    // commissioning protocol stack of its own for either.)

    func addAccessory(toHomeID homeID: UUID) async throws {
        guard let home = manager?.homes.first(where: { $0.uniqueIdentifier == homeID }) else {
            throw HomeKitServiceError.homeNotFound
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            home.addAndSetupAccessories { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
        refresh()
    }

    // MARK: - Actuator commands (Phase 5C)

    /// Semantic actions DeviceCommandService can request without ever
    /// needing `import HomeKit` itself — this stays the one file that
    /// knows which HMCharacteristicType corresponds to each action, so
    /// that invariant (spec §2/§3) holds for the command path too, not
    /// just for reading state.
    enum ActuatorAction {
        case setActive(Bool)
        case setPower(Bool)
        case setBrightness(Double)
        /// Best-effort: only some valve accessories expose this: not
        /// finding it is not an error, see performActuatorAction.
        case setValveDuration(TimeInterval)
    }

    func performActuatorAction(_ action: ActuatorAction, providerDeviceId: String, capability: DeviceCapability) async throws {
        guard let (homeID, accessory) = locate(providerDeviceId: providerDeviceId) else {
            throw HomeKitServiceError.accessoryNotFound
        }
        guard let service = accessory.services.first(where: { $0.impliedCapabilities.contains(capability) }) else {
            throw HomeKitServiceError.serviceNotFound
        }
        let characteristicType: String
        let value: ConnectedCharacteristicValue
        switch action {
        case .setActive(let on):
            characteristicType = HMCharacteristicTypeActive
            value = .bool(on)
        case .setPower(let on):
            characteristicType = HMCharacteristicTypePowerState
            value = .bool(on)
        case .setBrightness(let level):
            characteristicType = HMCharacteristicTypeBrightness
            value = .number(level)
        case .setValveDuration(let seconds):
            characteristicType = HMCharacteristicTypeSetDuration
            value = .number(seconds)
        }
        guard let characteristic = service.characteristics.first(where: { $0.characteristicType == characteristicType }) else {
            if case .setValveDuration = action { return }
            throw HomeKitServiceError.characteristicNotFound
        }
        try await writeCharacteristic(
            homeID: homeID, accessoryID: accessory.id, serviceID: service.id,
            characteristicID: characteristic.id, value: value
        )
    }

    private func locate(providerDeviceId: String) -> (homeID: UUID, accessory: ConnectedAccessory)? {
        for home in homes {
            if let accessory = home.accessories.first(where: { $0.id.uuidString == providerDeviceId }) {
                return (home.id, accessory)
            }
        }
        return nil
    }

    // MARK: - Characteristic read/write

    func writeCharacteristic(
        homeID: UUID, accessoryID: UUID, serviceID: UUID, characteristicID: UUID,
        value: ConnectedCharacteristicValue
    ) async throws {
        let characteristic = try findCharacteristic(
            homeID: homeID, accessoryID: accessoryID, serviceID: serviceID, characteristicID: characteristicID
        )
        guard characteristic.properties.contains(HMCharacteristicPropertyWritable) else {
            throw HomeKitServiceError.notWritable
        }
        let rawValue: Any
        switch value {
        case .bool(let bool): rawValue = bool
        case .number(let number): rawValue = number
        case .string(let string): rawValue = string
        case .data(let data): rawValue = data
        case .none: throw HomeKitServiceError.underlying("Valeur manquante.")
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            characteristic.writeValue(rawValue) { error in
                if let error {
                    continuation.resume(throwing: HomeKitServiceError.underlying(error.localizedDescription))
                } else {
                    continuation.resume()
                }
            }
        }
    }

    func readCharacteristic(
        homeID: UUID, accessoryID: UUID, serviceID: UUID, characteristicID: UUID
    ) async throws -> ConnectedCharacteristicValue {
        let characteristic = try findCharacteristic(
            homeID: homeID, accessoryID: accessoryID, serviceID: serviceID, characteristicID: characteristicID
        )
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            characteristic.readValue { error in
                if let error {
                    continuation.resume(throwing: HomeKitServiceError.underlying(error.localizedDescription))
                } else {
                    continuation.resume()
                }
            }
        }
        return Self.connectedValue(from: characteristic.value)
    }

    private func findCharacteristic(
        homeID: UUID, accessoryID: UUID, serviceID: UUID, characteristicID: UUID
    ) throws -> HMCharacteristic {
        guard let home = manager?.homes.first(where: { $0.uniqueIdentifier == homeID }) else {
            throw HomeKitServiceError.homeNotFound
        }
        guard let accessory = home.accessories.first(where: { $0.uniqueIdentifier == accessoryID }) else {
            throw HomeKitServiceError.accessoryNotFound
        }
        guard let service = accessory.services.first(where: { $0.uniqueIdentifier == serviceID }) else {
            throw HomeKitServiceError.serviceNotFound
        }
        guard let characteristic = service.characteristics.first(where: { $0.uniqueIdentifier == characteristicID }) else {
            throw HomeKitServiceError.characteristicNotFound
        }
        return characteristic
    }

    // MARK: - Translation (HomeKit types → Connected* models)

    static func accessState(for status: HMHomeManagerAuthorizationStatus) -> HomeAccessState {
        if status.contains(.restricted) { return .restricted }
        if status.contains(.determined) {
            return status.contains(.authorized) ? .authorized : .denied
        }
        return .unknown
    }

    private static func connectedHome(from home: HMHome) -> ConnectedHome {
        ConnectedHome(
            id: home.uniqueIdentifier,
            name: home.name,
            isPrimary: home.isPrimary,
            rooms: home.rooms.map { ConnectedRoom(id: $0.uniqueIdentifier, name: $0.name) },
            accessories: home.accessories.map(connectedAccessory(from:))
        )
    }

    private static func connectedAccessory(from accessory: HMAccessory) -> ConnectedAccessory {
        ConnectedAccessory(
            id: accessory.uniqueIdentifier,
            name: accessory.name,
            category: accessory.category.localizedDescription,
            // HMCharacteristicTypeManufacturer/Model/FirmwareVersion were
            // deprecated in iOS 11 in favor of these direct properties.
            manufacturer: accessory.manufacturer,
            model: accessory.model,
            firmwareVersion: accessory.firmwareVersion,
            roomName: accessory.room?.name,
            isReachable: accessory.isReachable,
            isBridged: accessory.isBridged,
            services: accessory.services.map(connectedService(from:))
        )
    }

    private static func connectedService(from service: HMService) -> ConnectedService {
        ConnectedService(
            id: service.uniqueIdentifier,
            name: service.name,
            serviceType: service.serviceType,
            characteristics: service.characteristics.map(connectedCharacteristic(from:)),
            impliedCapabilities: capabilities(forServiceType: service.serviceType)
        )
    }

    private static func connectedCharacteristic(from characteristic: HMCharacteristic) -> ConnectedCharacteristic {
        ConnectedCharacteristic(
            id: characteristic.uniqueIdentifier,
            characteristicType: characteristic.characteristicType,
            value: connectedValue(from: characteristic.value),
            isReadable: characteristic.properties.contains(HMCharacteristicPropertyReadable),
            isWritable: characteristic.properties.contains(HMCharacteristicPropertyWritable),
            units: characteristic.metadata?.units,
            minValue: characteristic.metadata?.minimumValue?.doubleValue,
            maxValue: characteristic.metadata?.maximumValue?.doubleValue
        )
    }

    private static func connectedValue(from value: Any?) -> ConnectedCharacteristicValue {
        switch value {
        case let bool as Bool: return .bool(bool)
        case let number as NSNumber: return .number(number.doubleValue)
        case let string as String: return .string(string)
        case let data as Data: return .data(data)
        default: return .none
        }
    }

    /// Spec §26/§10 — maps HomeKit's standard HAP service vocabulary to
    /// Oasis' DeviceCapability, from the real framework constants (never
    /// a hand-typed UUID) so this only ever reports what the accessory
    /// actually, verifiably exposes. Deliberately conservative: HomeKit's
    /// standard catalog has no dedicated service for soil moisture, pH,
    /// conductivity, UV sterilization, or misting, so accessories
    /// offering those return no capability here — the "Associer" flow
    /// (Phase 5B) lets the user assign the Oasis-specific meaning
    /// instead of this guessing at it.
    /// nonisolated: a pure function of its input, no `self` access — so
    /// it can be unit-tested synchronously without needing MainActor,
    /// unlike the rest of this @MainActor-isolated class.
    nonisolated static func capabilities(forServiceType serviceType: String) -> [DeviceCapability] {
        switch serviceType {
        case HMServiceTypeTemperatureSensor:
            return [.temperatureSensor]
        case HMServiceTypeHumiditySensor:
            return [.humiditySensor]
        case HMServiceTypeLightSensor:
            return [.lightSensor]
        case HMServiceTypeLeakSensor:
            return [.waterLevelSensor]
        case HMServiceTypeValve, HMServiceTypeFaucet:
            return [.valve]
        case HMServiceTypeIrrigationSystem:
            return [.valve, .pump]
        case HMServiceTypeLightbulb:
            return [.light]
        case HMServiceTypeSwitch, HMServiceTypeOutlet:
            return [.switchDevice]
        case HMServiceTypeFan:
            return [.fan]
        case HMServiceTypeThermostat, HMServiceTypeHeaterCooler:
            return [.heater]
        case HMServiceTypeFilterMaintenance:
            return [.filter]
        default:
            return []
        }
    }
}

extension HomeKitService: HMHomeManagerDelegate {
    nonisolated func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {
        Task { @MainActor in self.refresh() }
    }

    nonisolated func homeManager(_ manager: HMHomeManager, didUpdate status: HMHomeManagerAuthorizationStatus) {
        Task { @MainActor in self.refresh() }
    }
}
