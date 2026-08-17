import Foundation
import SwiftData

/// Spec §79-80 — a named, one-tap (or one-phrase, via ActivateSceneIntent)
/// preset combining several actuator commands, e.g. "Serre nuit":
/// lighting off, ventilation/heating/misting handed back to automatic
/// control. Named `OasisScene` rather than `Scene` — `Scene` is already
/// SwiftUI's own protocol (an App's `body` returns `some Scene`), and
/// every view file in this app imports SwiftUI.
///
/// Every actuator command a scene contains still goes through
/// DeviceCommandService when activated (see SceneService.activate) — a
/// scene is just a saved batch of the exact same safety-checked calls
/// the manual UI already makes, never a new, separate path to hardware.
@Model
final class OasisScene: Syncable {
    var id: UUID
    var name: String
    var icon: String
    var garden: Garden?
    /// When set, activating this scene also flips this greenhouse's own
    /// automatic climate control on/off — spec §80's "Ventilation Auto /
    /// Chauffage Auto / Brumisation Auto" means handing control back to
    /// GreenhouseClimateService's existing hysteresis logic, not forcing
    /// a specific on/off state for each of them individually.
    var greenhouse: Greenhouse?
    var setClimateControlEnabled: Bool?
    var createdAt: Date
    var updatedAt: Date?
    var syncStatus: SyncStatus?

    @Relationship(deleteRule: .cascade, inverse: \OasisSceneAction.scene)
    var actions: [OasisSceneAction] = []

    init(name: String, icon: String = "sparkles", garden: Garden? = nil) {
        self.id = UUID()
        self.name = name
        self.icon = icon
        self.garden = garden
        self.createdAt = .now
        self.updatedAt = .now
        self.syncStatus = .pendingCreate
    }
}

/// One on/off step within a scene. Deliberately excludes `.valve` from
/// what the scene builder UI offers — DeviceCommandService.setPower
/// (what SceneService.activate calls) sends the PowerState/Active
/// characteristic pattern correct for switch/light/fan/heater/mister,
/// but a real valve needs openValve's own duration-bounded path
/// instead; mixing the two would send the wrong HAP characteristic to
/// real valve hardware. Irrigation belongs to zones/automation rules,
/// not scenes.
@Model
final class OasisSceneAction {
    var id: UUID
    var scene: OasisScene?
    var device: ConnectedDevice?
    var capability: DeviceCapability
    /// Mirrors DeviceCommandService.setPower's own on:Bool — true means
    /// on, false means off.
    var targetOn: Bool
    var order: Int

    init(device: ConnectedDevice?, capability: DeviceCapability, targetOn: Bool, order: Int = 0) {
        self.id = UUID()
        self.device = device
        self.capability = capability
        self.targetOn = targetOn
        self.order = order
    }
}
