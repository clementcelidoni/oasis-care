import CoreGraphics
import Foundation
import XCTest
@testable import OasisCare

/// L'AZIMUT DES OBJETS DU PLAN, verrouillé par des nombres.
///
/// Contexte : un objet posé à +30° sur l'éditeur web s'affichait à −30°
/// sur l'iPhone. Les deux plateformes lisaient pourtant la même valeur
/// dans `garden_map_objects.rotation_radians` — c'est le SENS de la
/// rotation qui différait, et le défaut passait inaperçu parce que la
/// plupart des objets sont ronds.
///
/// La convention retenue est l'AZIMUT : le cap boussole du HAUT de
/// l'objet (son axe local +Y), en RADIANS, origine 0 = NORD, croissant
/// dans le SENS HORAIRE sur un plan nord en haut — nord 0°, est 90°,
/// sud 180°, ouest 270°.
///
/// Ces tests sont le pendant Swift de ceux de
/// `web-pro/lib/twin/geometry.test.ts`. Avant eux, `grep` sur
/// OasisCareTests ne trouvait ni « rotat », ni `GardenMapObject`, ni
/// `GardenMapCamera` : rien n'aurait pu détecter la divergence, et rien
/// ne l'aurait détectée à la prochaine occasion.
final class GardenAzimuthTests: XCTestCase {

    // MARK: - Outils

    /// Ce que fait `.rotationEffect` : une rotation dans l'ESPACE ÉCRAN
    /// (x vers la droite, y vers le BAS), où un angle positif tourne
    /// donc dans le sens HORAIRE.
    private func rotatedOnScreen(x: Double, y: Double, byRadians angle: Double) -> (x: Double, y: Double) {
        (x: x * cos(angle) - y * sin(angle), y: x * sin(angle) + y * cos(angle))
    }

    /// La direction, à l'écran, du HAUT d'un objet d'azimut donné.
    ///
    /// C'est exactement ce que compose `GardenObjectMarkerView` : le
    /// haut du dessin non tourné est (0, −1) en espace écran puisque
    /// l'axe y y descend, et `.rotationEffect` lui applique l'angle que
    /// rend la caméra — la vraie fonction, pas une copie.
    private func screenDirectionOfObjectTop(
        azimuthRadians: Double, camera: GardenMapCamera
    ) -> (x: Double, y: Double) {
        rotatedOnScreen(
            x: 0, y: -1,
            byRadians: camera.screenRotationRadians(forAzimuthRadians: azimuthRadians)
        )
    }

    /// La direction, à l'écran, d'un déplacement dans le MONDE — via
    /// `camera.screenPoint`, là encore la vraie fonction. C'est ce qui
    /// permet de comparer une orientation d'objet à un point cardinal
    /// sans réécrire la projection.
    private func screenDirectionOfWorldStep(
        xMeters: Double, yMeters: Double, camera: GardenMapCamera
    ) -> (x: Double, y: Double) {
        let size = CGSize(width: 1000, height: 1000)
        let origin = camera.screenPoint(for: .zero, viewSize: size)
        let moved = camera.screenPoint(
            for: GardenCoordinate(xMeters: xMeters, yMeters: yMeters), viewSize: size
        )
        let dx = Double(moved.x - origin.x)
        let dy = Double(moved.y - origin.y)
        let length = (dx * dx + dy * dy).squareRoot()
        return (x: dx / length, y: dy / length)
    }

    /// Les quatre points cardinaux, en azimut et en vecteur monde.
    private static let cardinaux: [(degres: Double, xMonde: Double, yMonde: Double, nom: String)] = [
        (0, 0, 1, "nord"),
        (90, 1, 0, "est"),
        (180, 0, -1, "sud"),
        (270, -1, 0, "ouest"),
    ]

    // MARK: - Le sens de la rotation

    /// La règle qui compte pour l'utilisateur : nord 0, est 90, sud 180,
    /// ouest 270. Le cas « est » est le pendant exact du test web
    /// « l'axe +Y d'un objet à azimut 90° pointe vers l'est ».
    func testObjectTopFollowsTheCompass() {
        let camera = GardenMapCamera()
        for cas in Self.cardinaux {
            let haut = screenDirectionOfObjectTop(
                azimuthRadians: cas.degres * .pi / 180, camera: camera
            )
            let attendu = screenDirectionOfWorldStep(
                xMeters: cas.xMonde, yMeters: cas.yMonde, camera: camera
            )
            XCTAssertEqual(haut.x, attendu.x, accuracy: 1e-9, "azimut \(cas.degres)° = \(cas.nom) (x)")
            XCTAssertEqual(haut.y, attendu.y, accuracy: 1e-9, "azimut \(cas.degres)° = \(cas.nom) (y)")
        }
    }

    /// Tourner l'objet VERS LA DROITE à l'écran doit faire MONTER le
    /// nombre. Avec le signe inverse — celui que portait le web — le
    /// haut de l'objet partirait vers la gauche.
    func testTurningRightMakesTheNumberGoUp() {
        let camera = GardenMapCamera()
        let droit = screenDirectionOfObjectTop(azimuthRadians: 0, camera: camera)
        let incline = screenDirectionOfObjectTop(azimuthRadians: 30 * .pi / 180, camera: camera)
        XCTAssertEqual(droit.x, 0, accuracy: 1e-9, "à 0° le haut pointe droit vers le haut")
        XCTAssertGreaterThan(incline.x, 0, "à 30° le haut doit avoir basculé vers la DROITE")
        XCTAssertLessThan(incline.y, 0, "à 30° le haut regarde encore vers le haut de l'écran")
    }

    /// LE TERME CAMÉRA. Quand l'utilisateur pivote la carte à deux
    /// doigts, l'azimut d'un objet doit rester un CAP : son haut
    /// continue de pointer au même endroit du monde. Sans
    /// `camera.rotationRadians` dans `screenRotationRadians` — c'était
    /// l'état du code — les objets se déplaçaient sans tourner et ce
    /// test tombe pour toute rotation de carte non nulle.
    func testAzimuthStaysACompassBearingWhenTheMapIsRotated() {
        for rotationCarte in [0.0, 0.4, 1.9, -1.1, Double.pi] {
            var camera = GardenMapCamera()
            camera.rotationRadians = rotationCarte
            for cas in Self.cardinaux {
                let haut = screenDirectionOfObjectTop(
                    azimuthRadians: cas.degres * .pi / 180, camera: camera
                )
                let attendu = screenDirectionOfWorldStep(
                    xMeters: cas.xMonde, yMeters: cas.yMonde, camera: camera
                )
                XCTAssertEqual(
                    haut.x, attendu.x, accuracy: 1e-9,
                    "carte pivotée de \(rotationCarte) rad, azimut \(cas.degres)° (x)"
                )
                XCTAssertEqual(
                    haut.y, attendu.y, accuracy: 1e-9,
                    "carte pivotée de \(rotationCarte) rad, azimut \(cas.degres)° (y)"
                )
            }
        }
    }

    /// Le zoom ne doit pas peser sur l'orientation : seule la rotation
    /// de la caméra s'y ajoute.
    func testZoomDoesNotChangeTheBearing() {
        var camera = GardenMapCamera()
        camera.scale = 7
        let haut = screenDirectionOfObjectTop(azimuthRadians: .pi / 2, camera: camera)
        let est = screenDirectionOfWorldStep(xMeters: 1, yMeters: 0, camera: camera)
        XCTAssertEqual(haut.x, est.x, accuracy: 1e-9)
        XCTAssertEqual(haut.y, est.y, accuracy: 1e-9)
    }

    // MARK: - Normalisation

    /// Rien d'autre ne borne cet angle : ni la colonne SQL, ni le web.
    /// Sans normalisation, « nord 0, est 90, sud 180, ouest 270 » cesse
    /// d'être vrai dès qu'on compare deux valeurs.
    func testAzimuthIsNormalizedIntoZeroToTwoPi() {
        let tour = 2 * Double.pi
        let degre = Double.pi / 180
        XCTAssertEqual(GardenMapEngine.normalizedAzimuth(0), 0, accuracy: 1e-12)
        XCTAssertEqual(GardenMapEngine.normalizedAzimuth(370 * degre), 10 * degre, accuracy: 1e-12)
        XCTAssertEqual(GardenMapEngine.normalizedAzimuth(-30 * degre), 330 * degre, accuracy: 1e-12)
        XCTAssertEqual(GardenMapEngine.normalizedAzimuth(tour), 0, accuracy: 1e-12)
        XCTAssertEqual(GardenMapEngine.normalizedAzimuth(-tour), 0, accuracy: 1e-12)
        XCTAssertEqual(GardenMapEngine.normalizedAzimuth(3 * tour + 1), 1, accuracy: 1e-9)
        // Une valeur non finie ne doit pas se propager en base.
        XCTAssertEqual(GardenMapEngine.normalizedAzimuth(.nan), 0)
        XCTAssertEqual(GardenMapEngine.normalizedAzimuth(.infinity), 0)
    }

    /// Le résultat reste toujours DANS l'intervalle, bornes comprises
    /// pour zéro et exclue pour un tour complet.
    func testNormalizationAlwaysLandsInsideTheInterval() {
        let tour = 2 * Double.pi
        for brut in stride(from: -25.0, through: 25.0, by: 0.37) {
            let valeur = GardenMapEngine.normalizedAzimuth(brut)
            XCTAssertGreaterThanOrEqual(valeur, 0, "\(brut) rad")
            XCTAssertLessThan(valeur, tour, "\(brut) rad")
        }
    }

    // MARK: - La liste des types ronds

    /// `isRoundOnPlan` doit rester le miroir exact de `ROUND_OBJECTS`
    /// côté web (web-pro/lib/twin/types.ts) : 18 types sur 30. Si le
    /// catalogue évolue d'un côté seulement, ce test le dit.
    func testRoundTypesMirrorTheWebList() {
        let ronds = GardenObjectType.allCases.filter(\.isRoundOnPlan)
        XCTAssertEqual(GardenObjectType.allCases.count, 30, "le catalogue de types a changé")
        XCTAssertEqual(ronds.count, 18, "la liste des types ronds a divergé de celle du web")
        // Ceux dont l'empreinte rectangulaire porte tout le sens de
        // l'azimut : ils ne doivent surtout pas retomber en pastille.
        for type in [GardenObjectType.wall, .fence, .terrace, .path, .stairs, .house, .pool, .pond, .greenhouse] {
            XCTAssertFalse(type.isRoundOnPlan, "\(type.rawValue) doit montrer son empreinte")
        }
        for type in [GardenObjectType.plant, .tree, .rock, .sprinkler, .sensor, .light] {
            XCTAssertTrue(type.isRoundOnPlan, "\(type.rawValue) est rond des deux côtés")
        }
    }

    /// La végétation est ronde des deux côtés — c'est ce qui rend
    /// l'azimut invisible sur un arbre, et pourquoi le défaut a survécu.
    func testEveryVegetationTypeIsRound() {
        for type in GardenObjectType.allCases where type.isVegetation {
            XCTAssertTrue(type.isRoundOnPlan, "\(type.rawValue)")
        }
    }
}
