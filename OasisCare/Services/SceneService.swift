import Foundation
import SwiftData

/// Spec §79-80 — activating a scene replays its saved actions through
/// DeviceCommandService, the same single path every other actuator
/// command in this app goes through (manual taps, automation rules, and
/// now scenes alike). A scene invents no new way to reach hardware —
/// it's a named, saved batch of the existing one, so it inherits every
/// existing guard rail (online check, capability check, audit log) with
/// nothing extra to get wrong here.
@MainActor
enum SceneService {
    static func activate(_ scene: OasisScene, context: ModelContext) async {
        for action in scene.actions.sorted(by: { $0.order < $1.order }) {
            guard let device = action.device else { continue }
            await DeviceCommandService.shared.setPower(device, on: action.targetOn, capability: action.capability, context: context)
        }
        if let greenhouse = scene.greenhouse, let setClimateControlEnabled = scene.setClimateControlEnabled {
            greenhouse.climateControlEnabled = setClimateControlEnabled
            greenhouse.markDirty()
            try? context.save()
        }
    }
}
