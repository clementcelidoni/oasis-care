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

    /// Les tuyaux passent par une `@Query` et non par
    /// `engine.garden.irrigationPipes`, alors que le dessin, lui, a
    /// toujours été là (`drawPipes`, Phase 6D).
    ///
    /// La raison est une subtilité de `Canvas` : sa fermeture de rendu
    /// est appelée APRÈS l'évaluation du `body`, donc ce qu'on y lit
    /// n'est pas enregistré comme dépendance de la vue. Les objets
    /// s'en sortaient par accident — `objectsOverlay` lit
    /// `garden.mapObjects` dans le `body`, ce qui redessine tout le
    /// reste au passage. Les tuyaux n'avaient personne : une
    /// synchronisation qui descendait un réseau tracé sur Oasis Care Pro
    /// pendant que le plan était à l'écran ne repeignait rien. Une
    /// `@Query` est, elle, une vraie dépendance que SwiftData invalide
    /// à l'insertion, à la modification ET à la suppression.
    ///
    /// Sans prédicat : filtrer sur une relation (`$0.garden?.id == ...`)
    /// dans un `#Predicate` est le genre de chose qui compile et
    /// renvoie vide à l'exécution. Le tri par date de création
    /// reproduit celui d'`IrrigationPipesSheet`, pour que la liste et
    /// le plan superposent les tuyaux dans le même ordre.
    @Query(sort: \IrrigationPipe.createdAt) private var allPipes: [IrrigationPipe]

    @GestureState private var dragTranslation: CGSize = .zero
    @GestureState private var liveMagnification: CGFloat = 1.0
    @GestureState private var liveRotation: Angle = .zero
    @GestureState private var handleDrag: HandleDrag?
    @GestureState private var objectDrag: ObjectDrag?

    @State private var selectedHandleIndex: Int?
    @State private var activeSheet: ActiveSheet?
    /// Le cadrage automatique n'a lieu qu'une fois par apparition de la
    /// vue : recadrer à chaque changement de données déplacerait la
    /// carte sous le doigt de l'utilisateur pendant qu'il travaille.
    @State private var hasFramedContent = false

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
        case whereToPlant
        case route
        case augmentedReality
        case mapAI

        var id: String {
            switch self {
            case .objectPicker: return "objectPicker"
            case .areas: return "areas"
            case .objectInspector(let object): return "inspector-\(object.id)"
            case .pipes: return "pipes"
            case .layers: return "layers"
            case .sunSimulation: return "sunSimulation"
            case .timeline: return "timeline"
            case .whereToPlant: return "whereToPlant"
            case .route: return "route"
            case .augmentedReality: return "augmentedReality"
            case .mapAI: return "mapAI"
            }
        }
    }

    private static let coordinateSpaceName = "oasisPlanCanvas"

    private var isEditingPolygon: Bool {
        engine.isEditingBoundary || engine.editingAreaID != nil || engine.editingPipeID != nil
    }

    /// Les tuyaux de CE jardin. Le filtre est fait ici plutôt que dans
    /// la requête (voir `allPipes`) ; un réseau se compte en dizaines de
    /// lignes, pas en milliers.
    private var gardenPipes: [IrrigationPipe] {
        allPipes.filter { $0.garden?.id == engine.garden.id }
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
                    .allowsHitTesting(!isEditingPolygon && !engine.isMeasuring)

                if isEditingPolygon {
                    handlesOverlay(geometry: geometry)
                }

                controlCluster(geometry: geometry)
                    .padding(12)
            }
            .coordinateSpace(name: Self.coordinateSpaceName)
            .onAppear {
                // Cadrer sur le contenu à l'ouverture, comme le fait
                // l'éditeur web à son chargement. Sans ça le plan
                // s'ouvre sur l'origine (0, 0) du repère local, qui
                // n'est pas forcément là où le jardin a été dessiné :
                // un réseau tracé à trente mètres de là restait hors
                // de l'écran, dessiné mais invisible.
                //
                // Deux verrous plutôt qu'un : la vue est recréée à
                // chaque changement de mode de carte, alors que la
                // caméra, elle, vit dans le moteur et survit. Ne cadrer
                // que sur une caméra restée à sa valeur par défaut,
                // c'est ne jamais reprendre à l'utilisateur un zoom
                // qu'il a réglé lui-même.
                guard !hasFramedContent, engine.camera == GardenMapCamera() else { return }
                hasFramedContent = true
                engine.fitToContent(viewSize: geometry.size)
            }
            .overlay(alignment: .top) {
                if let placingType = engine.placingObjectType {
                    placingBanner(type: placingType)
                } else if engine.isMeasuring {
                    measurementBanner
                } else if engine.isAligningPlanImage {
                    planImageAlignmentBanner
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
            case .whereToPlant:
                WhereToPlantSheet(engine: engine)
            case .route:
                GardenRouteSheet(engine: engine)
            case .augmentedReality:
                GardenARSheet(engine: engine)
            case .mapAI:
                GardenMapAIQuerySheet(engine: engine)
            }
        }
        .onAppear {
            if engine.visibleLayers.contains(.satelliteBackground) {
                engine.loadSatelliteBackgroundIfNeeded()
            }
        }
        .onChange(of: engine.visibleLayers) { _, layers in
            if layers.contains(.satelliteBackground) {
                engine.loadSatelliteBackgroundIfNeeded()
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
                } else if engine.isMeasuring {
                    engine.addMeasurementPoint(point)
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
        if engine.visibleLayers.contains(.satelliteBackground) {
            drawSatelliteBackground(in: context, size: size, camera: camera)
        }
        drawGrid(in: context, size: size, camera: camera)
        drawPlanImage(in: context, size: size, camera: camera)
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
        if engine.visibleLayers.contains(.interventions) {
            drawTaskBadges(in: context, size: size, camera: camera)
        }
        if engine.isMeasuring {
            drawMeasurementPoints(in: context, size: size, camera: camera)
        }
        drawAIHighlights(in: context, size: size, camera: camera)
        drawOrigin(in: context, size: size, camera: camera)
        drawScaleBar(in: context, size: size, camera: camera)
    }

    /// Spec Phase 6L — "mettre en évidence une ou plusieurs zones" plus
    /// the design-mode placement preview, both purely additive overlays
    /// on top of the normal drawAreas fill/stroke.
    private func drawAIHighlights(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        if !engine.aiHighlightedZoneIDs.isEmpty {
            for area in engine.garden.areas where engine.aiHighlightedZoneIDs.contains(area.id) && area.points.count >= 3 {
                var path = Path()
                let screenPoints = area.points.map { camera.screenPoint(for: $0, viewSize: size) }
                path.move(to: screenPoints[0])
                for point in screenPoints.dropFirst() { path.addLine(to: point) }
                path.closeSubpath()
                context.stroke(path, with: .color(.purple), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round, dash: [10, 6]))
            }
        }

        for placement in engine.aiProposedPlacements {
            let center = camera.screenPoint(for: placement.position, viewSize: size)
            let radius: CGFloat = 10
            let rect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            context.stroke(Circle().path(in: rect), with: .color(.purple), style: StrokeStyle(lineWidth: 2, dash: [4, 3]))
            context.draw(
                Text(placement.label).font(.caption2.weight(.semibold)).foregroundStyle(.purple),
                at: CGPoint(x: center.x, y: center.y - radius - 10)
            )
        }
    }

    /// Spec Phase 6K — the points the user has tapped while measuring,
    /// joined by a dashed open path plus a lighter dashed closing
    /// segment once there are enough points to read as a polygon (the
    /// same threshold GardenMeasurementTool uses to also start showing
    /// a perimeter/area, in measurementBanner below).
    private func drawMeasurementPoints(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        let points = engine.measurementPoints
        guard !points.isEmpty else { return }
        let screenPoints = points.map { camera.screenPoint(for: $0, viewSize: size) }

        var path = Path()
        path.move(to: screenPoints[0])
        for point in screenPoints.dropFirst() {
            path.addLine(to: point)
        }
        context.stroke(path, with: .color(.yellow), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [6, 3]))

        if screenPoints.count >= 3, let first = screenPoints.first, let last = screenPoints.last {
            var closingPath = Path()
            closingPath.move(to: last)
            closingPath.addLine(to: first)
            context.stroke(closingPath, with: .color(.yellow.opacity(0.5)), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [3, 3]))
        }

        for point in screenPoints {
            let rect = CGRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8)
            context.fill(Circle().path(in: rect), with: .color(.yellow))
            context.stroke(Circle().path(in: rect), with: .color(.black), lineWidth: 1)
        }
    }

    private var measurementBanner: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "ruler")
                Text(engine.measurementPoints.isEmpty ? "Touchez le plan pour commencer une mesure." : "Touchez pour ajouter un point.")
                    .font(.subheadline.weight(.medium))
                Spacer()
            }
            if engine.measurementPoints.count >= 2 {
                Text("Distance : \(String(format: "%.2f m", GardenMeasurementTool.pathLengthMeters(engine.measurementPoints, closed: false)))")
                    .font(.subheadline)
                if engine.measurementPoints.count >= 3 {
                    Text("Périmètre (fermé) : \(String(format: "%.2f m", GardenMeasurementTool.pathLengthMeters(engine.measurementPoints, closed: true)))")
                        .font(.subheadline)
                    Text("Surface : \(String(format: "%.2f m²", GardenMeasurementTool.areaSquareMeters(engine.measurementPoints)))")
                        .font(.subheadline)
                }
            }
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    /// Spec Phase 6K — "ALIGNEMENT: rotation / déplacement / opacité."
    /// Nudge buttons instead of a drag gesture on the canvas — see
    /// GardenMapEngine.movePlanImage's doc comment for why — with a
    /// live view of the actual plan behind this banner the whole time,
    /// which a covering sheet couldn't offer.
    private var planImageAlignmentBanner: some View {
        VStack(spacing: 10) {
            Text("Alignez le plan importé sur le jardin réel.")
                .font(.subheadline.weight(.medium))

            HStack(spacing: 20) {
                VStack(spacing: 4) {
                    Button { engine.movePlanImage(by: GardenCoordinate(xMeters: 0, yMeters: 0.5)) } label: {
                        Image(systemName: "arrow.up.circle.fill")
                    }
                    HStack(spacing: 24) {
                        Button { engine.movePlanImage(by: GardenCoordinate(xMeters: -0.5, yMeters: 0)) } label: {
                            Image(systemName: "arrow.left.circle.fill")
                        }
                        Button { engine.movePlanImage(by: GardenCoordinate(xMeters: 0.5, yMeters: 0)) } label: {
                            Image(systemName: "arrow.right.circle.fill")
                        }
                    }
                    Button { engine.movePlanImage(by: GardenCoordinate(xMeters: 0, yMeters: -0.5)) } label: {
                        Image(systemName: "arrow.down.circle.fill")
                    }
                }
                .font(.title2)

                VStack(spacing: 8) {
                    HStack(spacing: 20) {
                        Button { engine.rotatePlanImage(by: -.pi / 36) } label: {
                            Image(systemName: "rotate.left.circle.fill")
                        }
                        Button { engine.rotatePlanImage(by: .pi / 36) } label: {
                            Image(systemName: "rotate.right.circle.fill")
                        }
                    }
                    .font(.title2)

                    HStack {
                        Image(systemName: "circle.lefthalf.filled")
                            .foregroundStyle(.secondary)
                        Slider(value: Binding(
                            get: { engine.garden.planImage?.opacity ?? 0.6 },
                            set: { engine.setPlanImageOpacity($0) }
                        ), in: 0.1...1)
                        .frame(width: 120)
                    }
                }
            }

            Button("Terminer l'alignement") {
                engine.isAligningPlanImage = false
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    /// Spec Phase 6I — "à faire" layer: a plain count badge centered on
    /// each zone, matching the spec's own worked example (12, 5, 3)
    /// rather than a heatmap or icon list — the count itself is already
    /// the information.
    private func drawTaskBadges(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        for area in engine.garden.areas {
            guard area.points.count >= 3 else { continue }
            let count = engine.pendingTaskCount(inArea: area)
            guard count > 0 else { continue }

            let center = camera.screenPoint(for: GardenGeometry.centroid(of: area.points), viewSize: size)
            let radius: CGFloat = 12
            let badgeRect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
            context.fill(Circle().path(in: badgeRect), with: .color(.red))
            context.stroke(Circle().path(in: badgeRect), with: .color(.white), lineWidth: 1.5)
            context.draw(
                Text("\(count)").font(.caption2.weight(.bold)).foregroundStyle(.white),
                at: center
            )
        }
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
    /// Spec Phase 6K — the imported/calibrated/aligned background plan
    /// the user traces over. Rotation combines the image's own
    /// alignment rotation with the camera's current rotation so the
    /// image stays world-locked (rotates with the garden, not with the
    /// screen) — camera.screenPoint already applies camera rotation to
    /// the image's *position*; this applies the same rotation to its
    /// own orientation using the identical clockwise-positive
    /// convention that function's own doc comment establishes.
    private func drawPlanImage(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        guard let planImage = engine.garden.planImage, planImage.isVisible,
              let metersPerPixel = planImage.metersPerPixel,
              let uiImage = UIImage(data: planImage.imageData) else { return }

        let widthMeters = uiImage.size.width * metersPerPixel
        let heightMeters = uiImage.size.height * metersPerPixel
        guard widthMeters > 0, heightMeters > 0 else { return }

        let center = camera.screenPoint(for: planImage.position, viewSize: size)
        let widthPoints = camera.points(forMeters: widthMeters)
        let heightPoints = camera.points(forMeters: heightMeters)

        var imageContext = context
        imageContext.opacity = planImage.opacity
        imageContext.translateBy(x: center.x, y: center.y)
        imageContext.rotate(by: .radians(camera.rotationRadians + planImage.rotationRadians))
        let rect = CGRect(x: -widthPoints / 2, y: -heightPoints / 2, width: widthPoints, height: heightPoints)
        imageContext.draw(Image(uiImage: uiImage), in: rect)
    }

    /// Spec Phase 6A — "GeographicMap: fond géographique" behind the
    /// vector plan. Unlike drawPlanImage (a user-imported image with
    /// its own independent rotation), this rectangle is already
    /// axis-aligned to local X/Y by construction (see
    /// GardenMapEngine.satelliteRegionAndLocalBounds), so only the
    /// camera's own rotation applies here.
    private func drawSatelliteBackground(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        guard let background = engine.satelliteBackground else { return }
        let centerLocal = GardenCoordinate(
            xMeters: background.localOrigin.xMeters + background.widthMeters / 2,
            yMeters: background.localOrigin.yMeters + background.heightMeters / 2
        )
        let center = camera.screenPoint(for: centerLocal, viewSize: size)
        let widthPoints = camera.points(forMeters: background.widthMeters)
        let heightPoints = camera.points(forMeters: background.heightMeters)

        var imageContext = context
        imageContext.opacity = engine.opacity(for: .satelliteBackground)
        imageContext.translateBy(x: center.x, y: center.y)
        imageContext.rotate(by: .radians(camera.rotationRadians))
        let rect = CGRect(x: -widthPoints / 2, y: -heightPoints / 2, width: widthPoints, height: heightPoints)
        imageContext.draw(Image(uiImage: background.image), in: rect)
    }

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
    ///
    /// Parité avec le web : `PIPE_STYLE` (`web-pro/lib/twin/types.ts`)
    /// et `PipeLineType` posent déjà les mêmes épaisseurs (3 / 2 / 1,5)
    /// et les mêmes tiretés ([] / [6,3] / [1,3]), donc le même réseau
    /// se lit pareil des deux côtés. L'étiquette, elle, divergeait : le
    /// web écrit la longueur mesurée, l'iPhone écrivait le diamètre —
    /// deux chiffres différents sur le même tuyau selon l'écran. Elle
    /// porte maintenant les deux.
    private func drawPipes(in context: GraphicsContext, size: CGSize, camera: GardenMapCamera) {
        for pipe in gardenPipes {
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

            // Seuil de 4 pt/m, celui du web (`camera.pixelsPerMeter > 4`),
            // et une plaque claire derrière le texte pour la même raison
            // qu'il en met une : posée à même un fond satellite, une
            // légende de couleur ne se lit pas.
            guard camera.pointsPerMeter > 4 else { continue }
            let midpoint = camera.screenPoint(for: points[points.count / 2], viewSize: size)
            let label = context.resolve(
                Text("Ø\(Int(pipe.diameterMM)) mm · \(String(format: "%.1f m", pipe.totalLengthMeters))")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(pipe.lineType.color)
            )
            let labelSize = label.measure(in: size)
            let labelCenter = CGPoint(x: midpoint.x, y: midpoint.y - 12)
            let plate = CGRect(
                x: labelCenter.x - labelSize.width / 2 - 3,
                y: labelCenter.y - labelSize.height / 2 - 2,
                width: labelSize.width + 6,
                height: labelSize.height + 4
            )
            context.fill(
                RoundedRectangle(cornerRadius: 3, style: .continuous).path(in: plate),
                with: .color(Color(.systemBackground).opacity(0.85))
            )
            context.draw(label, at: labelCenter)
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

    private func controlCluster(geometry: GeometryProxy) -> some View {
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
            } else if engine.isMeasuring {
                Button {
                    engine.undoLastMeasurementPoint()
                } label: {
                    Image(systemName: "arrow.uturn.backward.circle.fill")
                }
                .accessibilityLabel("Annuler le dernier point")
                .disabled(engine.measurementPoints.isEmpty)

                Button {
                    engine.clearMeasurement()
                } label: {
                    Image(systemName: "checkmark.circle.fill")
                }
                .accessibilityLabel("Terminer la mesure")
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

                Button {
                    activeSheet = .whereToPlant
                } label: {
                    Image(systemName: "mappin.and.ellipse")
                }
                .accessibilityLabel("Où planter ?")

                Button {
                    activeSheet = .route
                } label: {
                    Image(systemName: "figure.walk.circle.fill")
                }
                .accessibilityLabel("Parcours d'inspection")

                Button {
                    engine.isMeasuring = true
                } label: {
                    Image(systemName: "ruler.fill")
                }
                .accessibilityLabel("Mesurer")

                if GardenARService.isSupported {
                    Button {
                        activeSheet = .augmentedReality
                    } label: {
                        Image(systemName: "arkit")
                    }
                    .accessibilityLabel("Voir en réalité augmentée")
                }

                Button {
                    activeSheet = .mapAI
                } label: {
                    Image(systemName: "sparkles")
                }
                .accessibilityLabel("Oasis AI")
            }

            // « Recentrer » cadre sur ce qui est dessiné — contour,
            // zones, tuyaux, objets — et non plus sur l'origine (0, 0)
            // du repère local. Recentrer sur un point où il n'y a rien
            // était le geste qui ne ramenait pas les tuyaux à l'écran.
            // Sans contenu du tout, `fitToContent` retombe de lui-même
            // sur la vue par défaut.
            Button {
                withAnimation(.snappy) { engine.fitToContent(viewSize: geometry.size) }
            } label: {
                Image(systemName: "scope")
            }
            .accessibilityLabel("Cadrer sur le jardin")
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
