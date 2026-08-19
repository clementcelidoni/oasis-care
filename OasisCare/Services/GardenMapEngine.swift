import Foundation
import SwiftData
import SwiftUI

/// Spec Phase 6A — the central engine behind OasisPlanView: camera
/// (pan/zoom/rotation) and selection, anchored to one garden's
/// coordinate system. Phase 6B adds boundary editing (points, snapping,
/// undo/redo) directly here rather than a second engine class, and
/// Phase 6C extends the same point-editing mechanics to GardenArea
/// zones plus placed GardenMapObjects — one engine per garden-map
/// instance keeps camera/selection/boundary/objects/areas consistent
/// under a single undo stack.
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
    /// Spec Phase 6A doc'd this as becoming meaningful "once real
    /// objects exist" — that's Phase 6C's GardenMapObject.
    @Published var selectedObjectIDs: Set<UUID> = []

    /// Spec Phase 6B — "type robot tondeuse": a dedicated edit mode the
    /// user enters deliberately, rather than every tap on the plan
    /// being interpreted as a boundary edit.
    @Published var isEditingBoundary = false
    /// Spec Phase 6C — id of the GardenArea currently being drawn/
    /// extended, if any. Mutually exclusive with isEditingBoundary and
    /// placingObjectType in practice (the UI only ever enters one mode
    /// at a time), though nothing below enforces that at the type
    /// level — see OasisPlanView's single tap-dispatch point.
    @Published var editingAreaID: UUID?
    /// Spec Phase 6C — non-nil while the user has picked a type from
    /// the object palette and is about to tap the plan to place it.
    @Published var placingObjectType: GardenObjectType?

    @Published var snappingEnabled = true
    /// Index of the boundary/area point currently under a drag, so the
    /// view can show a live distance label — nil the rest of the time.
    @Published var draggingBoundaryPointIndex: Int?

    /// nil when the garden has no latitude/longitude set yet (spec §16
    /// — location is optional) — OasisPlan still works fully in that
    /// case, it just can't convert to/from real GPS until one is set.
    private(set) var coordinateSystem: GardenCoordinateSystem?
    let garden: Garden

    /// Spec Phase 6B — "annuler/rétablir (undo/redo) obligatoire."
    /// Foundation's real UndoManager, not a hand-rolled command stack:
    /// it already gives grouping and action names for free, and this
    /// same instance carries the object/area edits Phase 6C adds too.
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

    // MARK: - Point-polygon editing (Phase 6B boundary, Phase 6C areas)

    /// What a batch of points belongs to — lets addPoint/movePoint/
    /// deletePoint/undo share one implementation for both the single
    /// GardenBoundary and any number of GardenArea zones, instead of
    /// duplicating the same snap/undo/save logic per polygon kind.
    private enum PointsTarget {
        case boundary
        case area(GardenArea)
    }

    var boundaryPoints: [GardenCoordinate] {
        garden.boundary?.points ?? []
    }

    func addBoundaryPoint(_ raw: GardenCoordinate, context: ModelContext) {
        let points = boundaryPoints
        let point = GardenSnapping.snap(raw, previous: points.last, existingPoints: points, enabled: snappingEnabled)
        setPoints(points + [point], target: .boundary, actionName: "Ajouter un point", context: context)
    }

    func moveBoundaryPoint(at index: Int, to raw: GardenCoordinate, context: ModelContext) {
        movePoint(at: index, to: raw, in: boundaryPoints, target: .boundary, context: context)
    }

    func deleteBoundaryPoint(at index: Int, context: ModelContext) {
        deletePoint(at: index, in: boundaryPoints, target: .boundary, context: context)
    }

    func area(withID id: UUID) -> GardenArea? {
        garden.areas.first { $0.id == id }
    }

    func points(forArea areaID: UUID) -> [GardenCoordinate] {
        area(withID: areaID)?.points ?? []
    }

    @discardableResult
    func addArea(type: GardenAreaType, context: ModelContext) -> GardenArea {
        let area = GardenArea(garden: garden, areaType: type, name: type.label)
        context.insert(area)
        try? context.save()
        objectWillChange.send()
        return area
    }

    func removeArea(_ area: GardenArea, context: ModelContext) {
        if editingAreaID == area.id { editingAreaID = nil }
        DeletionService.delete(area, in: context)
        try? context.save()
        objectWillChange.send()
    }

    func addAreaPoint(_ raw: GardenCoordinate, areaID: UUID, context: ModelContext) {
        guard let area = area(withID: areaID) else { return }
        let point = GardenSnapping.snap(raw, previous: area.points.last, existingPoints: area.points, enabled: snappingEnabled)
        setPoints(area.points + [point], target: .area(area), actionName: "Ajouter un point", context: context)
    }

    func moveAreaPoint(at index: Int, areaID: UUID, to raw: GardenCoordinate, context: ModelContext) {
        guard let area = area(withID: areaID) else { return }
        movePoint(at: index, to: raw, in: area.points, target: .area(area), context: context)
    }

    func deleteAreaPoint(at index: Int, areaID: UUID, context: ModelContext) {
        guard let area = area(withID: areaID) else { return }
        deletePoint(at: index, in: area.points, target: .area(area), context: context)
    }

    private func movePoint(at index: Int, to raw: GardenCoordinate, in points: [GardenCoordinate], target: PointsTarget, context: ModelContext) {
        var points = points
        guard points.indices.contains(index) else { return }
        let previous = index > 0 ? points[index - 1] : nil
        let others = points.enumerated().filter { $0.offset != index }.map(\.element)
        points[index] = GardenSnapping.snap(raw, previous: previous, existingPoints: others, enabled: snappingEnabled)
        setPoints(points, target: target, actionName: "Déplacer un point", context: context)
    }

    private func deletePoint(at index: Int, in points: [GardenCoordinate], target: PointsTarget, context: ModelContext) {
        var points = points
        guard points.indices.contains(index) else { return }
        points.remove(at: index)
        setPoints(points, target: target, actionName: "Supprimer un point", context: context)
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
    /// bespoke ones, at negligible cost since polygon point counts are
    /// small (tens, not thousands).
    private func setPoints(_ newPoints: [GardenCoordinate], target: PointsTarget, actionName: String, context: ModelContext) {
        let oldPoints = currentPoints(for: target)
        applyPoints(newPoints, target: target, context: context)

        undoManager.setActionName(actionName)
        undoManager.registerUndo(withTarget: self) { engine in
            engine.applyPoints(oldPoints, target: target, context: context)
            engine.undoManager.registerUndo(withTarget: engine) { redoEngine in
                redoEngine.applyPoints(newPoints, target: target, context: context)
            }
        }
    }

    private func currentPoints(for target: PointsTarget) -> [GardenCoordinate] {
        switch target {
        case .boundary: return garden.boundary?.points ?? []
        case .area(let area): return area.points
        }
    }

    private func applyPoints(_ points: [GardenCoordinate], target: PointsTarget, context: ModelContext) {
        switch target {
        case .boundary:
            let boundary = ensureBoundary(context: context)
            boundary.points = points
            boundary.updatedAt = .now
            if boundary.syncStatus != .pendingCreate { boundary.syncStatus = .pendingUpdate }
        case .area(let area):
            area.points = points
            area.updatedAt = .now
            if area.syncStatus != .pendingCreate { area.syncStatus = .pendingUpdate }
        }
        try? context.save()
        objectWillChange.send()
    }

    // MARK: - Objects (Phase 6C)

    /// Delete is deliberately NOT undo-able (unlike add/move/rotate/
    /// resize below): reversing it means resurrecting a SwiftData
    /// object after `context.delete` has already invalidated it and a
    /// PendingDeletion tombstone has been recorded, which risks the
    /// exact kind of sync/data-integrity bug the Phase 4 data-loss
    /// incident came from. The rest of this app deletes behind a
    /// confirmation dialog instead of an undo stack (see
    /// GardenDetailView's zone deletion) — object removal follows that
    /// same, already-established convention.
    @discardableResult
    func addObject(type: GardenObjectType, at position: GardenCoordinate, context: ModelContext) -> GardenMapObject {
        let object = GardenMapObject(garden: garden, objectType: type, position: position)
        context.insert(object)
        try? context.save()
        undoManager.setActionName("Ajouter \(type.label.lowercased())")
        undoManager.registerUndo(withTarget: self) { engine in
            engine.removeObject(object, context: context)
        }
        objectWillChange.send()
        return object
    }

    func moveObject(_ object: GardenMapObject, to position: GardenCoordinate, context: ModelContext) {
        let old = object.position
        object.position = position
        markUpdated(object, context: context)
        undoManager.setActionName("Déplacer")
        undoManager.registerUndo(withTarget: self) { engine in
            engine.moveObject(object, to: old, context: context)
        }
    }

    func rotateObject(_ object: GardenMapObject, to rotationRadians: Double, context: ModelContext) {
        let old = object.rotationRadians
        object.rotationRadians = rotationRadians
        markUpdated(object, context: context)
        undoManager.setActionName("Pivoter")
        undoManager.registerUndo(withTarget: self) { engine in
            engine.rotateObject(object, to: old, context: context)
        }
    }

    func resizeObject(_ object: GardenMapObject, widthMeters: Double, heightMeters: Double, context: ModelContext) {
        let oldWidth = object.widthMeters
        let oldHeight = object.heightMeters
        object.widthMeters = widthMeters
        object.heightMeters = heightMeters
        markUpdated(object, context: context)
        undoManager.setActionName("Redimensionner")
        undoManager.registerUndo(withTarget: self) { engine in
            engine.resizeObject(object, widthMeters: oldWidth, heightMeters: oldHeight, context: context)
        }
    }

    func setCanopy(_ object: GardenMapObject, currentMeters: Double?, adultMeters: Double?, context: ModelContext) {
        object.canopyDiameterMeters = currentMeters
        object.estimatedAdultCanopyDiameterMeters = adultMeters
        markUpdated(object, context: context)
    }

    /// Not undo-tracked, same reasoning as canopy/label edits: a minor
    /// property change the user can just redo from the inspector,
    /// rather than every field edit growing its own undo step.
    func linkObject(_ object: GardenMapObject, entityId: UUID?, kind: GardenObjectLinkKind?, context: ModelContext) {
        object.linkedEntityId = entityId
        object.linkedEntityKind = kind
        markUpdated(object, context: context)
    }

    func renameObject(_ object: GardenMapObject, label: String, context: ModelContext) {
        object.label = label.isEmpty ? nil : label
        markUpdated(object, context: context)
    }

    func removeObject(_ object: GardenMapObject, context: ModelContext) {
        selectedObjectIDs.remove(object.id)
        DeletionService.delete(object, in: context)
        try? context.save()
        objectWillChange.send()
    }

    private func markUpdated(_ object: GardenMapObject, context: ModelContext) {
        object.updatedAt = .now
        if object.syncStatus != .pendingCreate { object.syncStatus = .pendingUpdate }
        try? context.save()
        objectWillChange.send()
    }

    /// Spec Phase 6C — "toucher l'objet ouvre la vraie fiche." A plain
    /// lookup rather than a typed relationship (see GardenMapObject's
    /// doc comment); returns nil for a dangling or wrong-kind link
    /// instead of treating it as an error.
    func resolvedLinkedPlant(for object: GardenMapObject) -> Plant? {
        guard object.linkedEntityKind == .plant, let id = object.linkedEntityId else { return nil }
        return garden.plants.first { $0.id == id }
    }

    func resolvedLinkedSensor(for object: GardenMapObject) -> Sensor? {
        guard object.linkedEntityKind == .sensor, let id = object.linkedEntityId else { return nil }
        return garden.sensors.first { $0.id == id }
    }
}
