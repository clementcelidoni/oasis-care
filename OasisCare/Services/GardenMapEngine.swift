import Foundation
import SwiftUI

/// Spec Phase 6A — the central engine behind OasisPlanView: camera
/// (pan/zoom/rotation) and selection, anchored to one garden's
/// coordinate system. Phase 6A wires camera + coordinates only;
/// selection becomes meaningful once real objects exist (Phase 6C) —
/// the plumbing is here now so 6B/6C don't need to touch this file's
/// shape, only add to it.
///
/// ObservableObject/@Published (not the newer @Observable macro) to
/// match every other engine/service class in this codebase
/// (DeviceCommandService, HomeKitService, SyncEngine) — consistency
/// over novelty. Deliberately NOT @MainActor, unlike those: this one
/// touches no other actor-isolated service, and views need to
/// construct it inside their own `init` (for `@StateObject`), which
/// isn't guaranteed to run on the main actor by the type system — an
/// unnecessary @MainActor here would make that a real compile risk for
/// no actual benefit, since every mutation already only ever happens
/// from SwiftUI gesture callbacks on the main thread regardless.
final class GardenMapEngine: ObservableObject {
    @Published var camera = GardenMapCamera()
    @Published var selectedObjectIDs: Set<UUID> = []

    /// nil when the garden has no latitude/longitude set yet (spec §16
    /// — location is optional) — OasisPlan still works fully in that
    /// case, it just can't convert to/from real GPS until one is set.
    private(set) var coordinateSystem: GardenCoordinateSystem?

    init(garden: Garden) {
        if let latitude = garden.latitude, let longitude = garden.longitude {
            coordinateSystem = GardenCoordinateSystem(originLatitude: latitude, originLongitude: longitude)
        }
    }

    func resetCamera() {
        camera = GardenMapCamera()
    }

    func select(_ id: UUID) {
        selectedObjectIDs = [id]
    }

    func toggleSelection(_ id: UUID) {
        if selectedObjectIDs.contains(id) {
            selectedObjectIDs.remove(id)
        } else {
            selectedObjectIDs.insert(id)
        }
    }

    func clearSelection() {
        selectedObjectIDs.removeAll()
    }
}
