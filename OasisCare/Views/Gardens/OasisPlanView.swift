import SwiftUI

/// Spec Phase 6A — OasisPlan's own vector rendering surface: a Canvas
/// driven by GardenMapEngine's camera, with pinch/pan/rotate gestures
/// and double-tap to reset. No garden objects yet — boundary comes in
/// 6B, objects in 6C — this phase's deliverable is the camera/
/// coordinate infrastructure everything else renders through, made
/// visibly real here via a reference grid, an origin marker, and a
/// scale bar rather than an inert placeholder.
///
/// Gesture composition (drag/magnify/rotate all recognizing at once via
/// nested `.simultaneously(with:)`) is the standard SwiftUI pattern for
/// this, but the actual feel — does pinch+rotate+pan truly work
/// smoothly together — can only be confirmed on a real device; this
/// environment has no simulator to check it in.
struct OasisPlanView: View {
    @ObservedObject var engine: GardenMapEngine

    @GestureState private var dragTranslation: CGSize = .zero
    @GestureState private var liveMagnification: CGFloat = 1.0
    @GestureState private var liveRotation: Angle = .zero

    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                draw(in: context, size: size)
            }
            .background(Color(.secondarySystemBackground))
            .contentShape(Rectangle())
            .gesture(combinedGesture())
            .onTapGesture(count: 2) {
                withAnimation(.snappy) { engine.resetCamera() }
            }
        }
        .clipped()
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

    private func draw(in context: GraphicsContext, size: CGSize) {
        let camera = liveCamera
        drawGrid(in: context, size: size, camera: camera)
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
}
