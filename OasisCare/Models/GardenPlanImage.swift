import Foundation
import SwiftData

/// Spec Phase 6K — "Importer un plan... Calibration... Alignement...
/// Traçage." Deliberately NOT Syncable/synced to Supabase: this is a
/// drawing aid the user re-imports and re-aligns at will, not a record
/// of real garden state — the same reasoning WeatherCache (Phase 4B)
/// used to stay device-local rather than a second, heavier image-sync
/// pipeline (Storage upload/download) for something disposable. What
/// the user traces ON TOP of it, with the app's existing boundary/area/
/// pipe tools, is the real, synced data.
///
/// Calibration points are stored in image-pixel space (origin top-left,
/// matching UIImage/CGImage convention) — only their relative distance
/// matters, converted to a real meters-per-pixel scale via
/// `calibrationRealDistanceMeters`. Position/rotation/opacity are
/// separate, freely adjustable "Alignement" state, not derived from
/// the calibration points — matching spec's own split between the two
/// sections.
@Model
final class GardenPlanImage {
    var id: UUID
    var imageData: Data
    var calibrationPointAX: Double
    var calibrationPointAY: Double
    var calibrationPointBX: Double
    var calibrationPointBY: Double
    var calibrationRealDistanceMeters: Double
    var positionXMeters: Double
    var positionYMeters: Double
    var rotationRadians: Double
    var opacity: Double
    var isVisible: Bool
    var createdAt: Date

    var garden: Garden?

    init(garden: Garden?, imageData: Data) {
        self.id = UUID()
        self.garden = garden
        self.imageData = imageData
        self.calibrationPointAX = 0
        self.calibrationPointAY = 0
        self.calibrationPointBX = 0
        self.calibrationPointBY = 0
        self.calibrationRealDistanceMeters = 10
        self.positionXMeters = 0
        self.positionYMeters = 0
        self.rotationRadians = 0
        self.opacity = 0.6
        self.isVisible = true
        self.createdAt = .now
    }

    var position: GardenCoordinate {
        get { GardenCoordinate(xMeters: positionXMeters, yMeters: positionYMeters) }
        set {
            positionXMeters = newValue.xMeters
            positionYMeters = newValue.yMeters
        }
    }

    /// nil until both calibration points have actually been placed
    /// (still coincident at their zero default) — never divide by a
    /// meaningless zero pixel distance.
    var metersPerPixel: Double? {
        let pixelDistance = hypot(calibrationPointBX - calibrationPointAX, calibrationPointBY - calibrationPointAY)
        guard pixelDistance > 1 else { return nil }
        return calibrationRealDistanceMeters / pixelDistance
    }

    var isCalibrated: Bool { metersPerPixel != nil }
}
