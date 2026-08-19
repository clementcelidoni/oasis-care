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
        case inspect, planting
        var id: String { rawValue }
        var label: String {
            switch self {
            case .inspect: return "Inspection"
            case .planting: return "Plantation"
            }
        }
    }

    @State private var mode: Mode = .inspect
    @State private var plantingCategory: ARPlantingCategory = .arbre
    @State private var showingAdultSize = false
    @State private var placementRequestID = 0

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
            ARViewContainer(category: plantingCategory, showingAdultSize: showingAdultSize, placementRequestID: placementRequestID)
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
                } else {
                    plantingControls
                }
            }
        }
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

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(frame: .zero)
        arView.session.run(ARWorldTrackingConfiguration())
        context.coordinator.arView = arView
        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        guard context.coordinator.lastPlacedRequestID != placementRequestID else { return }
        context.coordinator.lastPlacedRequestID = placementRequestID
        context.coordinator.place(category: category, adultSize: showingAdultSize)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    static func dismantleUIView(_ uiView: ARView, coordinator: Coordinator) {
        uiView.session.pause()
    }

    final class Coordinator {
        weak var arView: ARView?
        var lastPlacedRequestID = 0
        private var currentAnchor: AnchorEntity?

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
