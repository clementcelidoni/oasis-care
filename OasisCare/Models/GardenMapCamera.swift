import Foundation
import CoreGraphics

/// Spec Phase 6A — pan/zoom/rotation state for OasisPlanView's canvas,
/// and the screen↔local half of the four transform functions the spec
/// asks for (local↔geographic lives in GardenCoordinateSystem).
/// `basePointsPerMeter` is the rendering density at scale 1.0; `scale`
/// is the live pinch-to-zoom multiplier on top of that.
struct GardenMapCamera: Equatable {
    var centerMeters: GardenCoordinate = .zero
    var scale: Double = 1.0
    var rotationRadians: Double = 0

    static let basePointsPerMeter: Double = 20
    static let minScale: Double = 0.1
    static let maxScale: Double = 12

    var pointsPerMeter: Double { Self.basePointsPerMeter * scale }

    /// Screen space: origin top-left, Y grows downward (SwiftUI/UIKit
    /// convention) — the sign flip on Y is what makes "north = up" on
    /// screen match "yMeters increases north" in local coordinates.
    func screenPoint(for local: GardenCoordinate, viewSize: CGSize) -> CGPoint {
        let dx = (local.xMeters - centerMeters.xMeters) * pointsPerMeter
        let dy = -(local.yMeters - centerMeters.yMeters) * pointsPerMeter
        let cosR = cos(rotationRadians)
        let sinR = sin(rotationRadians)
        return CGPoint(
            x: viewSize.width / 2 + dx * cosR - dy * sinR,
            y: viewSize.height / 2 + dx * sinR + dy * cosR
        )
    }

    func localPoint(for screen: CGPoint, viewSize: CGSize) -> GardenCoordinate {
        let dx = screen.x - viewSize.width / 2
        let dy = screen.y - viewSize.height / 2
        let cosR = cos(-rotationRadians)
        let sinR = sin(-rotationRadians)
        let unrotatedX = dx * cosR - dy * sinR
        let unrotatedY = dx * sinR + dy * cosR
        return GardenCoordinate(
            xMeters: centerMeters.xMeters + unrotatedX / pointsPerMeter,
            yMeters: centerMeters.yMeters - unrotatedY / pointsPerMeter
        )
    }

    /// A length in meters (not tied to one point) — for grid spacing,
    /// hit-test radii, etc.
    func points(forMeters meters: Double) -> Double {
        meters * pointsPerMeter
    }

    // ==============================================================
    // CONVENTION D'ANGLE DES OBJETS DU PLAN — AZIMUT
    //
    // C'est ICI, et nulle part ailleurs côté iOS, que la convention est
    // appliquée. Toute autre rotation d'objet doit passer par cette
    // fonction.
    // ==============================================================

    /// Convertit l'AZIMUT d'un objet en l'angle à passer à
    /// `.rotationEffect`.
    ///
    /// `azimuthRadians` — c'est-à-dire `GardenMapObject.rotationRadians`
    /// et la colonne `garden_map_objects.rotation_radians` — est un
    /// AZIMUT : le CAP BOUSSOLE du HAUT de l'objet (l'axe local +Y de
    /// son empreinte, qui est aussi le haut de son pictogramme).
    ///
    ///   • unité   : RADIANS ; les deux interfaces saisissent des DEGRÉS
    ///   • origine : 0 = NORD
    ///   • sens    : croissant dans le sens HORAIRE sur un plan nord en
    ///               haut — nord 0°, est 90°, sud 180°, ouest 270°
    ///
    /// Autrement dit : tourner l'objet VERS LA DROITE à l'écran fait
    /// MONTER le nombre. À 0° l'objet est droit, sa largeur d'ouest en
    /// est ; à 90° son haut pointe vers l'EST. C'est mot pour mot la
    /// convention de `web-pro/lib/twin/geometry.ts` (encadré
    /// « CONVENTION D'ANGLE ») — les deux applications lisent la même
    /// colonne et doivent dessiner la même chose.
    ///
    /// AUCUNE inversion de signe ici, et c'est délibéré :
    /// `.rotationEffect` travaille en ESPACE ÉCRAN, dont l'axe y
    /// descend, où un angle positif est donc DÉJÀ horaire. C'est
    /// `screenPoint` ci-dessus qui a retourné le y ; le refaire ici
    /// donnerait un objet tourné à l'envers du web.
    ///
    /// La rotation de la caméra s'AJOUTE, et elle le doit :
    /// `screenPoint` l'applique déjà à la POSITION de l'objet, et
    /// `drawPlanImage` à l'orientation du plan importé. Sans ce terme —
    /// c'était le cas jusqu'ici — pivoter la carte à deux doigts
    /// déplaçait les objets sans les tourner, et l'azimut affiché
    /// cessait d'être un cap.
    ///
    /// NE PAS confondre avec `GardenMapObject.sprinkler*AngleDegrees`,
    /// qui suivent une autre convention (degrés, 0 = est, antihoraire)
    /// et ne passent jamais par ici.
    func screenRotationRadians(forAzimuthRadians azimuthRadians: Double) -> Double {
        azimuthRadians + rotationRadians
    }
}
