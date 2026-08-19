import SwiftData
import SwiftUI

/// Spec Phase 6A/6B/6C — OasisPlan's own vector rendering surface: a
/// Canvas driven by GardenMapEngine's camera, with pinch/pan/rotate
/// gestures, a boundary/zone point editor in the "type robot tondeuse"
/// style, and placed GardenMapObjects (icons, or trunk+canopy for
/// vegetation). Exactly one tool is active at a time — editing the
/// boundary, drawing a zone, or placing an object — dispatched from a
/// single tap-gesture entry point (`addPointGesture`) so the three
/// never compete for the same touch.
///
/// Gesture composition (drag/magnify/rotate all recognizing at once via
/// nested `.simultaneously(with:)`, tap-to-add via `.simultaneousGesture`
/// mirroring the same pattern already shipped in Phase 4C's
/// PlacePlantOnMapSheet) is the standard SwiftUI approach for this, but
/// the actual feel — does pinch+rotate+pan+tap truly disambiguate
/// smoothly together — can only be confirmed on a real device; this
/// environment has no simulator to check it in.
struct OasisPlanView: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext

    @GestureState private var dragTranslation: CGSize = .zero
    @GestureState private var liveMagnification: CGFloat = 1.0
    @GestureState private var liveRotation: Angle = .zero
    @GestureState private var handleDrag: HandleDrag?
    @GestureState private var objectDrag: ObjectDrag?

    @State private var selectedHandleIndex: Int?
    @State private var activeSheet: ActiveSheet?

    private struct HandleDrag: Equatable {
        var index: Int
        var translation: CGSize
    }

    private struct ObjectDrag: Equatable {
        var id: UUID
        var translation: CGSize
    }

    /// One enum + one `.sheet(item:)` rather than three separate
    /// `.sheet` modifiers chained on this view — chaining multiple
    /// `.sheet`s on one view is a bug class this codebase already hit
    /// once (PlantDetailView/GardenDetailView, Phase 1) and fixed by
    /// unifying to a single ActiveSheet enum; this follows that same
    /// established fix rather than reintroducing the bug.
    private enum ActiveSheet: Identifiable {
        case objectPicker
        case areas
        case objectInspector(GardenMapObject)

        var id: String {
            switch self {
            case .objectPicker: return "objectPicker"
            case .areas: return "areas"
            case .objectInspector(let object): return "inspector-\(object.id)"
            }
        }
    }

    private static let coordinateSpaceName = "oasisPlanCanvas"

    private var isEditingPolygon: Bool {
        engine.isEditingBoundary || engine.editingAreaID != nil
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topTrailing) {
                Canvas { context, size in
                    draw(in: context, size: size)
                }
                .background(Color(.secondarySystemBackground))
                .contentShape(Rectangle())
                .gesture(combinedGesture())
                .simultaneousGesture(addPointGesture(geometry: geometry))

                objectsOverlay(geometry: geometry)
                    .allowsHitTesting(!isEditingPolygon)

                if isEditingPolygon {
                    handlesOverlay(geometry: geometry)
                }

                controlCluster
                    .padding(12)
            }
            .coordinateSpace(name: Self.coordinateSpaceName)
            .overlay(alignment: .top) {
                if let placingType = engine.placingObjectType {
                    placingBanner(type: placingType)
                }
            }
        }
        .clipped()
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .objectPicker:
                GardenObjectPickerSheet(engine: engine)
            case .areas:
                GardenAreasSheet(engine: engine)
            case .objectInspector(let object):
                GardenObjectInspectorSheet(engine: engine, object: object)
            }
        }
    }

    private var liveCamera: GardenMapCamera {
        var camera = engine.camera
        camera.scale = clampedScale(camera.scale * liveMagnification)
        camera.rotationRadians += liveRotation.radians
        let pointsPerMeter = camera.pointsPerMeter
        guard pointsPerMeter > 0 else { return camera }
        camera.centerMeters.xMeters -= dragTranslation.width / pointsPerMeter
        camera.centerMeters.yMeters += dragTranslation.height / pointsPerMeter
        return camera
    }

    private func clampedScale(_ scale: Double) -> Double {
        min(max(scale, GardenMapCamera.minScale), GardenMapCamera.maxScale)
    }

    private func combinedGesture() -> some Gesture {
        let drag = DragGesture()
            .updating($dragTranslation) { value, state, _ in
                state = value.translation
            }
            .onEnded { value in
                let pointsPerMeter = engine.camera.pointsPerMeter
                guard pointsPerMeter > 0 else { return }
                engine.camera.centerMeters.xMeters -= value.translation.width / pointsPerMeter
                engine.camera.centerMeters.yMeters += value.translation.height / pointsPerMeter
            }

        let magnify = MagnificationGesture()
            .updating($liveMagnification) { value, state, _ in
                state = value
            }
            .onEnded { value in
                engine.camera.scale = clampedScale(engine.camera.scale * value)
            }

        let rotate = RotationGesture()
            .updating($liveRotation) { value, state, _ in
                state = value
            }
            .onEnded { value in
                engine.camera.rotationRadians += value.radians
            }

        return drag.simultaneously(with: magnify).simultaneously(with: rotate)
    }

    /// Single dispatch point for a tap on empty canvas: exactly one of
    /// boundary-editing, zone-editing, or object-placement is active at
    /// a time, so there's no ambiguity about what a tap means. Falls
    /// through to clearing selection when none are active — tapping
    /// empty space deselects, matching standard map-editor behavior.
    private func addPointGesture(geometry: GeometryProxy) -> some Gesture {
        SpatialTapGesture()
            .onEnded { value in
                let point = engine.camera.localPoint(for: value.location, viewSize: geometry.size)
                if engine.isEditingBoundary {
                    selectedHandleIndex = nil
                    engine.addBoundaryPoint(point, context: modelContext)
                } else if let areaID = engine.editingAreaID {
                    selectedHandleIndex = nil
                    engine.addAreaPoint(point, areaID: areaID, context: modelContext)
                } else if let type = engine.placingObjectType {
                    let object = engine.addObject(type: type, at: point, context: modelContext)
                    engine.placingObjectType = nil
                    engine.select(object.id)
                    activeSheet = .objectInspector(object)
                } else {
                    engine.clearSelection()
                }
            }
    }

    private func draw(in context: GraphicsContext, size: CGSize) {
        let camera = liveCamera
        drawGrid(in: context, size: size, camera: camera)
        drawAreas(in: context, size: size, camera: camera)
        drawBoundary(in: context, size: size, camera: camera)
        drawOrigin(in: context, size: size, camera: camera)
        drawScaleBar(in: context, size: size, camera: camera)
    }

    /// One line per meter, every 5th line stronger — a drawing/
    /// orientation aid, not a garden object. Skipped entirely when
    /// zoomed out enough that lines would be sub-pixel mush, and capped
    /// on line count so a huge property zoomed way out never tries to
    /// draw thousands of lines in one frame.
    private func drawGrid(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        guard camera.pointsPerMeter > 4 else { return }

        let topLeft = camera.localPoint(for: .zero, viewSize: size)
        let bottomRight = camera.localPoint(for: CGPoint(x: size.width, y: size.height), viewSize: size)
        let minX = Int(min(topLeft.xMeters, bottomRight.xMeters).rounded(.down)) - 1
        let maxX = Int(max(topLeft.xMeters, bottomRight.xMeters).rounded(.up)) + 1
        let minY = Int(min(topLeft.yMeters, bottomRight.yMeters).rounded(.down)) - 1
        let maxY = Int(max(topLeft.yMeters, bottomRight.yMeters).rounded(.up)) + 1
        guard (maxX - minX) < 400, (maxY - minY) < 400 else { return }

        for x in stride(from: minX, through: maxX, by: 1) {
            let isMajor = x % 5 == 0
            var path = Path()
            path.move(to: camera.screenPoint(for: GardenCoordinate(xMeters: Double(x), yMeters: Double(minY)), viewSize: size))
            path.addLine(to: camera.screenPoint(for: GardenCoordinate(xMeters: Double(x), yMeters: Double(maxY)), viewSize: size))
            context.stroke(path, with: .color(.secondary.opacity(isMajor ? 0.28 : 0.12)), lineWidth: isMajor ? 1 : 0.5)
        }
        for y in stride(from: minY, through: maxY, by: 1) {
            let isMajor = y % 5 == 0
            var path = Path()
            path.move(to: camera.screenPoint(for: GardenCoordinate(xMeters: Double(minX), yMeters: Double(y)), viewSize: size))
            path.addLine(to: camera.screenPoint(for: GardenCoordinate(xMeters: Double(maxX), yMeters: Double(y)), viewSize: size))
            context.stroke(path, with: .color(.secondary.opacity(isMajor ? 0.28 : 0.12)), lineWidth: isMajor ? 1 : 0.5)
        }
    }

    /// Spec Phase 6B — the property outline: an open polyline while
    /// only 1-2 points exist (still visible feedback while drawing), a
    /// filled closed polygon from 3 points on.
    private func drawBoundary(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        let points = engine.boundaryPoints
        guard points.count >= 2 else { return }

        var path = Path()
        path.move(to: camera.screenPoint(for: points[0], viewSize: size))
        for point in points.dropFirst() {
            path.addLine(to: camera.screenPoint(for: point, viewSize: size))
        }
        if points.count >= 3 {
            path.closeSubpath()
            context.fill(path, with: .color(.green.opacity(0.12)))
        }
        context.stroke(path, with: .color(.green), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
    }

    /// Spec Phase 6C — zones, colored by type; a no-go zone additionally
    /// gets a diagonal-hatch fill so it never reads as "just a colored
    /// area" to a colorblind user (spec elsewhere insists on this same
    /// color+symbol rule for health status).
    private func drawAreas(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        for area in engine.garden.areas {
            let points = area.points
            guard points.count >= 2 else { continue }

            var path = Path()
            path.move(to: camera.screenPoint(for: points[0], viewSize: size))
            for point in points.dropFirst() {
                path.addLine(to: camera.screenPoint(for: point, viewSize: size))
            }
            let isClosed = points.count >= 3
            if isClosed { path.closeSubpath() }

            let isActive = engine.editingAreaID == area.id
            if isClosed {
                context.fill(path, with: .color(area.areaType.color.opacity(0.22)))
                if area.areaType.isNoGo {
                    drawHatching(in: context, clippedTo: path, size: size, color: area.areaType.color.opacity(0.5))
                }
            }
            context.stroke(
                path,
                with: .color(area.areaType.color.opacity(isActive ? 1 : 0.8)),
                style: StrokeStyle(lineWidth: isActive ? 3 : 1.5, lineCap: .round, lineJoin: .round, dash: area.areaType.isNoGo ? [6, 4] : [])
            )
        }
    }

    private func drawHatching(in context: GraphicsContext, clippedTo path: Path, size: CGSize, color: Color) {
        var hatchContext = context
        hatchContext.clip(to: path)
        let spacing: CGFloat = 10
        let diagonal = size.width + size.height
        var offset: CGFloat = -diagonal
        while offset < diagonal {
            var line = Path()
            line.move(to: CGPoint(x: offset, y: 0))
            line.addLine(to: CGPoint(x: offset + size.height, y: size.height))
            hatchContext.stroke(line, with: .color(color), lineWidth: 1)
            offset += spacing
        }
    }

    private func drawOrigin(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        let center = camera.screenPoint(for: .zero, viewSize: size)
        let radius: CGFloat = 4
        let dot = Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
        context.fill(dot, with: .color(.accentColor))
    }

    private func drawScaleBar(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        let targetPoints: Double = 80
        let metersForTarget = targetPoints / camera.pointsPerMeter
        let niceMeters = Self.niceScaleValue(metersForTarget)
        let barWidth = camera.points(forMeters: niceMeters)

        let originPoint = CGPoint(x: 16, y: size.height - 28)
        var path = Path()
        path.move(to: originPoint)
        path.addLine(to: CGPoint(x: originPoint.x + barWidth, y: originPoint.y))
        context.stroke(path, with: .color(.primary.opacity(0.7)), lineWidth: 2)

        let label = niceMeters >= 1000 ? "\((niceMeters / 1000).formatted()) km" : "\(Int(niceMeters)) m"
        context.draw(
            Text(label).font(.caption2.weight(.medium)).foregroundStyle(.primary.opacity(0.7)),
            at: CGPoint(x: originPoint.x + barWidth / 2, y: originPoint.y - 10)
        )
    }

    /// Rounds to a "nice" 1/2/5×10^n value so the scale bar reads a
    /// legible number rather than an arbitrary one like "73 m".
    private static func niceScaleValue(_ raw: Double) -> Double {
        guard raw > 0 else { return 1 }
        let magnitude = pow(10, floor(log10(raw)))
        let fraction = raw / magnitude
        let niceFraction: Double = fraction < 1.5 ? 1 : (fraction < 3.5 ? 2 : (fraction < 7.5 ? 5 : 10))
        return niceFraction * magnitude
    }

    // MARK: - Objects (Phase 6C)

    private func objectsOverlay(geometry: GeometryProxy) -> some View {
        let camera = liveCamera
        let objects = engine.garden.mapObjects.sorted { $0.zIndex < $1.zIndex }
        return ForEach(objects) { object in
            let base = camera.screenPoint(for: object.position, viewSize: geometry.size)
            let isDragging = objectDrag?.id == object.id
            let display = isDragging
                ? CGPoint(x: base.x + (objectDrag?.translation.width ?? 0), y: base.y + (objectDrag?.translation.height ?? 0))
                : base

            GardenObjectMarkerView(object: object, camera: camera, isSelected: engine.selectedObjectIDs.contains(object.id))
                .position(display)
                .simultaneousGesture(
                    TapGesture().onEnded {
                        engine.select(object.id)
                        activeSheet = .objectInspector(object)
                    }
                )
                .gesture(objectDragGesture(object: object, geometry: geometry))
        }
    }

    private func objectDragGesture(object: GardenMapObject, geometry: GeometryProxy) -> some Gesture {
        DragGesture(coordinateSpace: .named(Self.coordinateSpaceName))
            .updating($objectDrag) { value, state, _ in
                state = ObjectDrag(id: object.id, translation: value.translation)
            }
            .onEnded { value in
                let point = engine.camera.localPoint(for: value.location, viewSize: geometry.size)
                engine.moveObject(object, to: point, context: modelContext)
            }
    }

    private func placingBanner(type: GardenObjectType) -> some View {
        HStack {
            Image(systemName: type.icon)
            Text("Touchez le plan pour placer : \(type.label)")
                .font(.subheadline.weight(.medium))
            Spacer()
            Button("Annuler") { engine.placingObjectType = nil }
                .font(.subheadline.weight(.semibold))
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    // MARK: - Boundary/zone handles (Phase 6B, generalized in 6C)

    /// Points of whichever polygon is currently being edited — the
    /// boundary or one GardenArea — and dispatch helpers so the handle
    /// rendering/drag/delete code below doesn't need to know which.
    private var activePoints: [GardenCoordinate] {
        if engine.isEditingBoundary { return engine.boundaryPoints }
        if let areaID = engine.editingAreaID { return engine.points(forArea: areaID) }
        return []
    }

    private func moveActivePoint(at index: Int, to point: GardenCoordinate) {
        if engine.isEditingBoundary {
            engine.moveBoundaryPoint(at: index, to: point, context: modelContext)
        } else if let areaID = engine.editingAreaID {
            engine.moveAreaPoint(at: index, areaID: areaID, to: point, context: modelContext)
        }
    }

    private func deleteActivePoint(at index: Int) {
        if engine.isEditingBoundary {
            engine.deleteBoundaryPoint(at: index, context: modelContext)
        } else if let areaID = engine.editingAreaID {
            engine.deleteAreaPoint(at: index, areaID: areaID, context: modelContext)
        }
    }

    /// Rendered as real SwiftUI views layered over the Canvas, not
    /// drawn inside it — Canvas is immediate-mode drawing with no
    /// hit-testing of its own, so draggable/tappable handles need an
    /// actual view hierarchy on top of it. A single shared
    /// `@GestureState` (`handleDrag`) tags which index is being
    /// dragged, since only one finger/handle can be active at a time.
    private func handlesOverlay(geometry: GeometryProxy) -> some View {
        let camera = liveCamera
        let points = activePoints
        return ForEach(Array(points.enumerated()), id: \.offset) { index, point in
            let base = camera.screenPoint(for: point, viewSize: geometry.size)
            let isDragging = handleDrag?.index == index
            let display = isDragging
                ? CGPoint(x: base.x + (handleDrag?.translation.width ?? 0), y: base.y + (handleDrag?.translation.height ?? 0))
                : base

            handleView(index: index, isSelected: selectedHandleIndex == index)
                .position(display)
                .simultaneousGesture(
                    TapGesture().onEnded {
                        selectedHandleIndex = (selectedHandleIndex == index) ? nil : index
                    }
                )
                .gesture(handleDragGesture(index: index, geometry: geometry))

            if isDragging, let label = dragDistanceLabel(index: index, geometry: geometry) {
                Text(label)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(.black.opacity(0.75), in: Capsule())
                    .foregroundStyle(.white)
                    .position(x: display.x, y: display.y - 24)
            }

            if selectedHandleIndex == index, !isDragging {
                Button {
                    deleteActivePoint(at: index)
                    selectedHandleIndex = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .red)
                }
                .position(x: display.x + 16, y: display.y - 16)
            }
        }
    }

    private func handleView(index: Int, isSelected: Bool) -> some View {
        Circle()
            .fill(isSelected ? Color.orange : Color.green)
            .frame(width: 22, height: 22)
            .overlay(Circle().stroke(.white, lineWidth: 2))
            .overlay(
                Text("\(index + 1)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
            )
            .shadow(radius: 1)
    }

    private func handleDragGesture(index: Int, geometry: GeometryProxy) -> some Gesture {
        DragGesture(coordinateSpace: .named(Self.coordinateSpaceName))
            .updating($handleDrag) { value, state, _ in
                state = HandleDrag(index: index, translation: value.translation)
            }
            .onChanged { _ in
                if engine.draggingBoundaryPointIndex != index {
                    engine.draggingBoundaryPointIndex = index
                }
            }
            .onEnded { value in
                let point = engine.camera.localPoint(for: value.location, viewSize: geometry.size)
                moveActivePoint(at: index, to: point)
                engine.draggingBoundaryPointIndex = nil
            }
    }

    private func dragDistanceLabel(index: Int, geometry: GeometryProxy) -> String? {
        guard index > 0, let handleDrag, handleDrag.index == index else { return nil }
        let points = activePoints
        guard points.indices.contains(index - 1) else { return nil }
        let base = liveCamera.screenPoint(for: points[index], viewSize: geometry.size)
        let display = CGPoint(x: base.x + handleDrag.translation.width, y: base.y + handleDrag.translation.height)
        let liveLocal = liveCamera.localPoint(for: display, viewSize: geometry.size)
        let distance = liveLocal.distance(to: points[index - 1])
        return String(format: "%.2f m", distance)
    }

    // MARK: - Controls

    private var controlCluster: some View {
        VStack(spacing: 10) {
            if engine.isEditingBoundary {
                Button {
                    withAnimation(.snappy) {
                        engine.isEditingBoundary = false
                        selectedHandleIndex = nil
                    }
                } label: {
                    Image(systemName: "checkmark.circle.fill")
                }
                .accessibilityLabel("Terminer la modification du contour")

                snapUndoRedoControls
            } else if engine.editingAreaID != nil {
                Button {
                    withAnimation(.snappy) {
                        engine.editingAreaID = nil
                        selectedHandleIndex = nil
                    }
                } label: {
                    Image(systemName: "checkmark.circle.fill")
                }
                .accessibilityLabel("Terminer la zone")

                snapUndoRedoControls
            } else {
                Button {
                    withAnimation(.snappy) { engine.isEditingBoundary = true }
                } label: {
                    Image(systemName: "pencil.circle.fill")
                }
                .accessibilityLabel("Modifier le contour du jardin")

                Button {
                    activeSheet = .objectPicker
                } label: {
                    Image(systemName: "plus.circle.fill")
                }
                .accessibilityLabel("Ajouter un objet")

                Button {
                    activeSheet = .areas
                } label: {
                    Image(systemName: "square.on.square.fill")
                }
                .accessibilityLabel("Zones du jardin")
            }

            Button {
                withAnimation(.snappy) { engine.resetCamera() }
            } label: {
                Image(systemName: "scope")
            }
            .accessibilityLabel("Recentrer la carte")
        }
        .font(.system(size: 28))
        .symbolRenderingMode(.multicolor)
        .buttonStyle(.plain)
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var snapUndoRedoControls: some View {
        Group {
            Button {
                engine.snappingEnabled.toggle()
            } label: {
                Image(systemName: engine.snappingEnabled ? "lock.fill" : "lock.open.fill")
            }
            .accessibilityLabel("Alignement automatique")

            Button {
                engine.undoManager.undo()
            } label: {
                Image(systemName: "arrow.uturn.backward.circle.fill")
            }
            .disabled(!engine.undoManager.canUndo)
            .accessibilityLabel("Annuler")

            Button {
                engine.undoManager.redo()
            } label: {
                Image(systemName: "arrow.uturn.forward.circle.fill")
            }
            .disabled(!engine.undoManager.canRedo)
            .accessibilityLabel("Rétablir")
        }
    }
}

/// Spec Phase 6C — "représenter tronc + houppier" for vegetation, sized
/// from canopyDiameterMeters when known; every other object type is a
/// simple icon badge. A thicker accent ring marks the selected object.
private struct GardenObjectMarkerView: View {
    var object: GardenMapObject
    var camera: GardenMapCamera
    var isSelected: Bool

    var body: some View {
        Group {
            if object.objectType.isVegetation {
                vegetationView
            } else {
                iconView
            }
        }
        .rotationEffect(.radians(object.rotationRadians))
        .overlay(
            Circle()
                .stroke(Color.accentColor, lineWidth: isSelected ? 3 : 0)
                .padding(-4)
        )
    }

    private var vegetationView: some View {
        let diameterMeters = object.canopyDiameterMeters ?? object.widthMeters
        let diameterPoints = max(camera.points(forMeters: diameterMeters), 14)
        return ZStack {
            Circle()
                .fill(Color.green.opacity(0.35))
                .frame(width: diameterPoints, height: diameterPoints)
            Circle()
                .fill(Color.brown)
                .frame(width: 8, height: 8)
        }
    }

    private var iconView: some View {
        let sizePoints = max(camera.points(forMeters: max(object.widthMeters, object.heightMeters)), 20)
        return Image(systemName: object.objectType.icon)
            .font(.system(size: min(sizePoints * 0.5, 22)))
            .foregroundStyle(.white)
            .frame(width: sizePoints, height: sizePoints)
            .background(Color.accentColor.gradient, in: Circle())
    }
}
