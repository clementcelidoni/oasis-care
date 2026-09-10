import XCTest
@testable import OasisCare

/// À QUI APPARTIENT LA COPIE LOCALE — LES TROIS RÉPONSES POSSIBLES.
///
/// ══════════════════════════════════════════════════════════════════
/// LE DÉFAUT QUE CES TESTS VERROUILLENT
/// ══════════════════════════════════════════════════════════════════
///
/// Un dirigeant s'est connecté sur son téléphone avec un second compte
/// et y a retrouvé les végétaux du premier. La base n'y était pour
/// rien : interrogée sous le second compte, elle rendait zéro végétal.
/// Ce qu'il voyait était la copie locale, que rien n'effaçait — ni le
/// changement de compte, qui n'oubliait qu'une liste en mémoire, ni la
/// déconnexion, qui ne connaissait que sept modèles sur cinquante-sept.
///
/// ══════════════════════════════════════════════════════════════════
/// ET LE DÉFAUT QU'UNE CORRECTION NAÏVE AURAIT INTRODUIT
/// ══════════════════════════════════════════════════════════════════
///
/// « Le compte a changé, donc on efface » est faux au démarrage : le
/// flux d'authentification émet un événement à chaque lancement, et un
/// « avant » vide comparé à un « après » plein ressemble exactement à un
/// changement de compte. Une comparaison naïve viderait l'appareil à
/// chaque ouverture — un défaut bien pire que celui d'origine, et
/// silencieux lui aussi.
///
/// D'où le test le plus important de ce fichier : ABSENCE DE
/// PROPRIÉTAIRE VEUT DIRE « ON NE SAIT PAS », JAMAIS « QUELQU'UN
/// D'AUTRE ». On adopte, on n'efface pas.
final class IdentiteLocaleTests: XCTestCase {

    override func setUp() {
        super.setUp()
        IdentiteLocale.oublier()
    }

    override func tearDown() {
        IdentiteLocale.oublier()
        super.tearDown()
    }

    /// LE TEST QUI PROTÈGE CONTRE LA CORRECTION NAÏVE.
    func testAucunProprietaireInscritDonneAdoptionEtPasEffacement() {
        let compte = UUID()

        XCTAssertEqual(IdentiteLocale.comparer(a: compte), .adoption,
                       "Sans propriétaire connu, l'appareil doit adopter le compte — pas effacer le travail de quelqu'un sur un simple « on ne sait pas ».")
    }

    func testLeMemeCompteNeDeclencheRien() {
        let compte = UUID()
        IdentiteLocale.inscrire(compte)

        XCTAssertEqual(IdentiteLocale.comparer(a: compte), .memeCompte)
    }

    /// LE CAS CONSTATÉ : deux comptes, un seul téléphone.
    func testUnAutreCompteEstUnChangement() {
        let premier = UUID()
        let second = UUID()
        IdentiteLocale.inscrire(premier)

        XCTAssertEqual(IdentiteLocale.comparer(a: second), .changementDeCompte,
                       "C'est exactement le scénario constaté : se connecter sous un second compte doit être reconnu comme un changement, même sans déconnexion préalable.")
    }

    /// LE CAS QUE LA COMPARAISON EN MÉMOIRE RATAIT.
    ///
    /// L'ancienne version comparait la session précédente à la nouvelle,
    /// toutes deux en mémoire. Quelqu'un qui force la fermeture de
    /// l'application entre les deux connexions repart d'une mémoire
    /// vide : le changement devenait invisible. Le disque, lui, s'en
    /// souvient — c'est toute la raison d'être de ce fichier.
    func testLeProprietaireSurvitAUnRedemarrage() {
        let premier = UUID()
        IdentiteLocale.inscrire(premier)

        // Ce que voit un processus neuf : rien en mémoire, tout sur le
        // disque. `proprietaire` relit le stockage à chaque appel.
        XCTAssertEqual(IdentiteLocale.proprietaire, premier)
        XCTAssertEqual(IdentiteLocale.comparer(a: UUID()), .changementDeCompte)
    }

    func testOublierRemetAZero() {
        IdentiteLocale.inscrire(UUID())
        IdentiteLocale.oublier()

        XCTAssertNil(IdentiteLocale.proprietaire)
        XCTAssertEqual(IdentiteLocale.comparer(a: UUID()), .adoption)
    }

    /// LA CAUSE DE FOND, VERROUILLÉE.
    ///
    /// Le nettoyage tenait sa PROPRE liste de modèles, écrite à la main,
    /// qui n'a jamais suivi les phases 4 à 7 : sept sur cinquante-sept.
    /// Il n'y a plus qu'une liste, celle du conteneur, et elle sert aux
    /// deux. Ce test échouera si quelqu'un en réintroduit une seconde en
    /// vidant celle-ci, ou si le conteneur cesse de la lire.
    func testUneSeuleListeDeModelesEtElleEstComplete() {
        XCTAssertGreaterThan(SharedModelContainer.modeles.count, 50,
                             "La liste du conteneur sert aussi au nettoyage de la déconnexion : si elle maigrit, des données du compte précédent restent sur l'appareil.")

        let noms = SharedModelContainer.modeles.map { String(describing: $0) }
        XCTAssertEqual(Set(noms).count, noms.count, "Un modèle listé deux fois est le signe d'une fusion mal faite.")

        // Les sept que l'ancienne version connaissait, et un échantillon
        // de ceux qu'elle oubliait — un par phase, ceux qui portent des
        // données personnelles.
        for attendu in ["Plant", "Garden", "GardenZone", "CareEvent", "CareSchedule",
                        "PlantPhoto", "PendingDeletion",
                        "SmartTag", "TreeInspection", "GardenCheckup", "Sensor",
                        "IrrigationZone", "PlantMeasurement", "AIAnalysis",
                        "ConnectedDevice", "CultureBatch", "BioLabExperiment"] {
            XCTAssertTrue(noms.contains(attendu), "\(attendu) doit être effacé à la déconnexion.")
        }
    }
}
