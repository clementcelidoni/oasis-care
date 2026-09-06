import XCTest
@testable import OasisCare

/// §15 — L'ADRESSE D'UNE ÉTIQUETTE, ET SA RELECTURE.
///
/// Deux choses se jouent ici, et l'une des deux engage dix ans :
///
///   • L'ADRESSE ÉCRITE. Elle finit gravée dans un QR imprimé et dans
///     une puce NFC. Elle ne doit plus être codée en dur, et son défaut
///     ne doit surtout pas redevenir un domaine qui ne résout pas.
///   • L'ADRESSE RELUE. Cinq étiquettes portent déjà l'ancien chemin
///     `/p/` et l'ancien domaine `oasis-care.example`. Elles doivent
///     rester scannables POUR TOUJOURS : elles sont collées sur des
///     plantes, et personne ne va les décoller.
final class SmartTagConfigTests: XCTestCase {

    // MARK: - Les étiquettes déjà collées

    func testAncienneAdresseTouJoursLisible() {
        // Les cinq étiquettes de production, mot pour mot : ancien
        // domaine mort par la RFC 2606, ancien chemin. Ce test est le
        // seul qui empêche une réimpression complète.
        let url = URL(string: "https://oasis-care.example/p/0123456789abcdef0123456789abcdef")!
        XCTAssertEqual(SmartTagConfig.token(from: url), "0123456789abcdef0123456789abcdef")
    }

    func testHoteJamaisVerifie() {
        // C'est CE point qui sauve les étiquettes existantes : l'analyse
        // ne fait aucune requête DNS et ne compare aucun domaine. Ne
        // jamais ajouter de contrôle d'hôte ici sans décoller les
        // autocollants d'abord.
        for hote in ["oasis-care.example", "oasisrarecare.fr", "oasisrarecare.com", "n-importe.quoi"] {
            let url = URL(string: "https://\(hote)/x/abc123")!
            XCTAssertEqual(SmartTagConfig.token(from: url), "abc123", "hôte refusé : \(hote)")
        }
    }

    func testLesDeuxCheminsSontAcceptes() {
        XCTAssertEqual(SmartTagConfig.token(from: URL(string: "https://exemple.fr/x/abc123")!), "abc123")
        XCTAssertEqual(SmartTagConfig.token(from: URL(string: "https://exemple.fr/p/abc123")!), "abc123")
    }

    // MARK: - Le schéma personnalisé

    func testSchemaPersonnaliseAncienEtNouveauChemin() {
        // Le seul chemin d'ouverture qui fonctionne aujourd'hui : les
        // liens universels demandent un entitlement Associated Domains
        // qui n'est pas déclaré (voir le compte rendu).
        XCTAssertEqual(SmartTagConfig.token(from: URL(string: "com.oasisrarecare.app://p/abc123")!), "abc123")
        XCTAssertEqual(SmartTagConfig.token(from: URL(string: "com.oasisrarecare.app://x/abc123")!), "abc123")
    }

    func testCheminInconnuRefuse() {
        XCTAssertNil(SmartTagConfig.token(from: URL(string: "https://exemple.fr/other/abc123")!))
        XCTAssertNil(SmartTagConfig.token(from: URL(string: "com.oasisrarecare.app://other/abc123")!))
        XCTAssertNil(SmartTagConfig.token(from: URL(string: "https://exemple.fr/x/")!))
    }

    func testJetonRogneEtMisEnMinuscules() {
        // Une adresse recopiée à la main depuis un autocollant abîmé.
        // La base normalise de la même façon (`lower(btrim(…))`).
        XCTAssertEqual(SmartTagConfig.token(from: URL(string: "https://exemple.fr/x/ABC123")!), "abc123")
    }

    // MARK: - L'adresse écrite

    func testAdresseEcriteEmploieLeNouveauChemin() {
        let url = SmartTagConfig.url(forToken: "deadbeef1234")
        XCTAssertTrue(url.hasSuffix("/x/deadbeef1234"), "adresse produite : \(url)")
        XCTAssertTrue(url.hasPrefix("https://"))
    }

    func testAdresseEcriteNeContientPlusLeDomaineMort() {
        // `.example` est réservé par la RFC 2606 : il ne résout pas et ne
        // résoudra jamais. Toute étiquette qui le porterait naîtrait
        // morte pour la caméra du système.
        XCTAssertFalse(SmartTagConfig.url(forToken: "abc").contains(".example"))
        XCTAssertFalse(SmartTagConfig.domaineParDefaut.hasSuffix(".example"))
    }

    func testAllerRetourEntreEcritureEtLecture() {
        let jeton = "0123456789abcdef0123456789abcdef"
        let url = URL(string: SmartTagConfig.url(forToken: jeton))!
        XCTAssertEqual(SmartTagConfig.token(from: url), jeton)
    }

    // MARK: - L'adresse n'est plus codée en dur

    func testLeReglageEnregistrePrimeSurTout() {
        XCTAssertEqual(
            SmartTagConfig.domaineRetenu(reglage: "etiquettes.oasisrarecare.fr", paquet: "autre.fr"),
            "etiquettes.oasisrarecare.fr"
        )
    }

    func testLePaquetPrendLeRelaisQuandRienNEstEnregistre() {
        XCTAssertEqual(SmartTagConfig.domaineRetenu(reglage: nil, paquet: "recette.oasisrarecare.fr"),
                       "recette.oasisrarecare.fr")
    }

    func testLeDefautSApplique() {
        XCTAssertEqual(SmartTagConfig.domaineRetenu(reglage: nil, paquet: nil),
                       SmartTagConfig.domaineParDefaut)
    }

    func testUnDomaineApproximatifEstIgnore() {
        // Un domaine bancal fabriquerait des adresses bancales, et elles
        // partiraient à l'impression. Mieux vaut le défaut.
        for bancal in ["", "   ", "pas de domaine", "oasisrarecare", "exemple.fr/x", "/"] {
            XCTAssertEqual(
                SmartTagConfig.domaineRetenu(reglage: bancal, paquet: nil),
                SmartTagConfig.domaineParDefaut,
                "« \(bancal) » aurait dû être ignoré"
            )
        }
    }

    func testUnDomaineDeRecetteEstAccepte() {
        // Le levier sert d'abord à pointer une recette avant d'imprimer
        // quoi que ce soit en série.
        XCTAssertEqual(SmartTagConfig.domaineRetenu(reglage: "recette.oasisrarecare.fr", paquet: nil),
                       "recette.oasisrarecare.fr")
        // « localhost » est refusé, et c'est volontaire : l'adresse est
        // toujours écrite en « https:// ».
        XCTAssertEqual(SmartTagConfig.domaineRetenu(reglage: "localhost:3000", paquet: nil),
                       SmartTagConfig.domaineParDefaut)
    }

    func testUnDomaineSaisiAvecSonSchemaEstAccepte() {
        // Ce réglage sera posé un jour à la main, dans l'urgence :
        // refuser une barre oblique de trop coûterait une soirée.
        XCTAssertEqual(SmartTagConfig.domaineRetenu(reglage: "https://Oasisrarecare.FR/", paquet: nil),
                       "oasisrarecare.fr")
    }

    // MARK: - La forme du jeton

    func testJetonPlausible() {
        // 32 caractères hexadécimaux minuscules : la forme des cinq
        // étiquettes de production, celle du défaut posé par 0090, et
        // celle de l'expression régulière du résolveur.
        XCTAssertTrue(SmartTagConfig.jetonPlausible("0123456789abcdef0123456789abcdef"))
        XCTAssertFalse(SmartTagConfig.jetonPlausible("0123456789ABCDEF0123456789ABCDEF"))
        XCTAssertFalse(SmartTagConfig.jetonPlausible(String(repeating: "a", count: 31)))
        XCTAssertFalse(SmartTagConfig.jetonPlausible(String(repeating: "a", count: 33)))
        // 64 caractères, c'est un jeton de partage de document, pas
        // d'étiquette : les deux registres ne se répondent pas l'un pour
        // l'autre.
        XCTAssertFalse(SmartTagConfig.jetonPlausible(String(repeating: "a", count: 64)))
        XCTAssertFalse(SmartTagConfig.jetonPlausible(String(repeating: "z", count: 32)))
        XCTAssertFalse(SmartTagConfig.jetonPlausible(""))
    }

    func testUnJetonProduitParLApplicationEstPlausible() {
        // `SmartTag.generateToken()` est privé, mais sa recette tient en
        // une ligne et elle est stable depuis la Phase 4 : un UUID sans
        // tirets, en minuscules. On la rejoue ici plutôt que d'instancier
        // un @Model — ce test n'a besoin d'aucun conteneur SwiftData.
        //
        // Si les deux formes divergeaient, l'application refuserait ses
        // propres étiquettes avant même d'appeler le serveur.
        for _ in 0..<20 {
            let jeton = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            XCTAssertTrue(SmartTagConfig.jetonPlausible(jeton), "jeton : \(jeton)")
        }
    }
}
