import ARKit
import RealityKit
import simd
import SwiftUI

/// Spec Phase 6J — "Cette fonction doit être optionnelle." Both AR
/// modes share one camera view: Inspection overlays contextual info on
/// real plants/sensors from the plan (GardenARService.sightings, a
/// flat compass-filtered HUD — see that file's doc comment for why this
/// isn't 3D-anchored), Plantation previews a plant category at a fixed
/// distance in front of wherever the camera currently points, using
/// RealityKit's standard camera-relative world anchoring (no GPS/
/// compass math involved, unlike Inspection mode — see
/// ARViewContainer.Coordinator.place).
///
/// "Équipements cachés" (buried pipes/valves/cables) is spec's own
/// "à terme" (eventually) wording, not asked for now — not built here.
struct GardenARSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.dismiss) private var dismiss
    @StateObject private var arService = GardenARService()

    private enum Mode: String, CaseIterable, Identifiable {
        case inspect, planting, scan
        var id: String { rawValue }
        var label: String {
            switch self {
            case .inspect: return "Inspection"
            case .planting: return "Plantation"
            case .scan: return "Scan"
            }
        }
    }

    @State private var mode: Mode = .inspect
    @State private var plantingCategory: ARPlantingCategory = .arbre
    @State private var showingAdultSize = false
    @State private var placementRequestID = 0
    @State private var scanPoints: [GardenCoordinate] = []

    var body: some View {
        NavigationStack {
            Group {
                if !GardenARService.isSupported {
                    ContentUnavailableView(
                        "Réalité augmentée indisponible",
                        systemImage: "arkit",
                        description: Text("Cet appareil ne prend pas en charge la réalité augmentée.")
                    )
                } else {
                    arContent
                }
            }
            .navigationTitle("Réalité augmentée")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
        .onAppear { if GardenARService.isSupported { arService.start() } }
        .onDisappear { arService.stop() }
    }

    private var arContent: some View {
        ZStack(alignment: .top) {
            ARViewContainer(
                category: plantingCategory,
                showingAdultSize: showingAdultSize,
                placementRequestID: placementRequestID,
                onScanTap: { point in
                    if mode == .scan { scanPoints.append(point) }
                }
            )
            .ignoresSafeArea()

            VStack(spacing: 12) {
                Picker("Mode", selection: $mode) {
                    ForEach(Mode.allCases) { m in Text(m.label).tag(m) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.top, 8)

                Label("Position approximative — vérifiez toujours visuellement", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.thinMaterial, in: Capsule())

                Spacer()

                if mode == .inspect {
                    inspectHUD
                } else if mode == .planting {
                    plantingControls
                } else {
                    scanControls
                }
            }
        }
    }

    /// Spec Phase 6K — "Scan assisté... utiliser les capacités AR/depth
    /// disponibles seulement si l'appareil les supporte... aider à
    /// dessiner." Taps raycast against ARKit's own estimated planes
    /// (feature-point/IMU-based plane estimation, on every ARKit
    /// device — not LiDAR-only mesh scanning) rather than anything
    /// GPS-anchored: unlike Mode Inspection, these points only need to
    /// be consistent with EACH OTHER inside one AR session, not
    /// converted to a real geographic position, so none of Mode
    /// Inspection's GPS/ARKit-axis-conversion risk applies here. Numbers
    /// are read-only and advisory — spec's own "NE PAS présenter comme
    /// mesure topographique certifiée" / "toujours permettre correction
    /// manuelle" is satisfied by never auto-injecting these points
    /// anywhere: recreating them with the plan's existing, fully
    /// reliable manual tools is the only path to a real zone/boundary.
    private var scanControls: some View {
        VStack(spacing: 10) {
            Text("Touchez une surface détectée pour placer un point (mur, bordure, obstacle).")
                .font(.footnote)
                .multilineTextAlignment(.center)

            if scanPoints.count >= 2 {
                Text("Distance : \(String(format: "%.2f m", GardenMeasurementTool.pathLengthMeters(scanPoints, closed: false)))")
                    .font(.subheadline)
                if scanPoints.count >= 3 {
                    Text("Périmètre (fermé) : \(String(format: "%.2f m", GardenMeasurementTool.pathLengthMeters(scanPoints, closed: true))) · Surface : \(String(format: "%.2f m²", GardenMeasurementTool.areaSquareMeters(scanPoints)))")
                        .font(.subheadline)
                }
            }

            Text("Estimation expérimentale — pas une mesure topographique certifiée. Reproduisez ces valeurs manuellement sur le plan.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            HStack {
                Button("Annuler le dernier point") {
                    if !scanPoints.isEmpty { scanPoints.removeLast() }
                }
                .disabled(scanPoints.isEmpty)

                Spacer()

                Button("Effacer") { scanPoints.removeAll() }
                    .disabled(scanPoints.isEmpty)
            }
            .font(.subheadline)
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal)
        .padding(.bottom, 24)
    }

    @ViewBuilder
    private var inspectHUD: some View {
        if arService.authorizationDenied {
            hudBubble("Autorisez la localisation dans Réglages iPhone pour afficher les végétaux et capteurs à proximité.")
        } else if engine.garden.latitude == nil {
            hudBubble("Renseignez la position du jardin (Modifier le jardin) pour activer l'inspection AR.")
        } else if let userLocation = arService.userLocation, let headingDegrees = arService.headingDegrees {
            let sightings = GardenARService.sightings(of: engine.arTargets(), from: userLocation, headingDegrees: headingDegrees)
            if sightings.isEmpty {
                hudBubble("Pointez l'iPhone vers un végétal ou un capteur du plan.")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(sightings.prefix(3)) { sighting in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Image(systemName: sighting.target.systemImage)
                                Text(sighting.target.label).fontWeight(.semibold)
                                Spacer()
                                Text(String(format: "≈ %.0f m", sighting.distanceMeters))
                                    .foregroundStyle(.secondary)
                            }
                            ForEach(sighting.target.infoLines, id: \.self) { line in
                                Text(line).font(.caption)
                            }
                        }
                        .padding(10)
                        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
        } else {
            hudBubble("Recherche de la position et de l'orientation…")
        }
    }

    private func hudBubble(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(10)
            .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 32)
            .padding(.bottom, 24)
    }

    private var plantingControls: some View {
        VStack(spacing: 10) {
            Picker("Végétal", selection: $plantingCategory) {
                ForEach(ARPlantingCategory.allCases) { category in
                    Text(category.label).tag(category)
                }
            }
            .pickerStyle(.segmented)

            Toggle("Voir à maturité", isOn: $showingAdultSize)

            Text("Représentation approximative, à titre indicatif.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Button("Placer ici") { placementRequestID += 1 }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal)
        .padding(.bottom, 24)
    }
}

/// Spec Phase 6J's own picker list for "Mode Plantation AR" — exactly
/// Monstera/Palmier/Arbre, matching the mockup. Heights are
/// illustrative "représentation approximative" figures (spec's own
/// words), not measured data — deliberately separate from
/// GardenObjectType's own size defaults, which describe map-plan
/// footprints for a different purpose.
enum ARPlantingCategory: String, CaseIterable, Identifiable {
    case monstera, palmier, arbre

    var id: String { rawValue }

    var label: String {
        switch self {
        case .monstera: return "Monstera"
        case .palmier: return "Palmier"
        case .arbre: return "Arbre"
        }
    }

    var currentHeightMeters: Double {
        switch self {
        case .monstera: return 0.5
        case .palmier: return 1.2
        case .arbre: return 1.5
        }
    }

    var adultHeightMeters: Double {
        switch self {
        case .monstera: return 2.5
        case .palmier: return 6
        case .arbre: return 8
        }
    }

    var tint: UIColor {
        switch self {
        case .monstera: return .systemGreen
        case .palmier: return .systemYellow
        case .arbre: return .systemGreen
        }
    }
}

/// Wraps a plain RealityKit ARView (not the SwiftUI RealityView, to
/// keep this on the same well-established UIViewRepresentable pattern
/// used for other UIKit wrappers in this codebase, e.g. QRScannerView).
private struct ARViewContainer: UIViewRepresentable {
    var category: ARPlantingCategory
    var showingAdultSize: Bool
    var placementRequestID: Int
    var onScanTap: (GardenCoordinate) -> Void

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(frame: .zero)
        arView.session.run(ARWorldTrackingConfiguration())
        context.coordinator.arView = arView
        context.coordinator.onScanTap = onScanTap

        let tapRecognizer = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
        arView.addGestureRecognizer(tapRecognizer)

        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        context.coordinator.onScanTap = onScanTap
        guard context.coordinator.lastPlacedRequestID != placementRequestID else { return }
        context.coordinator.lastPlacedRequestID = placementRequestID
        context.coordinator.place(category: category, adultSize: showingAdultSize)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    static func dismantleUIView(_ uiView: ARView, coordinator: Coordinator) {
        uiView.session.pause()
    }

    /// NSObject-based (not a plain Swift class) specifically so
    /// #selector(handleTap(_:)) below can target it — UIKit's
    /// target/action gesture-recognizer mechanism is an Objective-C
    /// runtime feature and requires an NSObject subclass.
    final class Coordinator: NSObject {
        weak var arView: ARView?
        var lastPlacedRequestID = 0
        var onScanTap: ((GardenCoordinate) -> Void)?
        private var currentAnchor: AnchorEntity?

        /// Spec Phase 6K's "Scan assisté" tap handler: raycasts against
        /// ARKit's continuously-estimated planes (not a LiDAR-only
        /// mesh — works on any ARKit-capable device) and reports the
        /// hit's ground-plane (x, z) position — dropping height, since
        /// only horizontal distance matters for "walls/bordures/
        /// surfaces." Silently does nothing if the tap didn't land on
        /// any detected surface; the user just taps again.
        @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
            guard let arView, let onScanTap else { return }
            let screenPoint = recognizer.location(in: arView)
            let results = arView.raycast(from: screenPoint, allowing: .estimatedPlane, alignment: .any)
            guard let hit = results.first else { return }
            let worldPosition = hit.worldTransform.columns.3
            onScanTap(GardenCoordinate(xMeters: Double(worldPosition.x), yMeters: Double(worldPosition.z)))
        }

        /// Places a simple procedural trunk+foliage stand-in
        /// `max(height * 1.3, 1.5)` meters directly in front of the
        /// camera's current facing direction, then leaves it anchored
        /// in world space (RealityKit's own tracking keeps it visually
        /// stable from there) — the standard "place object in front of
        /// camera" technique: translate along the camera's local -Z
        /// (forward), then express that offset in world space by
        /// combining it with the camera's own transform.
        func place(category: ARPlantingCategory, adultSize: Bool) {
            guard let arView else { return }
            if let currentAnchor {
                arView.scene.removeAnchor(currentAnchor)
            }

            let heightMeters = adultSize ? category.adultHeightMeters : category.currentHeightMeters

            var offset = matrix_identity_float4x4
            offset.columns.3.z = -Float(max(heightMeters * 1.3, 1.5))
            let worldTransform = simd_mul(arView.cameraTransform.matrix, offset)

            let anchor = AnchorEntity(world: worldTransform)
            for part in Coordinator.makePlantParts(heightMeters: heightMeters, tint: category.tint) {
                anchor.addChild(part)
            }
            arView.scene.addAnchor(anchor)
            currentAnchor = anchor
        }

        /// Both parts are generateSphere — confirmed to compile at this
        /// project's iOS 17 deployment target by an earlier CI run (the
        /// cylinder-based trunk this replaced needed iOS 18 and failed
        /// the build). The trunk is a sphere stretched tall and thin via
        /// a non-uniform scale rather than a true cylinder mesh — still
        /// a clearly-approximate stand-in, and it sidesteps the
        /// generateCylinder availability question entirely instead of
        /// guessing at a second unverified API.
        private static func makePlantParts(heightMeters: Double, tint: UIColor) -> [ModelEntity] {
            let trunkHeight = Float(heightMeters) * 0.6
            let trunkRadius = max(Float(heightMeters) * 0.03, 0.02)
            let foliageRadius = max(Float(heightMeters) * 0.35, 0.05)

            let trunk = ModelEntity(
                mesh: MeshResource.generateSphere(radius: trunkRadius),
                materials: [SimpleMaterial(color: .brown, isMetallic: false)]
            )
            trunk.scale = SIMD3<Float>(1, trunkHeight / max(trunkRadius, 0.001), 1)
            trunk.position.y = trunkHeight / 2

            let foliage = ModelEntity(
                mesh: MeshResource.generateSphere(radius: foliageRadius),
                materials: [SimpleMaterial(color: tint, isMetallic: false)]
            )
            foliage.position.y = trunkHeight + foliageRadius * 0.6

            return [trunk, foliage]
        }
    }
}
