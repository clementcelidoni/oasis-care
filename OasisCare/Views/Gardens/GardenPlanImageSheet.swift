import PhotosUI
import SwiftUI

/// Spec Phase 6K — "Importer un plan... Calibration." Handles only
/// import and the 2-point calibration, both of which need a focused,
/// full-screen view of just the image. "Alignement" (rotation/
/// déplacement/opacité) deliberately happens back on the real canvas
/// instead, in OasisPlanView's top banner while
/// engine.isAligningPlanImage — nudging a position only makes sense
/// with the actual garden plan visible behind it, which a covering
/// sheet can't show. "Traçage" needs no dedicated UI at all: once the
/// image is calibrated and positioned, the plan's existing boundary/
/// area/pipe tools already trace over anything drawn underneath them.
struct GardenPlanImageSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var photosPickerItem: PhotosPickerItem?
    @State private var isImporting = false
    @State private var importError: String?

    @State private var calibrationPointA: CGPoint?
    @State private var calibrationPointB: CGPoint?
    @State private var calibrationDistanceText = "10"
    @State private var isPickingReplacement = false

    private var planImage: GardenPlanImage? { engine.garden.planImage }
    private var uiImage: UIImage? { planImage.flatMap { UIImage(data: $0.imageData) } }

    var body: some View {
        NavigationStack {
            Group {
                if let uiImage, !isPickingReplacement {
                    calibrationContent(uiImage)
                } else {
                    importContent
                }
            }
            .navigationTitle(planImage == nil || isPickingReplacement ? "Importer un plan" : "Calibration")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                if planImage != nil, !isPickingReplacement {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Remplacer") { isPickingReplacement = true }
                    }
                }
            }
        }
    }

    private var importContent: some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Importer un plan")
                .font(.title3.weight(.semibold))
            Text("Image du plan, capture d'un plan de masse ou photo aérienne. Vous calibrerez son échelle à l'étape suivante.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            if let importError {
                Text(importError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            PhotosPicker(selection: $photosPickerItem, matching: .images) {
                if isImporting {
                    ProgressView()
                } else {
                    Text("Choisir une image")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isImporting)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: photosPickerItem) { _, newValue in
            guard let newValue else { return }
            Task { await importSelectedPhoto(newValue) }
        }
    }

    private func importSelectedPhoto(_ item: PhotosPickerItem) async {
        isImporting = true
        importError = nil
        defer { isImporting = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), UIImage(data: data) != nil else {
                importError = "Image illisible — essayez-en une autre."
                return
            }
            engine.importPlanImage(data: data, context: modelContext)
            calibrationPointA = nil
            calibrationPointB = nil
            isPickingReplacement = false
            photosPickerItem = nil
        } catch {
            importError = "Import impossible : \(error.localizedDescription)"
        }
    }

    private func calibrationContent(_ uiImage: UIImage) -> some View {
        VStack(spacing: 12) {
            Text("Touchez deux points repères sur le plan (ex. les deux extrémités d'un mur connu), puis indiquez la distance réelle entre eux.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            GeometryReader { geometry in
                let layout = Self.aspectFitLayout(imageSize: uiImage.size, in: geometry.size)
                ZStack {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .frame(width: geometry.size.width, height: geometry.size.height)

                    if let calibrationPointA {
                        calibrationMarker("A", at: Self.displayPoint(calibrationPointA, layout: layout))
                    }
                    if let calibrationPointB {
                        calibrationMarker("B", at: Self.displayPoint(calibrationPointB, layout: layout))
                    }
                }
                .contentShape(Rectangle())
                .gesture(
                    SpatialTapGesture().onEnded { value in
                        guard let pixelPoint = Self.pixelPoint(fromDisplay: value.location, layout: layout) else { return }
                        if calibrationPointA == nil || calibrationPointB != nil {
                            calibrationPointA = pixelPoint
                            calibrationPointB = nil
                        } else {
                            calibrationPointB = pixelPoint
                        }
                    }
                )
            }
            .frame(maxHeight: .infinity)

            if calibrationPointA != nil, calibrationPointB != nil {
                VStack(spacing: 10) {
                    HStack {
                        Text("Distance réelle entre A et B")
                        Spacer()
                        TextField("mètres", text: $calibrationDistanceText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 70)
                        Text("m").foregroundStyle(.secondary)
                    }
                    Button("Valider la calibration") {
                        validateCalibration()
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity)
                    .disabled(Double(calibrationDistanceText.replacingOccurrences(of: ",", with: ".")) == nil)
                }
                .padding()
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.horizontal)
            }
        }
        .padding(.vertical)
    }

    private func calibrationMarker(_ label: String, at point: CGPoint) -> some View {
        Text(label)
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .frame(width: 24, height: 24)
            .background(.blue, in: Circle())
            .overlay(Circle().stroke(.white, lineWidth: 2))
            .position(point)
    }

    private func validateCalibration() {
        guard let calibrationPointA, let calibrationPointB,
              let distance = Double(calibrationDistanceText.replacingOccurrences(of: ",", with: ".")), distance > 0 else { return }
        engine.setPlanImageCalibration(pointA: calibrationPointA, pointB: calibrationPointB, realDistanceMeters: distance)
        engine.isAligningPlanImage = true
        dismiss()
    }

    private struct AspectFitLayout {
        var origin: CGPoint
        var renderedSize: CGSize
        var imageSize: CGSize
    }

    private static func aspectFitLayout(imageSize: CGSize, in frameSize: CGSize) -> AspectFitLayout {
        guard imageSize.width > 0, imageSize.height > 0, frameSize.width > 0, frameSize.height > 0 else {
            return AspectFitLayout(origin: .zero, renderedSize: frameSize, imageSize: imageSize)
        }
        let imageAspect = imageSize.width / imageSize.height
        let frameAspect = frameSize.width / frameSize.height
        let renderedSize: CGSize
        if imageAspect > frameAspect {
            renderedSize = CGSize(width: frameSize.width, height: frameSize.width / imageAspect)
        } else {
            renderedSize = CGSize(width: frameSize.height * imageAspect, height: frameSize.height)
        }
        let origin = CGPoint(x: (frameSize.width - renderedSize.width) / 2, y: (frameSize.height - renderedSize.height) / 2)
        return AspectFitLayout(origin: origin, renderedSize: renderedSize, imageSize: imageSize)
    }

    /// Display-space tap → source-image pixel space, nil when the tap
    /// landed in the aspect-fit letterbox padding rather than the
    /// image itself.
    private static func pixelPoint(fromDisplay location: CGPoint, layout: AspectFitLayout) -> CGPoint? {
        guard layout.renderedSize.width > 0, layout.renderedSize.height > 0 else { return nil }
        let relativeX = (location.x - layout.origin.x) / layout.renderedSize.width
        let relativeY = (location.y - layout.origin.y) / layout.renderedSize.height
        guard (0...1).contains(relativeX), (0...1).contains(relativeY) else { return nil }
        return CGPoint(x: relativeX * layout.imageSize.width, y: relativeY * layout.imageSize.height)
    }

    private static func displayPoint(_ pixelPoint: CGPoint, layout: AspectFitLayout) -> CGPoint {
        guard layout.imageSize.width > 0, layout.imageSize.height > 0 else { return .zero }
        return CGPoint(
            x: layout.origin.x + (pixelPoint.x / layout.imageSize.width) * layout.renderedSize.width,
            y: layout.origin.y + (pixelPoint.y / layout.imageSize.height) * layout.renderedSize.height
        )
    }
}
