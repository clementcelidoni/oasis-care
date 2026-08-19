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
        case pipes
        case layers
        case sunSimulation
        case timeline

        var id: String {
            switch self {
            case .objectPicker: return "objectPicker"
            case .areas: return "areas"
            case .objectInspector(let object): return "inspector-\(object.id)"
            case .pipes: return "pipes"
            case .layers: return "layers"
            case .sunSimulation: return "sunSimulation"
            case .timeline: return "timeline"
            }
        }
    }

    private static let coordinateSpaceName = "oasisPlanCanvas"

    private var isEditingPolygon: Bool {
        engine.isEditingBoundary || engine.editingAreaID != nil || engine.editingPipeID != nil
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
            case .pipes:
                IrrigationPipesSheet(engine: engine)
            case .layers:
                GardenLayersSheet(engine: engine)
            case .sunSimulation:
                SunSimulationSheet(engine: engine)
            case .timeline:
                GardenTimelineSheet(engine: engine)
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
                } else if let pipeID = engine.editingPipeID {
                    selectedHandleIndex = nil
                    engine.addPipePoint(point, pipeID: pipeID, context: modelContext)
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
        if engine.visibleLayers.contains(.soilMoisture) {
            drawSensorHeatmap(in: context, size: size, camera: camera, sensorType: .soilMoisture, layer: .soilMoisture)
        }
        if engine.visibleLayers.contains(.temperature) {
            drawSensorHeatmap(in: context, size: size, camera: camera, sensorType: .airTemperature, layer: .temperature)
        }
        if engine.visibleLayers.contains(.irrigation) {
            drawSprinklerSectors(in: context, size: size, camera: camera)
            drawSprinklerCoverage(in: context, size: size, camera: camera)
            drawPipes(in: context, size: size, camera: camera)
        }
        drawShadows(in: context, size: size, camera: camera)
        drawBoundary(in: context, size: size, camera: camera)
        drawOrigin(in: context, size: size, camera: camera)
        drawScaleBar(in: context, size: size, camera: camera)
    }

    /// Spec Phase 6F — "dans une première version : utiliser les objets
    /// possédant une hauteur... calculer une approximation. Indiquer
    /// clairement : Simulation estimée." Each shadow is a single thick
    /// line pointing away from the sun, length = height / tan(elevation)
    /// (capped so a low sun near sunrise/sunset can't produce an
    /// absurdly long line) — a deliberately simple approximation, not a
    /// precise silhouette polygon, matching the spec's own framing.
    /// Azimuth (compass, 0°=N clockwise) is converted to
    /// GardenCoordinate's math convention (0°=E counter-clockwise) here,
    /// the same conversion pattern used for every other angle in this
    /// file, before the direction is used.
    private func drawShadows(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        guard engine.isShowingShadows, let latitude = engine.garden.latitude else { return }
        let sunPosition = SunExposureService.sunPosition(latitude: latitude, date: engine.sunSimulationDate, hour: engine.sunSimulationHour)
        guard sunPosition.isAboveHorizon else { return }

        let shadowCasters = engine.garden.mapObjects.filter { $0.objectType.castsShadow && $0.structureHeightMeters != nil }
        guard !shadowCasters.isEmpty else { return }

        let mathAngleDegrees = 90 - sunPosition.azimuthDegrees
        let shadowDirectionRadians = (mathAngleDegrees + 180) * .pi / 180
        let elevationRadians = max(sunPosition.elevationDegrees, 1) * .pi / 180

        for object in shadowCasters {
            guard let heightMeters = object.structureHeightMeters else { continue }
            let shadowLengthMeters = min(heightMeters / tan(elevationRadians), 60)
            let shadowEnd = GardenCoordinate(
                xMeters: object.position.xMeters + shadowLengthMeters * cos(shadowDirectionRadians),
                yMeters: object.position.yMeters + shadowLengthMeters * sin(shadowDirectionRadians)
            )

            var path = Path()
            path.move(to: camera.screenPoint(for: object.position, viewSize: size))
            path.addLine(to: camera.screenPoint(for: shadowEnd, viewSize: size))
            let lineWidth = max(camera.points(forMeters: object.widthMeters), 4)
            context.stroke(path, with: .color(.black.opacity(0.28)), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        }
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

    /// Spec Phase 6D — pipes as a drawn polyline, differentiated by
    /// line type (color + dash pattern, never color alone) with a
    /// diameter label at the midpoint once zoomed in enough to read it.
    private func drawPipes(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        for pipe in engine.garden.irrigationPipes {
            let points = pipe.points
            guard points.count >= 2 else { continue }

            var path = Path()
            path.move(to: camera.screenPoint(for: points[0], viewSize: size))
            for point in points.dropFirst() {
                path.addLine(to: camera.screenPoint(for: point, viewSize: size))
            }

            let isActive = engine.editingPipeID == pipe.id
            context.stroke(
                path,
                with: .color(pipe.lineType.color.opacity(isActive ? 1 : 0.85)),
                style: StrokeStyle(
                    lineWidth: isActive ? pipe.lineType.lineWidth + 1.5 : pipe.lineType.lineWidth,
                    lineCap: .round, lineJoin: .round, dash: pipe.lineType.dashPattern
                )
            )

            guard camera.pointsPerMeter > 6 else { continue }
            let midpoint = camera.screenPoint(for: points[points.count / 2], viewSize: size)
            context.draw(
                Text("Ø\(Int(pipe.diameterMM)) mm").font(.caption2.weight(.medium)).foregroundStyle(pipe.lineType.color),
                at: CGPoint(x: midpoint.x, y: midpoint.y - 10)
            )
        }
    }

    /// Spec Phase 6D — "afficher graphiquement son secteur d'arrosage"
    /// (always visible, distinct from the coverage heatmap toggle
    /// below). Built by sampling points along the arc with
    /// GardenCoordinate math and the same `screenPoint` conversion used
    /// everywhere else in this file, rather than SwiftUI's own
    /// Path.addArc — that API's angle sign/direction convention in
    /// screen space (Y grows down) is easy to get backwards, and this
    /// sidesteps the question entirely by reusing an already-correct
    /// conversion instead of a second, separately-verified one.
    private func drawSprinklerSectors(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        let sprinklers = engine.garden.mapObjects.filter { $0.objectType == .sprinkler && $0.sprinklerRadiusMeters != nil }
        for sprinkler in sprinklers {
            guard let radius = sprinkler.sprinklerRadiusMeters,
                  let startAngle = sprinkler.sprinklerStartAngleDegrees,
                  let endAngle = sprinkler.sprinklerEndAngleDegrees else { continue }

            var sweepDegrees = endAngle - startAngle
            if sweepDegrees <= 0 { sweepDegrees += 360 }
            let stepCount = max(Int(sweepDegrees / 6), 1)

            var path = Path()
            let centerScreen = camera.screenPoint(for: sprinkler.position, viewSize: size)
            path.move(to: centerScreen)
            for step in 0...stepCount {
                let angleDegrees = startAngle + sweepDegrees * Double(step) / Double(stepCount)
                let angleRadians = angleDegrees * .pi / 180
                let edgePoint = GardenCoordinate(
                    xMeters: sprinkler.position.xMeters + radius * cos(angleRadians),
                    yMeters: sprinkler.position.yMeters + radius * sin(angleRadians)
                )
                path.addLine(to: camera.screenPoint(for: edgePoint, viewSize: size))
            }
            path.closeSubpath()

            context.fill(path, with: .color(.blue.opacity(0.08)))
            context.stroke(path, with: .color(.blue.opacity(0.4)), style: StrokeStyle(lineWidth: 1, dash: sweepDegrees >= 359.9 ? [] : [3, 2]))
        }
    }

    // MARK: - Heatmaps (Phase 6E)

    private struct HeatGrid {
        var minX: Double
        var minY: Double
        var columnCount: Int
        var rowCount: Int
        var cellMeters: Double
    }

    private func heatGrid(size: CGSize, camera: GardenMapCamera, cellMeters: Double, cap: Int) -> HeatGrid? {
        let topLeft = camera.localPoint(for: .zero, viewSize: size)
        let bottomRight = camera.localPoint(for: CGPoint(x: size.width, y: size.height), viewSize: size)
        let minX = min(topLeft.xMeters, bottomRight.xMeters)
        let maxX = max(topLeft.xMeters, bottomRight.xMeters)
        let minY = min(topLeft.yMeters, bottomRight.yMeters)
        let maxY = max(topLeft.yMeters, bottomRight.yMeters)
        let columnCount = Int((maxX - minX) / cellMeters)
        let rowCount = Int((maxY - minY) / cellMeters)
        guard columnCount > 0, rowCount > 0, columnCount * rowCount < cap else { return nil }
        return HeatGrid(minX: minX, minY: minY, columnCount: columnCount, rowCount: rowCount, cellMeters: cellMeters)
    }

    private func screenRect(forCellAt column: Int, row: Int, grid: HeatGrid, camera: GardenMapCamera, size: CGSize) -> CGRect {
        let cellMinX = grid.minX + Double(column) * grid.cellMeters
        let cellMinY = grid.minY + Double(row) * grid.cellMeters
        let corner1 = camera.screenPoint(for: GardenCoordinate(xMeters: cellMinX, yMeters: cellMinY), viewSize: size)
        let corner2 = camera.screenPoint(
            for: GardenCoordinate(xMeters: cellMinX + grid.cellMeters, yMeters: cellMinY + grid.cellMeters), viewSize: size
        )
        return CGRect(
            x: min(corner1.x, corner2.x), y: min(corner1.y, corner2.y),
            width: abs(corner2.x - corner1.x), height: abs(corner2.y - corner1.y)
        )
    }

    /// Spec Phase 6E — soil moisture / temperature heatmaps: "utiliser
    /// les capteurs de la Phase 5. Interpolation seulement si
    /// suffisamment de données. Ne pas donner une fausse précision.
    /// Afficher Mesuré/Estimé distinctement." Only Sensors actually
    /// placed on the plan (linked to a GardenMapObject) can contribute
    /// — a sensor with no known position genuinely can't feed a spatial
    /// heatmap, so it's correctly excluded rather than guessed at.
    /// Measured cells get a solid fill; estimated cells get a lighter
    /// fill plus a dashed border, so the distinction survives even if
    /// the color itself is hard to judge (screen glare, colorblindness).
    private func drawSensorHeatmap(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera, sensorType: SensorType, layer: GardenMapLayer) {
        let samples: [GardenHeatmapEngine.Sample] = engine.garden.mapObjects.compactMap { object in
            guard object.objectType == .sensor,
                  let sensor = engine.resolvedLinkedSensor(for: object),
                  sensor.type == sensorType,
                  let value = sensor.latestReading?.value else { return nil }
            return GardenHeatmapEngine.Sample(position: object.position, value: value)
        }
        guard !samples.isEmpty, let grid = heatGrid(size: size, camera: camera, cellMeters: 1.0, cap: 6000) else { return }

        let opacityScale = engine.opacity(for: layer)
        for column in 0..<grid.columnCount {
            for row in 0..<grid.rowCount {
                let cellCenter = GardenCoordinate(
                    xMeters: grid.minX + (Double(column) + 0.5) * grid.cellMeters,
                    yMeters: grid.minY + (Double(row) + 0.5) * grid.cellMeters
                )
                guard let result = GardenHeatmapEngine.estimate(at: cellCenter, samples: samples) else { continue }
                let rect = screenRect(forCellAt: column, row: row, grid: grid, camera: camera, size: size)
                let color = heatmapColor(for: sensorType, value: result.value)
                if result.isMeasured {
                    context.fill(Path(rect), with: .color(color.opacity(0.55 * opacityScale)))
                } else {
                    context.fill(Path(rect), with: .color(color.opacity(0.22 * opacityScale)))
                    context.stroke(Path(rect), with: .color(color.opacity(0.4 * opacityScale)), style: StrokeStyle(lineWidth: 0.5, dash: [2, 2]))
                }
            }
        }
    }

    /// Fixed, sensible ranges (0-100% for soil moisture, 0-40°C for air
    /// temperature) rather than ranges computed from the samples
    /// themselves — a dynamic range would make the same color mean
    /// different things garden to garden, which is more confusing than
    /// clarifying.
    private func heatmapColor(for sensorType: SensorType, value: Double) -> Color {
        switch sensorType {
        case .soilMoisture:
            let normalized = min(max(value / 100, 0), 1)
            return Color(hue: 0.08 + normalized * 0.5, saturation: 0.7, brightness: 0.85)
        case .airTemperature:
            let normalized = min(max(value / 40, 0), 1)
            return Color(hue: 0.6 - normalized * 0.6, saturation: 0.7, brightness: 0.85)
        default:
            return .gray
        }
    }

    /// Spec Phase 6D — "afficher couverture" + "heatmap de couverture
    /// (0/1/2/3+ passages), ne pas utiliser seulement des couleurs."
    /// Rasterizes the visible area into ~1m cells and counts, per cell,
    /// how many sprinkler sectors reach it — a coarse approximation
    /// (not exact vector geometry) capped in cell count the same way
    /// drawGrid caps its line count, so a large property zoomed way out
    /// never tries to evaluate tens of thousands of cells in one frame.
    /// Whether this stays smooth while panning on a real device is
    /// unverified in this environment.
    private func drawSprinklerCoverage(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        guard engine.isShowingIrrigationCoverage else { return }
        let sprinklers = engine.garden.mapObjects.filter { $0.objectType == .sprinkler && $0.sprinklerRadiusMeters != nil }
        guard !sprinklers.isEmpty else { return }

        let cellMeters = 1.0
        let topLeft = camera.localPoint(for: .zero, viewSize: size)
        let bottomRight = camera.localPoint(for: CGPoint(x: size.width, y: size.height), viewSize: size)
        let minX = min(topLeft.xMeters, bottomRight.xMeters)
        let maxX = max(topLeft.xMeters, bottomRight.xMeters)
        let minY = min(topLeft.yMeters, bottomRight.yMeters)
        let maxY = max(topLeft.yMeters, bottomRight.yMeters)

        let columnCount = Int((maxX - minX) / cellMeters)
        let rowCount = Int((maxY - minY) / cellMeters)
        guard columnCount > 0, rowCount > 0, columnCount * rowCount < 6000 else { return }

        for column in 0..<columnCount {
            for row in 0..<rowCount {
                let cellMinX = minX + Double(column) * cellMeters
                let cellMinY = minY + Double(row) * cellMeters
                let cellCenter = GardenCoordinate(xMeters: cellMinX + cellMeters / 2, yMeters: cellMinY + cellMeters / 2)
                let passCount = sprinklers.reduce(0) { count, sprinkler in
                    count + (isCellCovered(cellCenter, by: sprinkler) ? 1 : 0)
                }
                guard passCount > 0 else { continue }

                let corner1 = camera.screenPoint(for: GardenCoordinate(xMeters: cellMinX, yMeters: cellMinY), viewSize: size)
                let corner2 = camera.screenPoint(for: GardenCoordinate(xMeters: cellMinX + cellMeters, yMeters: cellMinY + cellMeters), viewSize: size)
                let rect = CGRect(
                    x: min(corner1.x, corner2.x), y: min(corner1.y, corner2.y),
                    width: abs(corner2.x - corner1.x), height: abs(corner2.y - corner1.y)
                )

                context.fill(Path(rect), with: .color(coverageColor(for: passCount)))
                drawCoverageDots(in: context, rect: rect, count: min(passCount - 1, 3))
            }
        }
    }

    private func isCellCovered(_ point: GardenCoordinate, by sprinkler: GardenMapObject) -> Bool {
        guard let radius = sprinkler.sprinklerRadiusMeters,
              let startAngle = sprinkler.sprinklerStartAngleDegrees,
              let endAngle = sprinkler.sprinklerEndAngleDegrees else { return false }
        let delta = point - sprinkler.position
        guard delta.length <= radius else { return false }
        if startAngle <= 0, endAngle >= 360 { return true }

        var angle = atan2(delta.yMeters, delta.xMeters) * 180 / .pi
        if angle < 0 { angle += 360 }
        let normalizedStart = startAngle.truncatingRemainder(dividingBy: 360)
        let normalizedEnd = endAngle.truncatingRemainder(dividingBy: 360)
        if normalizedStart <= normalizedEnd {
            return angle >= normalizedStart && angle <= normalizedEnd
        } else {
            return angle >= normalizedStart || angle <= normalizedEnd
        }
    }

    private func coverageColor(for passCount: Int) -> Color {
        switch passCount {
        case 1: return .blue.opacity(0.15)
        case 2: return .blue.opacity(0.3)
        default: return .blue.opacity(0.5)
        }
    }

    /// The non-color half of the coverage signal: 0 dots at 1 pass, up
    /// to 3 dots at 3+ passes, so the tier still reads in grayscale.
    private func drawCoverageDots(in context: GraphicsContext, rect: CGRect, count: Int) {
        guard count > 0 else { return }
        let dotRadius: CGFloat = 1.2
        let spacing: CGFloat = 4
        let totalWidth = CGFloat(count - 1) * spacing
        let startX = rect.midX - totalWidth / 2
        for index in 0..<count {
            let x = startX + CGFloat(index) * spacing
            let dot = Path(ellipseIn: CGRect(x: x - dotRadius, y: rect.midY - dotRadius, width: dotRadius * 2, height: dotRadius * 2))
            context.fill(dot, with: .color(.white.opacity(0.9)))
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
        // Spec Phase 6G — "afficher l'état du jardin... végétaux
        // présents": a plant not yet added as of the selected past date
        // (timelineCanopyDiameterMeters returning nil) is hidden, not
        // just drawn small.
        let objects = engine.garden.mapObjects
            .filter { engine.isObjectVisible($0) }
            .filter { !$0.objectType.isVegetation || engine.timelineCanopyDiameterMeters(for: $0) != nil }
            .sorted { $0.zIndex < $1.zIndex }
        let showCanopies = engine.visibleLayers.contains(.canopies)
        let healthColorProvider: (GardenMapObject) -> Color? = { engine.resolvedLinkedPlant(for: $0)?.healthStatus.color }
        let healthColor = engine.visibleLayers.contains(.health) ? healthColorProvider : nil
        return ForEach(objects) { object in
            let base = camera.screenPoint(for: object.position, viewSize: geometry.size)
            let isDragging = objectDrag?.id == object.id
            let display = isDragging
                ? CGPoint(x: base.x + (objectDrag?.translation.width ?? 0), y: base.y + (objectDrag?.translation.height ?? 0))
                : base

            GardenObjectMarkerView(
                object: object, camera: camera, isSelected: engine.selectedObjectIDs.contains(object.id),
                showCanopy: showCanopies, healthTint: healthColor?(object),
                canopyDiameterOverrideMeters: engine.timelineCanopyDiameterMeters(for: object)
            )
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
        if let pipeID = engine.editingPipeID { return engine.points(forPipe: pipeID) }
        return []
    }

    private func moveActivePoint(at index: Int, to point: GardenCoordinate) {
        if engine.isEditingBoundary {
            engine.moveBoundaryPoint(at: index, to: point, context: modelContext)
        } else if let areaID = engine.editingAreaID {
            engine.moveAreaPoint(at: index, areaID: areaID, to: point, context: modelContext)
        } else if let pipeID = engine.editingPipeID {
            engine.movePipePoint(at: index, pipeID: pipeID, to: point, context: modelContext)
        }
    }

    private func deleteActivePoint(at index: Int) {
        if engine.isEditingBoundary {
            engine.deleteBoundaryPoint(at: index, context: modelContext)
        } else if let areaID = engine.editingAreaID {
            engine.deleteAreaPoint(at: index, areaID: areaID, context: modelContext)
        } else if let pipeID = engine.editingPipeID {
            engine.deletePipePoint(at: index, pipeID: pipeID, context: modelContext)
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
            } else if engine.editingPipeID != nil {
                Button {
                    withAnimation(.snappy) {
                        engine.editingPipeID = nil
                        selectedHandleIndex = nil
                    }
                } label: {
                    Image(systemName: "checkmark.circle.fill")
                }
                .accessibilityLabel("Terminer le tuyau")

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

                Button {
                    activeSheet = .pipes
                } label: {
                    Image(systemName: "point.topleft.down.curvedto.point.bottomright.up")
                }
                .accessibilityLabel("Réseau d'irrigation")

                Button {
                    engine.isShowingIrrigationCoverage.toggle()
                } label: {
                    Image(systemName: engine.isShowingIrrigationCoverage ? "drop.circle.fill" : "drop.circle")
                }
                .accessibilityLabel("Afficher la couverture d'arrosage")

                Button {
                    activeSheet = .layers
                } label: {
                    Image(systemName: "square.3.layers.3d")
                }
                .accessibilityLabel("Calques")

                Button {
                    activeSheet = .sunSimulation
                } label: {
                    Image(systemName: "sun.max.fill")
                }
                .accessibilityLabel("Soleil et ombres")

                Button {
                    activeSheet = .timeline
                } label: {
                    Image(systemName: "clock.arrow.circlepath")
                }
                .accessibilityLabel("Voyage dans le temps")
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
/// Spec Phase 6E — the Houppiers layer toggles the canopy circle off
/// (falling back to a plain marker) independently of whether the
/// vegetation object shows at all; the Santé layer, when on and this
/// object is linked to a Plant, tints the marker by healthStatus
/// instead of the default color — spec's own "jamais la couleur seule"
/// rule still holds since the icon/shape itself doesn't change.
private struct GardenObjectMarkerView: View {
    var object: GardenMapObject
    var camera: GardenMapCamera
    var isSelected: Bool
    var showCanopy: Bool = true
    var healthTint: Color?
    /// Spec Phase 6G — the timeline's diameter for this object (past
    /// recorded size, future projection, or today's real value), when
    /// the caller already resolved one via
    /// GardenMapEngine.timelineCanopyDiameterMeters. Falls back to the
    /// object's own current canopy when nil (e.g. this marker isn't
    /// vegetation, or the caller didn't compute one).
    var canopyDiameterOverrideMeters: Double?

    var body: some View {
        Group {
            if object.objectType.isVegetation && showCanopy {
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
        let diameterMeters = canopyDiameterOverrideMeters ?? object.canopyDiameterMeters ?? object.widthMeters
        let diameterPoints = max(camera.points(forMeters: diameterMeters), 14)
        return ZStack {
            Circle()
                .fill((healthTint ?? Color.green).opacity(0.35))
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
            .background((healthTint ?? Color.accentColor).gradient, in: Circle())
    }
}
