import XCTest
@testable import OasisCare

/// LA VÉRIFICATION ANTI-ROBOT, ÉPROUVÉE SANS RIEN CHARGER.
///
/// ══════════════════════════════════════════════════════════════════
/// COMMENT ON TESTE UN WIDGET QUI NE SE CHARGE JAMAIS
/// ══════════════════════════════════════════════════════════════════
///
/// Rien ici n'ouvre de vue web, ne joint Cloudflare, ni ne parle à
/// Supabase. Ce n'est pas une limite subie : le widget est un morceau de
/// page web servi par un tiers, et un test qui l'attendrait serait lent,
/// échouerait hors ligne, et ne dirait rien de ce que NOUS écrivons.
///
/// Ce que nous écrivons, et donc ce qui est éprouvé ici :
///   • la résolution de la clé de site et de l'origine, en fonctions
///     pures qui reçoivent leurs deux sources en paramètre ;
///   • la page HTML, qui est une chaîne fabriquée par une fonction pure
///     et qui doit porter les quatre options qui font tout le
///     comportement ;
///   • la traduction du refus `captcha_failed` en français, qui est
///     l'endroit exact où ce chantier peut mentir à un utilisateur ;
///   • par relecture du source, les invariants qu'aucune exécution ne
///     montrerait : deux appels protégés et deux seulement, aucun jeton
///     sur `verifyOTP`, aucune clé d'essai livrée en production.
///
/// CE QUI RESTE NON COUVERT ET DOIT ÊTRE ESSAYÉ À LA MAIN — c'est écrit
/// franchement, parce que c'est la moitié qui compte :
///   1. le chemin complet avec les clés d'essai de Cloudflare, posées
///      par argument de lancement `-turnstile.cledesite` et appariées
///      chez Supabase à la clé secrète d'essai correspondante ;
///   2. la clé `3x00000000000000000000FF`, qui FORCE l'énigme : c'est le
///      seul moyen de voir la vue web grandir pour de vrai ;
///   3. la clé secrète `3x0000…AA`, qui répond « jeton déjà dépensé » :
///      elle reproduit exactement le piège du jeton à usage unique ;
///   4. le mode avion, et un réseau qui filtre challenges.cloudflare.com,
///      pour vérifier que le bouton rend la main au bout de douze
///      secondes au lieu de rester figé.
final class TurnstileTests: XCTestCase {

    // MARK: - La clé de site : trois sources, dans l'ordre

    func testLeReglageDUrgencePrimeSurLePaquet() {
        // C'est le levier qui évite deux semaines de délai App Store le
        // jour où la clé doit basculer.
        XCTAssertEqual(
            TurnstileConfig.cleRetenue(reglage: "0xURGENCE", paquet: "0xPAQUET"),
            "0xURGENCE"
        )
    }

    func testLePaquetSertQuandAucunReglageNEstPose() {
        XCTAssertEqual(TurnstileConfig.cleRetenue(reglage: nil, paquet: "0xPAQUET"), "0xPAQUET")
    }

    func testAucuneCleDuToutEstUneReponseValide() {
        // L'ÉTAT NORMAL AVANT L'ACTIVATION. Pas une panne : sans clé,
        // aucune vue web n'est montée et les appels partent sans jeton,
        // exactement comme avant ce chantier.
        XCTAssertNil(TurnstileConfig.cleRetenue(reglage: nil, paquet: nil))
    }

    func testUneCleVideOuBlancheVautPasDeCle() {
        // `project.yml` déclare la clé vide tant que le site Cloudflare
        // n'existe pas. Une chaîne vide envoyée au widget produirait une
        // erreur illisible plutôt qu'un silence propre.
        XCTAssertNil(TurnstileConfig.cleRetenue(reglage: "", paquet: ""))
        XCTAssertNil(TurnstileConfig.cleRetenue(reglage: "   ", paquet: "\n"))
        XCTAssertNil(TurnstileConfig.cleRetenue(reglage: "", paquet: nil))
    }

    func testLaCleEstRogneeMaisJamaisMiseEnMinuscules() {
        // Une clé Cloudflare porte des majuscules. Les abaisser la
        // rendrait invalide sans le moindre message à l'écran.
        XCTAssertEqual(TurnstileConfig.cleRetenue(reglage: "  0x4AAAAAAAbCdEf  ", paquet: nil), "0x4AAAAAAAbCdEf")
    }

    // MARK: - Les clés d'essai, reconnues pour ne jamais être livrées

    func testLesCinqClesDEssaiSontReconnues() {
        for cle in [
            "1x00000000000000000000AA",
            "2x00000000000000000000AB",
            "1x00000000000000000000BB",
            "2x00000000000000000000BB",
            "3x00000000000000000000FF",
        ] {
            XCTAssertTrue(TurnstileConfig.estUneCleDEssai(cle), "clé d'essai non reconnue : \(cle)")
        }
    }

    func testUneVraieCleNEstPasPriseParErreurPourUneCleDEssai() {
        XCTAssertFalse(TurnstileConfig.estUneCleDEssai("0x4AAAAAAAkQzYtF3rXsL9pQ"))
        XCTAssertFalse(TurnstileConfig.estUneCleDEssai(""))
    }

    // MARK: - L'origine

    func testOrigineParDefautQuandRienNEstPose() {
        XCTAssertEqual(
            TurnstileConfig.origineRetenue(reglage: nil, paquet: nil).absoluteString,
            "https://oasisrarecare.com"
        )
    }

    func testOrigineDuPaquetEtBarreObliqueDeTrop() {
        // Le réglage sera posé un jour à la main, dans l'urgence :
        // refuser une barre oblique de trop coûterait une soirée.
        XCTAssertEqual(
            TurnstileConfig.origineRetenue(reglage: nil, paquet: "https://recette.oasisrarecare.com/").absoluteString,
            "https://recette.oasisrarecare.com"
        )
    }

    func testOrigineSansSchemaEstCompletee() {
        XCTAssertEqual(
            TurnstileConfig.origineRetenue(reglage: "oasisrarecare.com", paquet: nil).absoluteString,
            "https://oasisrarecare.com"
        )
    }

    func testUneOrigineBancaleRetombeSurLeDefaut() {
        // Une origine approximative ne se verrait sur aucun écran : elle
        // se verrait par une porte d'entrée qui refuse tout le monde, le
        // jour de l'activation.
        for bancale in ["", "   ", "localhost", "http://oasisrarecare.com", "oasis rare care", "/x/y"] {
            XCTAssertEqual(
                TurnstileConfig.origineRetenue(reglage: bancale, paquet: nil).absoluteString,
                "https://oasisrarecare.com",
                "origine acceptée à tort : « \(bancale) »"
            )
        }
    }

    // MARK: - La page, fabriquée par une fonction pure

    func testLaPagePorteLaCleDeSite() {
        let page = TurnstileConfig.html(cleDeSite: "1x00000000000000000000BB")
        XCTAssertTrue(page.contains("sitekey: '1x00000000000000000000BB'"))
    }

    func testLaPagePorteLesQuatreOptionsQuiFontLeComportement() {
        let page = TurnstileConfig.html(cleDeSite: "0xTEST")

        // Invisible tant que possible : c'est ce qui permet de se
        // connecter depuis un camion sans rien voir.
        XCTAssertTrue(page.contains("appearance: 'interaction-only'"))

        // Le défi ne démarre que sur demande de Swift : sinon le jeton
        // serait déjà vieux quand on s'en sert.
        XCTAssertTrue(page.contains("execution: 'execute'"))

        // Aucun renouvellement dans notre dos : un jeton, un appel.
        XCTAssertTrue(page.contains("'refresh-expired': 'never'"))

        // Le seul signal qui dise « je vais devoir montrer quelque
        // chose ». Sans lui, l'énigme s'afficherait dans un carré d'un
        // pixel et l'écran paraîtrait figé.
        XCTAssertTrue(page.contains("'before-interactive-callback'"))
    }

    func testLaPageRedemandeUnJetonNeufEnReinitialisantLeWidget() {
        // C'EST LE PIÈGE DU JETON À USAGE UNIQUE, ÉCRIT NOIR SUR BLANC.
        // Un `execute` sans `reset` rendrait le même jeton, et le second
        // appel serait refusé sans que personne comprenne.
        let page = TurnstileConfig.html(cleDeSite: "0xTEST")
        XCTAssertTrue(page.contains("turnstile.reset(identifiant);"))
        XCTAssertTrue(page.contains("turnstile.execute(identifiant);"))

        guard let posReset = page.range(of: "turnstile.reset(identifiant);"),
              let posExecute = page.range(of: "turnstile.execute(identifiant);")
        else { return XCTFail("les deux appels doivent être présents") }
        XCTAssertTrue(posReset.lowerBound < posExecute.lowerBound, "la réinitialisation vient AVANT le lancement")
    }

    func testLaPageChargeLeScriptDeCloudflareEnRenduExplicite() {
        let page = TurnstileConfig.html(cleDeSite: "0xTEST")
        XCTAssertTrue(page.contains("https://challenges.cloudflare.com/turnstile/v0/api.js"))
        XCTAssertTrue(page.contains("render=explicit"))
    }

    func testLaPageNePorteJamaisDeCleSecrete() {
        // La clé secrète va chez Supabase, à la main. Une chaîne de
        // trente zéros est la forme des clés secrètes d'essai : si l'une
        // d'elles apparaissait ici, c'est qu'un essai à la main aurait
        // été figé dans le code.
        let page = TurnstileConfig.html(cleDeSite: "0xTEST")
        XCTAssertFalse(page.contains(String(repeating: "0", count: 25)))
    }

    func testLaCleEstAssainieAvantDEntrerDansLeScript() {
        // La clé vient d'un Info.plist ou d'un argument de lancement,
        // donc d'une source qu'un binaire de recette peut modifier. Une
        // apostrophe y refermerait la chaîne JavaScript.
        XCTAssertEqual(TurnstileConfig.cleAssainie("0x4AAA-_bC"), "0x4AAA-_bC")
        XCTAssertEqual(TurnstileConfig.cleAssainie("abc'; alert(1); //"), "abcalert1")

        let page = TurnstileConfig.html(cleDeSite: "abc'; alert(1); //")
        XCTAssertFalse(page.contains("alert(1)"), "une clé bricolée ne doit rien pouvoir injecter")
        XCTAssertTrue(page.contains("sitekey: 'abcalert1'"))
    }

    // MARK: - Ce que le portier rapporte

    func testSeulUnJetonSeJointALAppel() {
        XCTAssertEqual(ResultatTurnstile.jeton("XXXX.DUMMY.TOKEN.XXXX").jetonAJoindre, "XXXX.DUMMY.TOKEN.XXXX")
    }

    func testPasDeJetonNEstPasUnMotifDeRefusCoteClient() {
        // LA RÈGLE LA PLUS IMPORTANTE DU CHANTIER. Ces deux états
        // rendent `nil`, l'appel part quand même, et c'est le SERVEUR
        // qui tranche. Le contraire enfermerait dehors des gens que le
        // serveur aurait laissés entrer — notamment tant que le réglage
        // Supabase est éteint.
        XCTAssertNil(ResultatTurnstile.nonConfigure.jetonAJoindre)
        XCTAssertNil(ResultatTurnstile.indisponible.jetonAJoindre)
    }

    // MARK: - Le refus traduit, qui est l'endroit où l'on peut mentir

    func testLeRefusDeCaptchaADroitAUnePhraseAlui() {
        for indice in [
            "captcha_failed",
            "captcha protection: request disallowed (invalid-input-response)",
            "captcha protection: request disallowed (timeout-or-duplicate)",
        ] {
            let phrase = MessageErreurAuth.texte(indice: indice, geste: .connexionParMotDePasse)
            XCTAssertTrue(
                phrase.contains("vérification de sécurité"),
                "refus de captcha mal traduit : « \(indice) » → « \(phrase) »"
            )
        }
    }

    func testLeRefusDeCaptchaNEstJamaisPrisPourUnMotDePasseFaux() {
        // C'EST L'ÉCHEC LE PLUS COÛTEUX DU CHANTIER, ET IL EST
        // SILENCIEUX. Le message du serveur contient le mot « invalid » :
        // rangé après la branche des identifiants, il ferait dire à
        // l'écran « adresse ou mot de passe incorrect » à quelqu'un dont
        // le mot de passe est parfaitement juste.
        let phrase = MessageErreurAuth.texte(
            indice: "captcha protection: request disallowed (invalid-input-response)",
            geste: .connexionParMotDePasse
        )
        XCTAssertFalse(phrase.contains("mot de passe incorrect"))
    }

    func testLaTraductionDesAutresRefusNEstPasAbimee() {
        // Le garde-fou de la position : ajouter une branche en tête ne
        // doit pas avoir volé les cas qui suivent.
        XCTAssertTrue(
            MessageErreurAuth.texte(indice: "invalid_credentials", geste: .connexionParMotDePasse)
                .contains("mot de passe incorrect")
        )
        XCTAssertTrue(
            MessageErreurAuth.texte(indice: "otp_expired", geste: .verificationDuCode)
                .contains("code")
        )
    }

    func testLaPhraseDeCaptchaNommeLeGesteQuiDebloque() {
        // Une phrase qui dit seulement « échec » envoie la personne au
        // support. Celle-ci nomme les deux gestes qui marchent.
        let phrase = MessageErreurAuth.texte(indice: "captcha_failed", geste: .envoiDuCode)
        XCTAssertTrue(phrase.contains("4G"))
        XCTAssertTrue(phrase.contains("bloqueur"))
    }

    // MARK: - Les invariants, vérifiés par lecture du source
    //
    // Ces règles-là ne se voient pas à l'exécution : un jeton posé sur
    // le mauvais appel fonctionne parfaitement jusqu'au jour de
    // l'activation. Elles se vérifient donc en lisant les fichiers.

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

    func testDeuxAppelsPortentUnJetonEtDeuxSeulement() throws {
        let service = try lireSource("OasisCare/Services/Auth/AuthService.swift")
        let occurrences = service.components(separatedBy: "captchaToken: jetonCaptcha").count - 1
        XCTAssertEqual(
            occurrences, 2,
            "exactement deux routes sont protégées : POST /token et POST /otp. Ni plus, ni moins."
        )
        XCTAssertTrue(service.contains("signIn(email: email, password: password, captchaToken: jetonCaptcha)"))
        XCTAssertTrue(service.contains("signInWithOTP(email: email, captchaToken: jetonCaptcha)"))
    }

    func testLaVerificationDuCodeEtLeMotDePasseNePortentAucunJeton() throws {
        let service = try lireSource("OasisCare/Services/Auth/AuthService.swift")
        XCTAssertTrue(service.contains("verifyOTP(email: email, token: code, type: .email)"),
                      "POST /verify n'est pas protégé : un jeton posé là serait volé au renvoi de code")
        XCTAssertTrue(service.contains("update(user: UserAttributes(password: password))"),
                      "PUT /user n'est pas protégé, et l'interface Swift n'offre même pas de paramètre")
    }

    func testSignInWithAppleResteIntact() throws {
        // Exigence App Store : y toucher ferait refuser la version.
        // Et le serveur exempte explicitement grant_type=id_token.
        let service = try lireSource("OasisCare/Services/Auth/AuthService.swift")
        XCTAssertTrue(service.contains(
            "OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce)"
        ))
    }

    func testLEcranDeConnexionNeConnaitPasWebKit() throws {
        // La vue web appartient au portier. L'écran ne manipule qu'un
        // objet qui rend un jeton ou rien — même discipline que
        // « l'écran ne parle jamais directement à Supabase ».
        let ecran = try lireSource("OasisCare/Views/Auth/EmailSignInView.swift")
        XCTAssertFalse(ecran.contains("import WebKit"))
        XCTAssertFalse(ecran.contains("WKWebView"))
    }

    func testLePortierNeJournaliseRienEtNeRangeRien() throws {
        let portier = try lireSource("OasisCare/Services/Auth/PortierTurnstile.swift")
        for interdit in ["print(", "NSLog(", "OasisLog", "debugPrint("] {
            XCTAssertFalse(portier.contains(interdit), "« \(interdit) » n'a rien à faire sur le chemin d'un jeton")
        }
        for interdit in ["UserDefaults", "Keychain", "AppStorage"] {
            XCTAssertFalse(portier.contains(interdit), "un jeton à usage unique ne se range pas dans \(interdit)")
        }
    }

    // MARK: - Le levier de papier, qu'on ne refait pas deux fois

    func testLesDeuxClesSontDeclareesDansProjectYml() throws {
        // `OASIS_ETIQUETTES_DOMAINE` avait promis une bascule sans
        // App Store alors que la clé n'était déclarée nulle part : le
        // levier était de papier. On ne refait pas la même chose.
        let yml = try lireSource("project.yml")
        XCTAssertTrue(yml.contains(TurnstileConfig.cleInfoPlistCleDeSite + ":"))
        XCTAssertTrue(yml.contains(TurnstileConfig.cleInfoPlistOrigine + ":"))
    }

    func testAucuneCleDEssaiNePartEnProduction() throws {
        // Une clé de site d'essai appariée à la clé secrète de
        // production refuse TOUT LE MONDE. Ce test est la seule chose
        // qui se dresse entre un essai à la main et un parc dehors.
        let yml = try lireSource("project.yml")
        guard let valeur = valeurDeclaree(TurnstileConfig.cleInfoPlistCleDeSite, dans: yml) else {
            return XCTFail("la clé de site n'est pas déclarée dans project.yml")
        }
        XCTAssertFalse(
            TurnstileConfig.estUneCleDEssai(valeur),
            "une clé d'essai est déclarée dans project.yml : elle refuserait tout le monde en production"
        )
    }

    func testLaChainePublicationRefuseUneVersionSansCle() throws {
        // Le test voisin interdit une clé d'ESSAI. Celui-ci s'occupe de
        // l'accident INVERSE, et il est bien plus probable : la clé
        // ABSENTE. C'est l'état livré par le dépôt, c'est-à-dire celui
        // qu'on obtient en ne faisant rien — et c'est exactement celui
        // qui met tout le parc dehors le jour où le réglage CAPTCHA est
        // activé chez Supabase. Une version sans clé passe pourtant tous
        // les tests, passe la revue, s'installe, et fonctionne
        // parfaitement jusqu'à cette seconde-là.
        //
        // Un test unitaire ne peut pas l'interdire : la clé vide est
        // LÉGITIME aujourd'hui, et un test qui échouerait dès
        // maintenant serait désactivé dans la semaine. Le contrôle vit
        // donc dans la chaîne de publication, à l'endroit exact où une
        // version part vers de vrais téléphones. Ce test-ci vérifie
        // seulement qu'il y est toujours.
        let chaine = try lireSource(".github/workflows/testflight.yml")
        XCTAssertTrue(
            chaine.contains(TurnstileConfig.cleInfoPlistCleDeSite),
            "la chaîne de publication ne regarde plus si la clé anti-robot est posée"
        )
        XCTAssertTrue(
            chaine.contains("sans_captcha"),
            "la dérogation explicite a disparu : le contrôle ne peut plus être levé en conscience"
        )
    }

    /// Relit la valeur d'une clé du bloc `info.properties`, en ignorant
    /// les commentaires — le bloc en contient beaucoup, et certains
    /// citent les clés d'essai par leur nom.
    private func valeurDeclaree(_ nom: String, dans yml: String) -> String? {
        for ligne in yml.components(separatedBy: .newlines) {
            let propre = ligne.trimmingCharacters(in: .whitespaces)
            guard propre.hasPrefix(nom + ":") else { continue }
            var valeur = String(propre.dropFirst(nom.count + 1))
                .trimmingCharacters(in: .whitespaces)
            if valeur.hasPrefix("\"") && valeur.hasSuffix("\"") && valeur.count >= 2 {
                valeur = String(valeur.dropFirst().dropLast())
            }
            return valeur
        }
        return nil
    }
}
