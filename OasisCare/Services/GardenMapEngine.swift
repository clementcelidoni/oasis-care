import Foundation
import SwiftData
import SwiftUI

/// Spec Phase 6A — the central engine behind OasisPlanView: camera
/// (pan/zoom/rotation) and selection, anchored to one garden's
/// coordinate system. Phase 6B adds boundary editing (points, snapping,
/// undo/redo) directly here rather than a second engine class — one
/// engine per garden-map instance keeps camera/selection/boundary/
/// (later) objects consistent under a single undo stack.
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

    /// Spec Phase 6B — "type robot tondeuse": a dedicated edit mode the
    /// user enters deliberately, rather than every tap on the plan
    /// being interpreted as a boundary edit.
    @Published var isEditingBoundary = false
    @Published var snappingEnabled = true
    /// Index of the boundary point currently under a drag, so the view
    /// can show a live distance label — nil the rest of the time.
    @Published var draggingBoundaryPointIndex: Int?

    /// nil when the garden has no latitude/longitude set yet (spec §16
    /// — location is optional) — OasisPlan still works fully in that
    /// case, it just can't convert to/from real GPS until one is set.
    private(set) var coordinateSystem: GardenCoordinateSystem?
    let garden: Garden

    /// Spec Phase 6B — "annuler/rétablir (undo/redo) obligatoire."
    /// Foundation's real UndoManager, not a hand-rolled command stack:
    /// it already gives grouping and action names for free, and this
    /// same instance carries forward to object/layer edits in later
    /// sub-phases instead of each needing its own stack.
    let undoManager = UndoManager()

    init(garden: Garden) {
        self.garden = garden
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

    // MARK: - Boundary editing (Phase 6B)

    var boundaryPoints: [GardenCoordinate] {
        garden.boundary?.points ?? []
    }

    func addBoundaryPoint(_ raw: GardenCoordinate, context: ModelContext) {
        let point = GardenSnapping.snap(raw, previous: boundaryPoints.last, existingPoints: boundaryPoints, enabled: snappingEnabled)
        setBoundaryPoints(boundaryPoints + [point], actionName: "Ajouter un point", context: context)
    }

    func moveBoundaryPoint(at index: Int, to raw: GardenCoordinate, context: ModelContext) {
        var points = boundaryPoints
        guard points.indices.contains(index) else { return }
        let previous = index > 0 ? points[index - 1] : nil
        let others = points.enumerated().filter { $0.offset != index }.map(\.element)
        points[index] = GardenSnapping.snap(raw, previous: previous, existingPoints: others, enabled: snappingEnabled)
        setBoundaryPoints(points, actionName: "Déplacer un point", context: context)
    }

    func deleteBoundaryPoint(at index: Int, context: ModelContext) {
        var points = boundaryPoints
        guard points.indices.contains(index) else { return }
        points.remove(at: index)
        setBoundaryPoints(points, actionName: "Supprimer un point", context: context)
    }

    private func ensureBoundary(context: ModelContext) -> GardenBoundary {
        if let boundary = garden.boundary { return boundary }
        let boundary = GardenBoundary(garden: garden)
        context.insert(boundary)
        garden.boundary = boundary
        return boundary
    }

    /// Registers a full-array undo step. Simpler and safer than trying
    /// to invert individual add/move/delete operations (an insert's
    /// inverse is a delete-at-index, a move's inverse needs the old
    /// value, etc.) — one shared snapshot mechanism instead of three
    /// bespoke ones, at negligible cost since boundary point counts are
    /// small (tens, not thousands).
    private func setBoundaryPoints(_ newPoints: [GardenCoordinate], actionName: String, context: ModelContext) {
        let boundary = ensureBoundary(context: context)
        let oldPoints = boundary.points
        applyBoundaryPoints(newPoints, to: boundary, context: context)

        undoManager.setActionName(actionName)
        undoManager.registerUndo(withTarget: self) { engine in
            engine.applyBoundaryPoints(oldPoints, to: boundary, context: context)
            engine.undoManager.registerUndo(withTarget: engine) { redoEngine in
                redoEngine.applyBoundaryPoints(newPoints, to: boundary, context: context)
            }
        }
    }

    private func applyBoundaryPoints(_ points: [GardenCoordinate], to boundary: GardenBoundary, context: ModelContext) {
        boundary.points = points
        boundary.updatedAt = .now
        if boundary.syncStatus != .pendingCreate {
            boundary.syncStatus = .pendingUpdate
        }
        try? context.save()
        objectWillChange.send()
    }
}
