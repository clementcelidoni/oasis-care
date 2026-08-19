import CoreLocation
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
    /// Spec Phase 6D — id of the IrrigationPipe currently being drawn,
    /// same mutual-exclusivity note as editingAreaID above.
    @Published var editingPipeID: UUID?
    /// Spec Phase 6D — "créer un mode : Afficher couverture."
    @Published var isShowingIrrigationCoverage = false

    /// Spec Phase 6E — GardenMapLayer visibility. Every layer starts
    /// visible so a freshly opened plan looks the same as before layers
    /// existed; toggling is purely additive UI state, not garden data.
    @Published var visibleLayers: Set<GardenMapLayer> = Set(GardenMapLayer.allCases)
    @Published var layerOpacities: [GardenMapLayer: Double] = [:]

    /// Spec Phase 6F — sun/shadow simulation state. Hour and date
    /// default to "now" so opening the simulation shows today's actual
    /// sun position first, matching the spec's own "le plan se met à
    /// jour" framing (start from reality, then let the user explore).
    @Published var isShowingShadows = false
    @Published var sunSimulationHour: Double = Double(Calendar.current.component(.hour, from: .now))
    @Published var sunSimulationDate: Date = .now

    /// Spec Phase 6G — "GardenTimeline," years from today. 0 = present
    /// (the plan looks exactly as it does everywhere else in the app);
    /// negative = mode passé, positive = mode futur.
    @Published var timelineYearOffset: Double = 0

    /// Spec Phase 6I — "GardenRoutePlanner." nil when no inspection
    /// round is active.
    @Published var activeRoute: [GardenRoutePlanner.Stop]?
    @Published var activeRouteStepIndex: Int = 0
    /// Selected for the "action groupée géographique" flow — nil unless
    /// the user has explicitly picked a zone to bulk-act on.
    @Published var bulkActionAreaID: UUID?

    /// Spec Phase 6K — "GardenMeasurementTool... choisir deux points /
    /// sélectionner un polygone." A dedicated, throwaway point list
    /// rather than another PointsTarget case: boundary/area/pipe points
    /// are real, persisted, snap-and-undo-aware shapes, while a
    /// measurement is read once and discarded — reusing that heavier
    /// machinery for numbers nobody keeps would be the wrong tool.
    @Published var isMeasuring = false
    @Published var measurementPoints: [GardenCoordinate] = []

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

    // MARK: - Layers (Phase 6E)

    func opacity(for layer: GardenMapLayer) -> Double {
        layerOpacities[layer] ?? 1.0
    }

    func setOpacity(_ value: Double, for layer: GardenMapLayer) {
        layerOpacities[layer] = value
    }

    func toggleLayer(_ layer: GardenMapLayer) {
        if visibleLayers.contains(layer) {
            visibleLayers.remove(layer)
        } else {
            visibleLayers.insert(layer)
        }
    }

    func applyLayerProfile(_ profile: GardenMapLayerProfile) {
        visibleLayers = profile.layers
    }

    /// An object type not covered by any layer (there isn't one today,
    /// but a future GardenObjectType addition shouldn't silently vanish
    /// from the plan just because nothing gates it yet) stays visible.
    func isObjectVisible(_ object: GardenMapObject) -> Bool {
        for layer in GardenMapLayer.allCases where layer.gatedObjectTypes.contains(object.objectType) {
            return visibleLayers.contains(layer)
        }
        return true
    }

    // MARK: - Point-polygon editing (Phase 6B boundary, Phase 6C areas)

    /// What a batch of points belongs to — lets addPoint/movePoint/
    /// deletePoint/undo share one implementation for both the single
    /// GardenBoundary and any number of GardenArea zones, instead of
    /// duplicating the same snap/undo/save logic per polygon kind.
    private enum PointsTarget {
        case boundary
        case area(GardenArea)
        case pipe(IrrigationPipe)
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

    /// Spec Phase 6F — GardenMicroclimate's descriptive fields.
    func setMicroclimate(
        _ area: GardenArea, sunLevel: MicroclimateSunLevel?, windLevel: MicroclimateWindLevel?,
        soilLevel: MicroclimateSoilLevel?, notes: String?, context: ModelContext
    ) {
        area.microclimateSunLevel = sunLevel
        area.microclimateWindLevel = windLevel
        area.microclimateSoilLevel = soilLevel
        area.microclimateNotes = (notes?.isEmpty ?? true) ? nil : notes
        area.updatedAt = .now
        if area.syncStatus != .pendingCreate { area.syncStatus = .pendingUpdate }
        try? context.save()
        objectWillChange.send()
    }

    // MARK: - Irrigation pipes (Phase 6D)

    func pipe(withID id: UUID) -> IrrigationPipe? {
        garden.irrigationPipes.first { $0.id == id }
    }

    func points(forPipe pipeID: UUID) -> [GardenCoordinate] {
        pipe(withID: pipeID)?.points ?? []
    }

    @discardableResult
    func addPipe(lineType: PipeLineType, context: ModelContext) -> IrrigationPipe {
        let diameter = lineType == .dripLine ? 16.0 : 25.0
        let pipe = IrrigationPipe(garden: garden, lineType: lineType, diameterMM: diameter)
        context.insert(pipe)
        try? context.save()
        objectWillChange.send()
        return pipe
    }

    func removePipe(_ pipe: IrrigationPipe, context: ModelContext) {
        if editingPipeID == pipe.id { editingPipeID = nil }
        DeletionService.delete(pipe, in: context)
        try? context.save()
        objectWillChange.send()
    }

    /// No snapping-to-angle here (unlike boundary/area points): a pipe
    /// route follows whatever path the user actually draws, not a
    /// geometric shape that benefits from 45°/90° regularization. Point-
    /// snap (closing onto an existing point, e.g. a node it connects to)
    /// still applies.
    func addPipePoint(_ raw: GardenCoordinate, pipeID: UUID, context: ModelContext) {
        guard let pipe = pipe(withID: pipeID) else { return }
        let point = GardenSnapping.snap(raw, previous: nil, existingPoints: pipe.points, enabled: snappingEnabled)
        setPoints(pipe.points + [point], target: .pipe(pipe), actionName: "Ajouter un point", context: context)
    }

    func movePipePoint(at index: Int, pipeID: UUID, to raw: GardenCoordinate, context: ModelContext) {
        guard let pipe = pipe(withID: pipeID) else { return }
        movePoint(at: index, to: raw, in: pipe.points, target: .pipe(pipe), context: context)
    }

    func deletePipePoint(at index: Int, pipeID: UUID, context: ModelContext) {
        guard let pipe = pipe(withID: pipeID) else { return }
        deletePoint(at: index, in: pipe.points, target: .pipe(pipe), context: context)
    }

    func setPipeNodes(_ pipe: IrrigationPipe, startObjectId: UUID?, endObjectId: UUID?, context: ModelContext) {
        pipe.startNodeObjectId = startObjectId
        pipe.endNodeObjectId = endObjectId
        pipe.updatedAt = .now
        if pipe.syncStatus != .pendingCreate { pipe.syncStatus = .pendingUpdate }
        try? context.save()
        objectWillChange.send()
    }

    func setPipeProperties(_ pipe: IrrigationPipe, diameterMM: Double, material: PipeMaterial, context: ModelContext) {
        pipe.diameterMM = diameterMM
        pipe.material = material
        pipe.updatedAt = .now
        if pipe.syncStatus != .pendingCreate { pipe.syncStatus = .pendingUpdate }
        try? context.save()
        objectWillChange.send()
    }

    /// Spec Phase 6D — "toucher" a pipe's ends resolves to whichever
    /// map object (valve, water source, sprinkler, pump...) it's
    /// connected to, same dangling-reference-safe lookup as
    /// resolvedLinkedPlant/resolvedLinkedSensor.
    func resolvedPipeNode(_ objectId: UUID?) -> GardenMapObject? {
        guard let objectId else { return nil }
        return garden.mapObjects.first { $0.id == objectId }
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
        case .pipe(let pipe): return pipe.points
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
        case .pipe(let pipe):
            pipe.points = points
            pipe.updatedAt = .now
            if pipe.syncStatus != .pendingCreate { pipe.syncStatus = .pendingUpdate }
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

    func setYearsToMaturity(_ object: GardenMapObject, years: Double?, context: ModelContext) {
        object.estimatedYearsToMaturity = years
        markUpdated(object, context: context)
    }

    /// Spec Phase 6D — SprinklerMapObject's radiusMeters/startAngle/
    /// endAngle/flowRate. Angles in degrees, startAngle can be greater
    /// than endAngle (the sector still sweeps the shorter way in
    /// drawSprinklerSector) so the inspector's sliders don't need to
    /// special-case a wrap-around at 0/360.
    func setSprinklerParameters(_ object: GardenMapObject, radiusMeters: Double, startAngleDegrees: Double, endAngleDegrees: Double, flowRateLitersPerHour: Double?, context: ModelContext) {
        object.sprinklerRadiusMeters = radiusMeters
        object.sprinklerStartAngleDegrees = startAngleDegrees
        object.sprinklerEndAngleDegrees = endAngleDegrees
        object.sprinklerFlowRateLitersPerHour = flowRateLitersPerHour
        markUpdated(object, context: context)
    }

    /// Spec Phase 6F — shadow-casting height, Saisie utilisateur (this
    /// app has no way to measure a structure's real height itself).
    func setStructureHeight(_ object: GardenMapObject, meters: Double?, context: ModelContext) {
        object.structureHeightMeters = meters
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

    // MARK: - Timeline (Phase 6G)

    /// Spec Phase 6G — the canopy diameter to actually draw for the
    /// current timelineYearOffset: recorded history in the past
    /// (Mesurée, from the linked Plant's own PlantMeasurement log, when
    /// one exists close enough to the target date), the growth
    /// projection in the future (Estimée), today's real value at 0.
    /// nil means "this object shouldn't be shown at all" — a plant that
    /// wasn't added yet as of the selected past date.
    func timelineCanopyDiameterMeters(for object: GardenMapObject) -> Double? {
        guard object.objectType.isVegetation else { return object.canopyDiameterMeters }
        let currentMeters = object.canopyDiameterMeters ?? object.widthMeters

        if timelineYearOffset < 0 {
            guard let plant = resolvedLinkedPlant(for: object) else { return currentMeters }
            let targetDate = Calendar.current.date(byAdding: .day, value: Int(timelineYearOffset * 365.25), to: .now) ?? .now
            guard plant.dateAdded <= targetDate else { return nil }
            let priorMeasurements = plant.measurements.filter { $0.date <= targetDate }.sorted { $0.date > $1.date }
            return priorMeasurements.first?.canopyDiameter ?? currentMeters
        } else if timelineYearOffset > 0 {
            guard let adultMeters = object.estimatedAdultCanopyDiameterMeters, adultMeters > currentMeters else { return currentMeters }
            let yearsToMaturity = object.estimatedYearsToMaturity ?? object.objectType.defaultYearsToMaturity ?? 15
            return GrowthSimulationService.projectedCanopyDiameterMeters(
                currentMeters: currentMeters, adultMeters: adultMeters, yearsFromNow: timelineYearOffset, yearsToMaturity: yearsToMaturity
            )
        }
        return currentMeters
    }

    /// Spec Phase 6G — "détecter : ces deux végétaux pourraient se
    /// chevaucher fortement à maturité" + "taille adulte estimée proche
    /// du mur." Only meaningful in mode futur; empty in mode passé/
    /// present, since there's nothing projected to warn about there.
    func timelineCollisionWarnings() -> [GrowthSimulationService.CollisionWarning] {
        guard timelineYearOffset > 0 else { return [] }
        let projected = garden.mapObjects
            .filter { $0.objectType.isVegetation }
            .compactMap { object -> (id: UUID, position: GardenCoordinate, projectedDiameterMeters: Double)? in
                guard let diameter = timelineCanopyDiameterMeters(for: object) else { return nil }
                return (object.id, object.position, diameter)
            }
        return GrowthSimulationService.detectCollisions(objects: projected)
    }

    func timelineProximityWarnings() -> [GrowthSimulationService.ProximityWarning] {
        guard timelineYearOffset > 0 else { return [] }
        let vegetation = garden.mapObjects
            .filter { $0.objectType.isVegetation }
            .compactMap { object -> (id: UUID, position: GardenCoordinate, projectedDiameterMeters: Double)? in
                guard let diameter = timelineCanopyDiameterMeters(for: object) else { return nil }
                return (object.id, object.position, diameter)
            }
        let structures = garden.mapObjects
            .filter { $0.objectType == .house || $0.objectType == .wall || $0.objectType == .greenhouse }
            .map { (id: $0.id, position: $0.position, widthMeters: $0.widthMeters) }
        return GrowthSimulationService.detectStructureProximity(vegetation: vegetation, structures: structures)
    }

    // MARK: - Route planner (Phase 6I)

    /// Spec Phase 6I — "commencer le check-up... générer un parcours
    /// raisonnable." Stops are every "checkable" thing placed on the
    /// plan: vegetation, greenhouses, ponds — matching the spec's own
    /// worked example (Phoenix, Olivier, massif tropical, citronnier,
    /// serre, bassin). `from` is the user's last known position when
    /// available (Saisie via a one-shot LocationService check in the
    /// route sheet), the garden origin otherwise.
    func startRoute(from start: GardenCoordinate) {
        let stops: [GardenRoutePlanner.Stop] = garden.mapObjects
            .filter { $0.objectType.isVegetation || $0.objectType == .greenhouse || $0.objectType == .pond }
            .map { object in
                let label = resolvedLinkedPlant(for: object)?.customName ?? object.label ?? object.objectType.label
                return GardenRoutePlanner.Stop(objectId: object.id, position: object.position, label: label)
            }
        activeRoute = GardenRoutePlanner.planRoute(from: start, stops: stops)
        activeRouteStepIndex = 0
        objectWillChange.send()
    }

    func confirmCurrentRouteStep() {
        guard let activeRoute, activeRouteStepIndex < activeRoute.count else { return }
        activeRouteStepIndex += 1
        objectWillChange.send()
    }

    func endRoute() {
        activeRoute = nil
        activeRouteStepIndex = 0
        objectWillChange.send()
    }

    // MARK: - Bulk zone actions (Phase 6I)

    /// Spec Phase 6I — "action groupée géographique... sélectionner
    /// cette zone." Plants whose GardenMapObject sits inside the zone's
    /// polygon — the same point-in-polygon test used throughout Phase
    /// 6D/6F/6H, applied here to gather real Plant records for bulk
    /// actions (arrosage groupé reuses the app's existing bulk-water
    /// flow via these plants).
    func plants(inArea area: GardenArea) -> [Plant] {
        garden.mapObjects
            .filter { $0.objectType.isVegetation && GardenGeometry.contains($0.position, polygon: area.points) }
            .compactMap { resolvedLinkedPlant(for: $0) }
    }

    /// Spec Phase 6I — "calque à faire... directement sur les zones,"
    /// with the spec's own example rendered as plain counts (12, 5, 3).
    /// Reuses CareSchedule.isDue — the same due/overdue signal already
    /// driving the dashboard and Planning tab — rather than a second,
    /// separately-defined notion of "needs attention."
    func pendingTaskCount(inArea area: GardenArea) -> Int {
        plants(inArea: area).reduce(0) { total, plant in
            total + plant.careSchedules.filter(\.isDue).count
        }
    }

    // MARK: - Réalité augmentée (Phase 6J)

    /// Spec Phase 6J — real-world targets for the AR HUD: every placed
    /// object converted from its local plan position to a real GPS
    /// coordinate via the garden's own GardenCoordinateSystem (the same
    /// conversion used by the route planner and "use my location").
    /// Objects placed before the garden had a latitude/longitude have
    /// no coordinate system to convert through and are simply skipped —
    /// there is no origin to measure them from, not a bug to work
    /// around.
    func arTargets() -> [ARTarget] {
        guard let coordinateSystem else { return [] }
        return garden.mapObjects.compactMap { object -> ARTarget? in
            let coordinate = coordinateSystem.geographic(from: object.position)

            if let plant = resolvedLinkedPlant(for: object) {
                var lines = ["Santé : \(plant.healthStatus.displayName)"]
                if let soilMoisture = latestSoilMoisture(for: plant) {
                    lines.insert("Humidité : \(Int(soilMoisture)) %", at: 0)
                }
                let inspectionDates = plant.treeInspections.map(\.date) + plant.checkupEntries.map(\.date)
                if let lastInspection = inspectionDates.max() {
                    lines.append("Dernière inspection : \(lastInspection.formatted(.dateTime.day().month(.wide)))")
                }
                return ARTarget(id: object.id, coordinate: coordinate, label: plant.customName, infoLines: lines, systemImage: object.objectType.icon)
            }

            if let sensor = resolvedLinkedSensor(for: object) {
                var lines = [sensor.type.displayName]
                if let latest = sensor.readings.max(by: { $0.timestamp < $1.timestamp }) {
                    lines.append("\(String(format: "%.1f", latest.value)) \(latest.unit)")
                }
                return ARTarget(id: object.id, coordinate: coordinate, label: sensor.name, infoLines: lines, systemImage: object.objectType.icon)
            }

            guard object.objectType == .sensor else { return nil }
            return ARTarget(id: object.id, coordinate: coordinate, label: object.label ?? object.objectType.label, infoLines: [], systemImage: object.objectType.icon)
        }
    }

    /// Only a sensor directly linked to this exact plant counts — a
    /// zone- or garden-scoped average shown as if it were this plant's
    /// own reading would mislabel an estimate as a measurement, exactly
    /// what this app's data-provenance rules exist to prevent.
    private func latestSoilMoisture(for plant: Plant) -> Double? {
        garden.sensors
            .first { $0.type == .soilMoisture && $0.plant?.id == plant.id }?
            .readings.max(by: { $0.timestamp < $1.timestamp })?.value
    }

    // MARK: - Mesures (Phase 6K)

    func addMeasurementPoint(_ point: GardenCoordinate) {
        measurementPoints.append(point)
        objectWillChange.send()
    }

    func undoLastMeasurementPoint() {
        guard !measurementPoints.isEmpty else { return }
        measurementPoints.removeLast()
        objectWillChange.send()
    }

    func clearMeasurement() {
        isMeasuring = false
        measurementPoints = []
        objectWillChange.send()
    }

    // MARK: - Plan importé (Phase 6K)

    /// Spec Phase 6K — "Importer un plan." Mirrors ensureBoundary's own
    /// to-one replacement pattern: this app keeps at most one imported
    /// plan per garden, so importing a new image replaces whichever one
    /// was there, uncalibrated and unaligned until the user redoes both
    /// steps for the new image.
    @Published var isAligningPlanImage = false

    func importPlanImage(data: Data, context: ModelContext) {
        if let existing = garden.planImage {
            context.delete(existing)
        }
        let planImage = GardenPlanImage(garden: garden, imageData: data)
        context.insert(planImage)
        garden.planImage = planImage
    }

    func removePlanImage(context: ModelContext) {
        guard let planImage = garden.planImage else { return }
        context.delete(planImage)
        garden.planImage = nil
        isAligningPlanImage = false
    }

    /// "CALIBRATION... le moteur calcule l'échelle." Points are in the
    /// source image's own pixel space (see GardenPlanImage's doc
    /// comment); only their distance matters here.
    func setPlanImageCalibration(pointA: CGPoint, pointB: CGPoint, realDistanceMeters: Double) {
        guard let planImage = garden.planImage else { return }
        planImage.calibrationPointAX = pointA.x
        planImage.calibrationPointAY = pointA.y
        planImage.calibrationPointBX = pointB.x
        planImage.calibrationPointBY = pointB.y
        planImage.calibrationRealDistanceMeters = max(realDistanceMeters, 0.01)
        objectWillChange.send()
    }

    /// "ALIGNEMENT: déplacement." Nudge-based rather than a drag
    /// gesture on the canvas: dragging there already pans the camera
    /// (combinedGesture, always active so the user can reach a large
    /// garden while editing anything else), and layering a second,
    /// competing drag target on the same gesture would need suppressing
    /// that pan — real added complexity for one alignment step. Fixed-
    /// step nudges sidestep the conflict entirely and are precise by
    /// construction.
    func movePlanImage(by delta: GardenCoordinate) {
        guard let planImage = garden.planImage else { return }
        planImage.position = planImage.position + delta
        objectWillChange.send()
    }

    /// "ALIGNEMENT: rotation."
    func rotatePlanImage(by radians: Double) {
        guard let planImage = garden.planImage else { return }
        planImage.rotationRadians += radians
        objectWillChange.send()
    }

    /// "ALIGNEMENT: opacité."
    func setPlanImageOpacity(_ opacity: Double) {
        garden.planImage?.opacity = min(max(opacity, 0.1), 1)
        objectWillChange.send()
    }
}
