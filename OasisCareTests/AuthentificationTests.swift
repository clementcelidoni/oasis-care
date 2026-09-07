import XCTest
@testable import OasisCare

/// CE QUE CES TESTS COUVRENT, ET CE QU'ILS NE PEUVENT PAS COUVRIR.
///
/// ══════════════════════════════════════════════════════════════════
/// AUCUN APPEL RÉSEAU, ET C'EST UNE CONTRAINTE UTILE
/// ══════════════════════════════════════════════════════════════════
///
/// Rien ici ne parle à Supabase. Ce n'est pas une limite subie : un test
/// d'authentification qui appellerait le vrai serveur consommerait le
/// quota d'envoi de courriels, échouerait hors ligne, et — pire — ne
/// dirait rien de neuf, puisque le comportement du serveur n'est pas ce
/// que nous écrivons.
///
/// Ce que nous écrivons, et donc ce qui est testé ici :
///   • les règles locales (longueur, deux saisies, forme de l'adresse) ;
///   • la traduction des refus du serveur en phrases françaises ;
///   • la décision « ce compte peut-il poser un mot de passe ? » ;
///   • et, par lecture du source, les interdits qui ne se voient pas à
///     l'exécution : aucun secret journalisé, aucun secret persisté.
///
/// Ce qui reste NON couvert et doit être essayé à la main : la séquence
/// réelle code → mot de passe → reconnexion, sur un compte neuf ET sur
/// un compte existant, parce que Supabase n'emploie pas le même gabarit
/// de courriel dans les deux cas.
final class AuthentificationTests: XCTestCase {

    // MARK: - L'adresse

    func testAdresseNormaliseeEnleveLesEspacesEtLesMajuscules() {
        XCTAssertEqual(AdresseCourriel.normalisee("  Clement@Exemple.COM \n"), "clement@exemple.com")
    }

    func testAdresseNormaliseeNeTouchePasAuPointNiAuPlus() {
        // Certains serveurs traitent « a.b@ » et « ab@ » comme deux
        // boîtes différentes. Les « normaliser » enverrait le code
        // ailleurs, sans que personne comprenne pourquoi.
        XCTAssertEqual(AdresseCourriel.normalisee("cle.ment+devis@exemple.com"), "cle.ment+devis@exemple.com")
    }

    func testAdressePlausible() {
        XCTAssertTrue(AdresseCourriel.estPlausible("clement@exemple.com"))
        XCTAssertTrue(AdresseCourriel.estPlausible(" Clement@Exemple.co.uk "))
        XCTAssertTrue(AdresseCourriel.estPlausible("cle.ment+devis@exemple.fr"))
    }

    func testAdresseNonPlausible() {
        XCTAssertFalse(AdresseCourriel.estPlausible(""))
        XCTAssertFalse(AdresseCourriel.estPlausible("clement"))
        XCTAssertFalse(AdresseCourriel.estPlausible("clement@"))
        XCTAssertFalse(AdresseCourriel.estPlausible("@exemple.com"))
        XCTAssertFalse(AdresseCourriel.estPlausible("clement@exemple"))
        XCTAssertFalse(AdresseCourriel.estPlausible("clement@exemple."))
        XCTAssertFalse(AdresseCourriel.estPlausible("clement@@exemple.com"))
        XCTAssertFalse(AdresseCourriel.estPlausible("cle ment@exemple.com"))
    }

    func testAdresseMasqueeGardeLaPremiereLettreEtLeDomaine() {
        // Assez pour se reconnaître, pas assez pour être lue
        // par-dessus l'épaule.
        let masquee = AdresseCourriel.masquee("Clement@exemple.com")
        XCTAssertTrue(masquee.hasPrefix("c"))
        XCTAssertTrue(masquee.hasSuffix("@exemple.com"))
        XCTAssertFalse(masquee.contains("lement"))
    }

    // MARK: - Le code

    func testCodeNettoyeNeGardeQueLesChiffres() {
        XCTAssertEqual(CodeCourriel.nettoye(" 12 34-56 78\n"), "12345678")
    }

    func testCodeNettoyeCoupeAuDelaDeLaLongueurAttendue() {
        XCTAssertEqual(CodeCourriel.nettoye("1234567890"), "12345678")
        XCTAssertEqual(CodeCourriel.longueurAttendue, 8)
    }

    func testCodeNettoyeRefuseLesChiffresNonAscii() {
        // « ٣ » passe `isNumber` et serait refusé par le serveur : le
        // laisser entrer produirait un « code faux » incompréhensible.
        XCTAssertEqual(CodeCourriel.nettoye("12٣45"), "1245")
    }

    func testCodeCompletDesSixChiffres() {
        // Six et non huit : la longueur du code est un réglage de
        // serveur. S'il redescendait à six, un bouton qui n'accepte que
        // huit chiffres enfermerait tout le monde dehors.
        XCTAssertFalse(CodeCourriel.estComplet("12345"))
        XCTAssertTrue(CodeCourriel.estComplet("123456"))
        XCTAssertTrue(CodeCourriel.estComplet("12345678"))
    }

    func testDelaiDeRenvoiSuitLeServeur() {
        // `smtp_max_frequency = 60`. Trente secondes rendaient le
        // bouton cliquable avant que le serveur accepte.
        XCTAssertEqual(CodeCourriel.delaiEntreDeuxEnvois, 60)
    }

    // MARK: - Le mot de passe

    func testMotDePasseTropCourtEstRefuse() {
        XCTAssertEqual(RegleMotDePasse.refus(motDePasse: "Paysage1!", confirmation: "Paysage1!"), .tropCourt)
    }

    func testLongueurMinimaleGenereuse() {
        XCTAssertGreaterThanOrEqual(RegleMotDePasse.longueurMinimale, 12)
    }

    func testPhraseLongueAcceptee() {
        XCTAssertNil(RegleMotDePasse.refus(
            motDePasse: "le figuier du balcon nord",
            confirmation: "le figuier du balcon nord"
        ))
    }

    func testAucuneExigenceDeComposition() {
        // Ni majuscule, ni chiffre, ni symbole. Et rien d'interdit :
        // espaces, accents et émojis passent.
        XCTAssertNil(RegleMotDePasse.refus(motDePasse: "aaaaaaaaaaaa", confirmation: "aaaaaaaaaaaa"))
        XCTAssertNil(RegleMotDePasse.refus(motDePasse: "épinède à l'été", confirmation: "épinède à l'été"))
        XCTAssertNil(RegleMotDePasse.refus(motDePasse: "jardin 🌿 secret", confirmation: "jardin 🌿 secret"))
    }

    func testLesEspacesDeBoutNeSontPasRognes() {
        // Rogner silencieusement changerait le mot de passe envoyé au
        // serveur, et la personne ne pourrait plus le reproduire.
        let avecEspace = " le figuier du balcon "
        XCTAssertNil(RegleMotDePasse.refus(motDePasse: avecEspace, confirmation: avecEspace))
        XCTAssertEqual(RegleMotDePasse.refus(motDePasse: avecEspace, confirmation: "le figuier du balcon"), .saisiesDifferentes)
    }

    func testSaisiesDifferentesSignaleesSeulementSiLaLongueurEstAtteinte() {
        // Sinon on reproche une différence à quelqu'un dont les deux
        // champs sont identiques mais trop courts.
        XCTAssertEqual(RegleMotDePasse.refus(motDePasse: "court", confirmation: "autre"), .tropCourt)
        XCTAssertEqual(
            RegleMotDePasse.refus(motDePasse: "le figuier du balcon", confirmation: "le figuier du balcom"),
            .saisiesDifferentes
        )
    }

    func testMessagesDeRefusEnFrancaisEtSansLeSecret() {
        for refus in [RegleMotDePasse.Refus.tropCourt, .saisiesDifferentes] {
            let message = RegleMotDePasse.message(pour: refus)
            XCTAssertFalse(message.isEmpty)
            XCTAssertFalse(message.lowercased().contains("password"))
        }
    }

    // MARK: - Qui a le droit à un mot de passe

    func testCompteAvecIdentiteEmailPeutPoserUnMotDePasse() {
        XCTAssertTrue(IdentiteCompte.peutPoserUnMotDePasse(fournisseurs: ["email"]))
        XCTAssertTrue(IdentiteCompte.peutPoserUnMotDePasse(fournisseurs: ["apple", "email", "google"]))
        XCTAssertTrue(IdentiteCompte.peutPoserUnMotDePasse(fournisseurs: ["EMAIL"]))
    }

    func testCompteUniquementSocialNeSeVoitJamaisProposerUnMotDePasse() {
        // La consigne du dirigeant, mot pour mot : après connexion par
        // Google ou Apple, il n'y a pas de mot de passe, et l'écran ne
        // doit en réclamer nulle part.
        XCTAssertFalse(IdentiteCompte.peutPoserUnMotDePasse(fournisseurs: ["apple"]))
        XCTAssertFalse(IdentiteCompte.peutPoserUnMotDePasse(fournisseurs: ["google"]))
        XCTAssertFalse(IdentiteCompte.peutPoserUnMotDePasse(fournisseurs: ["apple", "google"]))
        XCTAssertFalse(IdentiteCompte.peutPoserUnMotDePasse(fournisseurs: []))
    }

    func testLeResultatDeVerificationRepercuteLaDecision() {
        XCTAssertTrue(ResultatVerificationCode(fournisseurs: ["email"]).peutPoserUnMotDePasse)
        XCTAssertFalse(ResultatVerificationCode(fournisseurs: ["apple"]).peutPoserUnMotDePasse)
    }

    // MARK: - La traduction des refus du serveur

    func testCodePerimeOuFauxDonneUneSeulePhraseEtLesDeuxGestes() {
        // GoTrue ne distingue pas les deux : il rend `otp_expired` dans
        // les deux cas. Une phrase, deux gestes offerts.
        for indice in ["authError(errorcode: otp_expired)", "token has expired or is invalid", "email link is invalid or has expired"] {
            let texte = MessageErreurAuth.texte(indice: indice, geste: .verificationDuCode)
            XCTAssertTrue(texte.contains("Réessayez"), indice)
            XCTAssertTrue(texte.contains("nouveau"), indice)
        }
    }

    func testUnCodePerimeNEstPasPrisPourUnMotDePasseErrone() {
        // « invalid or has expired » contient « invalid » : c'est le
        // piège que l'ordre des tests doit éviter.
        let texte = MessageErreurAuth.texte(indice: "email link is invalid or has expired", geste: .verificationDuCode)
        XCTAssertFalse(texte.lowercased().contains("mot de passe incorrect"))
    }

    func testTropDeCourrielsExpliqueLAttente() {
        for indice in ["over_email_send_rate_limit", "for security purposes, you can only request this after 60 seconds"] {
            let texte = MessageErreurAuth.texte(indice: indice, geste: .envoiDuCode)
            XCTAssertTrue(texte.contains("minute"), indice)
        }
    }

    func testIdentifiantsIncorrectsNeDisentPasLequelDesDeux() {
        let texte = MessageErreurAuth.texte(indice: "invalid_credentials", geste: .connexionParMotDePasse)
        // Une seule phrase pour « adresse inconnue », « mauvais mot de
        // passe » et « ce compte n'entre que par Google » : le serveur
        // ne les distingue pas, l'écran non plus.
        XCTAssertTrue(texte.contains("Adresse e-mail ou mot de passe"))
        XCTAssertTrue(texte.contains("code"))
    }

    func testAdresseNonConfirmeeNeSeDistinguePasDUnMotDePasseFaux() {
        // LES TROIS PORTES DOIVENT RÉPONDRE LA MÊME CHOSE. Une phrase
        // propre à « adresse non confirmée » serait juste, utile — et
        // elle avouerait que le compte existe. Les deux applications
        // web fondent ce cas dans la phrase des identifiants refusés ;
        // le téléphone le faisait autrement, et cet écart est
        // exactement le genre de chose qui se recopie ensuite ailleurs.
        let nonConfirmee = MessageErreurAuth.texte(indice: "email_not_confirmed", geste: .connexionParMotDePasse)
        let identifiants = MessageErreurAuth.texte(indice: "invalid_credentials", geste: .connexionParMotDePasse)
        XCTAssertEqual(nonConfirmee, identifiants)
        // Et elle mène toujours au geste qui débloque les deux cas.
        XCTAssertTrue(nonConfirmee.contains("code"))
        // Rien qui parle de confirmation, d'attente, ou d'un compte.
        XCTAssertFalse(nonConfirmee.lowercased().contains("confirm"))
    }

    func testMotDePasseFaibleOuDejaLeMemeSontDistingues() {
        let faible = MessageErreurAuth.texte(indice: "weak_password", geste: .enregistrementDuMotDePasse)
        let identique = MessageErreurAuth.texte(indice: "same_password", geste: .enregistrementDuMotDePasse)
        XCTAssertNotEqual(faible, identique)
        XCTAssertTrue(identique.contains("déjà"))
    }

    func testUneErreurInconnueResteFrancaiseEtDependDuGeste() {
        let gestes: [GesteAuthentification] = [.envoiDuCode, .verificationDuCode, .connexionParMotDePasse, .enregistrementDuMotDePasse]
        var phrases = Set<String>()
        for geste in gestes {
            let texte = MessageErreurAuth.texte(indice: "unexpected failure 500 internal server error", geste: geste)
            phrases.insert(texte)
            XCTAssertFalse(texte.isEmpty)
        }
        XCTAssertEqual(phrases.count, gestes.count, "chaque geste mérite sa phrase")
    }

    func testAucuneTraductionNeLaisseFuirLAnglaisDuServeur() {
        let indices = [
            "otp_expired", "over_email_send_rate_limit", "over_request_rate_limit",
            "invalid_credentials", "email_not_confirmed", "weak_password", "same_password",
            "user_banned", "otp_disabled", "email_address_invalid", "quelque chose d'imprévu"
        ]
        let motsAnglais = ["token", "password should", "invalid", "rate limit", "expired", "credentials"]
        for indice in indices {
            let texte = MessageErreurAuth.texte(indice: indice, geste: .verificationDuCode).lowercased()
            for mot in motsAnglais {
                XCTAssertFalse(texte.contains(mot), "« \(mot) » ne doit pas atteindre l'écran (indice : \(indice))")
            }
        }
    }

    func testLAbsenceDeReseauEstNommeeCommeTelle() {
        let horsLigne = URLError(.notConnectedToInternet)
        let texte = MessageErreurAuth.texte(pour: horsLigne, geste: .envoiDuCode)
        XCTAssertTrue(texte.contains("connexion Internet") || texte.contains("Internet"))
    }

    func testLIndiceRassembleLesDeuxDescriptionsDeLErreur() {
        struct ErreurFactice: LocalizedError {
            var errorDescription: String? { "Token has expired or is invalid" }
        }
        let indice = MessageErreurAuth.indice(de: ErreurFactice())
        XCTAssertTrue(indice.contains("token has expired"))
        XCTAssertEqual(indice, indice.lowercased(), "l'indice doit être comparable sans se soucier de la casse")
    }

    // MARK: - Les interdits, vérifiés par lecture du source
    //
    // Ces règles-là ne se voient pas à l'exécution : un mot de passe
    // journalisé fonctionne parfaitement. Elles se vérifient donc en
    // lisant le fichier — le même procédé que `web-pro/app/x/page.test.ts`.

    private func lireSource(_ chemin: String) throws -> String {
        let racine = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // OasisCareTests
            .deletingLastPathComponent()  // racine du dépôt
        let url = racine.appendingPathComponent(chemin)
        guard let contenu = try? String(contentsOf: url, encoding: .utf8) else {
            throw XCTSkip("Source illisible depuis cet environnement : \(url.path)")
        }
        return contenu
    }

    func testLEcranDeConnexionNeJournaliseRien() throws {
        let source = try lireSource("OasisCare/Views/Auth/EmailSignInView.swift")
        for interdit in ["print(", "NSLog(", "OasisLog", "debugPrint("] {
            XCTAssertFalse(source.contains(interdit), "« \(interdit) » n'a rien à faire près d'un mot de passe")
        }
    }

    func testLEcranDeConnexionNePersisteRien() throws {
        let source = try lireSource("OasisCare/Views/Auth/EmailSignInView.swift")
        for interdit in ["AppStorage", "UserDefaults", "Keychain"] {
            XCTAssertFalse(source.contains(interdit), "un mot de passe ne se range pas dans \(interdit)")
        }
    }

    func testLEcranSeSertDesAtoutsDuTelephone() throws {
        let source = try lireSource("OasisCare/Views/Auth/EmailSignInView.swift")
        XCTAssertTrue(source.contains(".oneTimeCode"), "le code doit être proposé au-dessus du clavier")
        XCTAssertTrue(source.contains(".newPassword"), "le trousseau doit pouvoir enregistrer le mot de passe")
        XCTAssertTrue(source.contains(".password"), "le trousseau doit pouvoir le ressortir")
        XCTAssertTrue(source.contains(".username"), "sans lui, le trousseau n'associe pas l'adresse au mot de passe")
    }

    func testLeServiceEstLeSeulAParlerDeMotDePasseAuServeur() throws {
        let service = try lireSource("OasisCare/Services/Auth/AuthService.swift")
        XCTAssertTrue(service.contains("auth.signIn(email:"), "la connexion par mot de passe passe par le service")
        XCTAssertFalse(service.contains("print("), "aucun journal sur le chemin du secret")

        let ecran = try lireSource("OasisCare/Views/Auth/EmailSignInView.swift")
        XCTAssertFalse(ecran.contains("AuthService.client"), "l'écran ne parle jamais directement à Supabase")
    }
}
