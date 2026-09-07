import Foundation

/// LE CAPTCHA SUR TÉLÉPHONE — LA PARTIE QUI SE TESTE SANS RIEN CHARGER.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI UN CAPTCHA, ET POURQUOI IL N'Y A PAS D'AUTRE LEVIER
/// ══════════════════════════════════════════════════════════════════
///
/// Deux défauts se soignent d'un seul geste, et aucune ligne d'écran ne
/// pouvait les soigner :
///
///   1. ON DEVINE QUI EST CLIENT EN CHRONOMÉTRANT. Une adresse connue
///      met environ deux fois plus de temps à répondre qu'une inconnue,
///      parce que le serveur ne calcule l'empreinte du mot de passe que
///      s'il a trouvé un compte. L'écart est chez Supabase ; il n'est
///      pas corrigeable d'ici. Mais il ne se moissonne qu'en volume.
///   2. N'IMPORTE QUI PEUT FAIRE PARTIR UN COURRIEL OASIS CARE VERS
///      N'IMPORTE QUELLE ADRESSE. C'est la contrepartie assumée du fait
///      que s'inscrire et se connecter soient le même geste. Une machine
///      peut donc arroser des inconnus depuis notre domaine, et c'est la
///      réputation d'envoi de TOUT le parc qui tombe — y compris les
///      codes d'entrée des clients qui paient.
///
/// Le captcha coupe le volume. Sans volume, l'oracle de chronométrage ne
/// se moissonne plus et le formulaire d'envoi ne s'automatise plus.
///
/// ══════════════════════════════════════════════════════════════════
/// L'ORDRE EST IMPOSÉ, ET L'INVERSER ENFERME LE PARC DEHORS
/// ══════════════════════════════════════════════════════════════════
///
/// Le réglage du captcha chez Supabase est GLOBAL : il n'existe pas
/// « captcha pour le web seulement ». Dès qu'il est actif, tout client
/// qui n'envoie pas de jeton est refusé, y compris l'application déjà
/// installée sur les téléphones.
///
///   a. les trois portes envoient le jeton (ce chantier) ;
///   b. une version iPhone part sur TestFlight ET EST INSTALLÉE ;
///   c. ALORS SEULEMENT le réglage est activé chez Supabase.
///
/// C'est pourquoi ce fichier ne bloque JAMAIS rien de lui-même : quand
/// la clé de site n'est pas posée, ou quand le widget ne se charge pas,
/// l'appel part SANS jeton et c'est le serveur qui décide. Avant
/// l'activation il l'accepte ; après, il le refuse et l'écran l'explique
/// en français. Le client n'a pas le droit de fermer la porte tout seul.
///
/// ══════════════════════════════════════════════════════════════════
/// DEUX CLÉS, ET ELLES N'ONT PAS LE MÊME STATUT
/// ══════════════════════════════════════════════════════════════════
///
/// La clé de SITE est publique : elle vit dans le client, elle est
/// visible de tous, c'est son métier. Elle est ici.
/// La clé SECRÈTE va dans le tableau de bord Supabase, à la main, et ne
/// traverse ni ce dépôt, ni ce fichier, ni une conversation.
///
/// ══════════════════════════════════════════════════════════════════
/// TROIS SOURCES POUR LA CLÉ DE SITE, COMME POUR LE DOMAINE DES
/// ÉTIQUETTES
/// ══════════════════════════════════════════════════════════════════
///
///   1. UN RÉGLAGE ENREGISTRÉ (`UserDefaults`, clé
///      `turnstile.cledesite`). Aucun écran ne le pose — un paysagiste
///      n'a rien à régler ici. Il reste néanmoins atteignable par les
///      ARGUMENTS DE LANCEMENT (`-turnstile.cledesite 1x00…AA`) et par
///      un profil de gestion d'appareils. C'est le levier d'urgence :
///      il permet de basculer la clé, ou de la retirer, sans attendre
///      une à deux semaines de délai App Store. C'est aussi ce qui rend
///      possible l'essai à la main avec les clés d'essai de Cloudflare.
///   2. LE PAQUET (`Info.plist`, clé `OASIS_TURNSTILE_SITE_KEY`,
///      DÉCLARÉE dans `project.yml`). C'est la valeur de compilation.
///   3. RIEN. Et « rien » est une réponse valide, pas une panne : voir
///      plus haut, l'appel part alors sans jeton.
///
/// La leçon d'`OASIS_ETIQUETTES_DOMAINE` est reprise telle quelle : une
/// clé non déclarée dans `project.yml` est un levier de papier. Un test
/// vérifie ici que la déclaration existe.
enum TurnstileConfig {

    // MARK: - Les noms

    /// La clé lue dans `Info.plist`, déclarée dans `project.yml`.
    static let cleInfoPlistCleDeSite = "OASIS_TURNSTILE_SITE_KEY"

    /// L'origine annoncée à Cloudflare, déclarée au même endroit.
    static let cleInfoPlistOrigine = "OASIS_TURNSTILE_ORIGINE"

    /// Le réglage d'urgence, celui qui prime sur tout.
    static let cleReglageCleDeSite = "turnstile.cledesite"

    /// Le réglage d'urgence de l'origine.
    static let cleReglageOrigine = "turnstile.origine"

    /// Le nom du canal par lequel la page renvoie ses messages à Swift.
    static let nomDuCanal = "turnstile"

    // MARK: - L'origine

    /// L'ORIGINE, ET POURQUOI CE N'EST PAS UN DÉTAIL COSMÉTIQUE.
    ///
    /// Cloudflare vérifie le NOM D'HÔTE de la page qui porte le widget
    /// contre la liste de domaines attachée à la clé de site. Une page
    /// fabriquée en mémoire n'a d'origine crédible que si on lui en
    /// donne une : c'est le `baseURL` passé à `loadHTMLString`, et c'est
    /// exactement ce que fait le SDK iOS officiel de hCaptcha depuis des
    /// années.
    ///
    /// CE DOMAINE DOIT DONC FIGURER DANS LA LISTE DE LA CLÉ DE SITE,
    /// sans quoi le widget rendra une erreur `110200` et aucun jeton ne
    /// sortira jamais. C'est le premier point à vérifier si l'essai à la
    /// main échoue.
    static let origineParDefaut = "https://oasisrarecare.com"

    // MARK: - Les délais

    /// Ce qu'on attend d'un widget qui se débrouille tout seul.
    ///
    /// En mode « géré », la très grande majorité des jetons arrive en
    /// une à deux secondes sans que personne ne voie rien. Douze
    /// secondes laissent de la marge à un camion sur un réseau lent,
    /// tout en ne transformant pas un bouton en mur pour celui dont le
    /// réseau filtre Cloudflare.
    static let delaiSilencieux: TimeInterval = 12

    /// Ce qu'on laisse à quelqu'un qui doit RÉSOUDRE une énigme.
    ///
    /// Deux minutes : lire la consigne, désigner des images, se tromper
    /// une fois. Un délai court ici annulerait la tentative sous les
    /// doigts de la personne, ce qui est pire que pas de captcha du
    /// tout.
    static let delaiInteractif: TimeInterval = 120

    /// Après une panne franche du widget — le script n'est jamais
    /// arrivé —, on ne réinflige pas douze secondes d'attente au geste
    /// suivant. On rend la main tout de suite pendant une minute, puis
    /// on réessaie : un réseau revient, un bloqueur se désactive, et un
    /// abandon définitif enfermerait la personne dehors pour toute la
    /// durée de la session.
    static let reposApresPanne: TimeInterval = 60

    // MARK: - Les clés d'essai de Cloudflare

    /// LES CLÉS D'ESSAI, ET POURQUOI ELLES SONT NOMMÉES ICI.
    ///
    /// Cloudflare publie des clés qui acceptent tout, d'autres qui
    /// refusent tout, une qui force l'énigme. Elles servent à l'essai à
    /// la main, et elles sont indispensables : c'est le seul moyen de
    /// voir le chemin complet sans toucher à la production.
    ///
    /// ELLES NE DOIVENT JAMAIS PARTIR SUR L'APP STORE. Une clé de site
    /// d'essai appariée à une clé secrète de production produit un refus
    /// systématique — c'est-à-dire tout le parc dehors. Un test relit
    /// `project.yml` et refuse la livraison si l'une d'elles y figure.
    ///
    ///   1x00000000000000000000AA — visible, passe toujours
    ///   2x00000000000000000000AB — visible, échoue toujours
    ///   1x00000000000000000000BB — invisible, passe toujours
    ///   2x00000000000000000000BB — invisible, échoue toujours
    ///   3x00000000000000000000FF — force l'énigme interactive
    static let clesDEssai: Set<String> = [
        "1x00000000000000000000AA",
        "2x00000000000000000000AB",
        "1x00000000000000000000BB",
        "2x00000000000000000000BB",
        "3x00000000000000000000FF",
    ]

    static func estUneCleDEssai(_ cle: String) -> Bool {
        clesDEssai.contains(cle.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // MARK: - Ce que l'application lit vraiment

    /// La clé de site effective, ou `nil` si personne ne l'a posée.
    static var cleDeSite: String? {
        cleRetenue(
            reglage: UserDefaults.standard.string(forKey: cleReglageCleDeSite),
            paquet: Bundle.main.object(forInfoDictionaryKey: cleInfoPlistCleDeSite) as? String
        )
    }

    /// L'origine effective.
    static var origine: URL {
        origineRetenue(
            reglage: UserDefaults.standard.string(forKey: cleReglageOrigine),
            paquet: Bundle.main.object(forInfoDictionaryKey: cleInfoPlistOrigine) as? String
        )
    }

    // MARK: - Les mêmes décisions, en fonctions pures

    /// Les deux sources arrivent en paramètre : la décision se vérifie
    /// sans toucher aux réglages du téléphone ni au paquet, et sans
    /// charger quoi que ce soit. C'est la forme de
    /// `SmartTagConfig.domaineRetenu(reglage:paquet:)`, pour la même
    /// raison.
    ///
    /// UNE CHAÎNE VIDE VAUT « PAS DE CLÉ », et c'est voulu :
    /// `project.yml` déclare la clé vide tant que le dirigeant n'a pas
    /// créé le site chez Cloudflare, et une chaîne vide envoyée au
    /// widget produirait une erreur incompréhensible plutôt qu'un
    /// silence propre.
    static func cleRetenue(reglage: String?, paquet: String?) -> String? {
        if let propre = clePropre(reglage) { return propre }
        if let propre = clePropre(paquet) { return propre }
        return nil
    }

    static func origineRetenue(reglage: String?, paquet: String?) -> URL {
        if let url = originePropre(reglage) { return url }
        if let url = originePropre(paquet) { return url }
        // Le défaut est forcément valide : il est écrit deux lignes plus
        // haut. Le `!` est ici le seul endroit du fichier où l'on
        // accepte de s'arrêter, et il ne peut pas se déclencher.
        return URL(string: origineParDefaut)!
    }

    /// Rogne et refuse le vide. On ne met PAS en minuscules : une clé de
    /// site Cloudflare porte des majuscules (`0x4AAAA…`), et les
    /// abaisser la rendrait invalide sans le moindre message.
    private static func clePropre(_ brut: String?) -> String? {
        guard let brut else { return nil }
        let propre = brut.trimmingCharacters(in: .whitespacesAndNewlines)
        return propre.isEmpty ? nil : propre
    }

    /// Exige une adresse `https` avec un hôte. Le widget refuserait de
    /// toute façon une origine en `http`, et une origine bancale ne se
    /// verrait sur aucun écran — elle se verrait par une porte d'entrée
    /// qui refuse tout le monde, le jour de l'activation.
    private static func originePropre(_ brut: String?) -> URL? {
        guard let brut else { return nil }
        var propre = brut.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        while propre.hasSuffix("/") { propre.removeLast() }
        guard !propre.isEmpty, !propre.contains(" ") else { return nil }
        if !propre.hasPrefix("https://") { propre = "https://" + propre }
        guard let url = URL(string: propre),
              let hote = url.host,
              hote.contains("."),
              url.scheme == "https"
        else { return nil }
        return url
    }

    // MARK: - La page qui porte le widget

    /// LA PAGE, ÉCRITE ICI ET NON HÉBERGÉE — LA RAISON EST DANS LE
    /// COMPTE RENDU, LA VOICI EN COURT.
    ///
    /// Le widget Turnstile est une page web : il n'existe pas en natif.
    /// La voie retenue est une vue web réellement montée, minuscule tant
    /// que rien n'est demandé, qui rend cette page-ci et renvoie le
    /// jeton à Swift.
    ///
    /// La page n'est pas servie par notre serveur : elle est fabriquée
    /// ici et chargée avec un `baseURL` qui lui donne l'origine attendue
    /// par Cloudflare. Cela évite de coupler une version iPhone à un
    /// déploiement web — et donc d'ajouter une quatrième case à cocher à
    /// une séquence d'activation qui en compte déjà trois.
    ///
    /// LES QUATRE OPTIONS QUI COMPTENT, ET POURQUOI :
    ///
    ///   • `appearance: 'interaction-only'` — le widget reste INVISIBLE
    ///     tant qu'aucune interaction n'est nécessaire. C'est ce qui
    ///     permet au paysagiste de se connecter depuis son camion sans
    ///     rien voir, tout en gardant une issue quand Cloudflare exige
    ///     une énigme. Une clé en mode « invisible » n'aurait pas cette
    ///     issue : un visiteur jugé suspect serait refusé sans recours,
    ///     et il appellerait le support.
    ///   • `execution: 'execute'` — le défi ne démarre PAS au chargement
    ///     de la page, mais quand Swift le demande. Sans cela, la page
    ///     produirait un jeton à l'ouverture de l'écran, jeton déjà
    ///     vieux (ils valent 300 secondes) au moment où on s'en sert.
    ///   • `refresh-expired: 'never'` — aucun renouvellement dans notre
    ///     dos. Un jeton ne vaut qu'UN appel : on en redemande un neuf
    ///     avant chaque appel, et un widget qui en fabriquerait tout
    ///     seul brouillerait ce comptage.
    ///   • `before-interactive-callback` — le seul signal qui dise « je
    ///     vais devoir montrer quelque chose ». C'est lui qui fait
    ///     grandir la vue web ; sans lui, l'énigme s'afficherait dans un
    ///     carré d'un pixel et l'écran paraîtrait figé.
    ///
    /// La clé de site est ASSAINIE avant d'être posée dans le script.
    /// Elle vient d'un `Info.plist` ou d'un argument de lancement, donc
    /// d'une source qu'un binaire de recette peut modifier ; une
    /// apostrophe y refermerait la chaîne JavaScript.
    static func html(cleDeSite: String) -> String {
        let cle = cleAssainie(cleDeSite)
        return """
        <!doctype html>
        <html lang="fr">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          html, body { margin: 0; padding: 0; background: transparent; }
          #boite { display: flex; align-items: center; justify-content: center;
                   width: 100%; min-height: 100vh; }
        </style>
        </head>
        <body>
        <div id="boite"><div id="widget"></div></div>
        <script>
        function versSwift(charge) {
          try { window.webkit.messageHandlers.\(nomDuCanal).postMessage(charge); } catch (e) {}
        }
        var identifiant = null;
        window.onloadTurnstile = function () {
          try {
            identifiant = turnstile.render('#widget', {
              sitekey: '\(cle)',
              appearance: 'interaction-only',
              execution: 'execute',
              'refresh-expired': 'never',
              retry: 'auto',
              language: 'fr',
              callback: function (jeton) { versSwift({ type: 'jeton', valeur: jeton }); },
              'error-callback': function (code) {
                versSwift({ type: 'erreur', valeur: String(code || '') });
                return true;
              },
              'expired-callback': function () { versSwift({ type: 'expire' }); },
              'timeout-callback': function () { versSwift({ type: 'delai' }); },
              'before-interactive-callback': function () { versSwift({ type: 'interactif' }); },
              'after-interactive-callback': function () { versSwift({ type: 'discret' }); },
              'unsupported-callback': function () { versSwift({ type: 'nonsupporte' }); }
            });
            versSwift({ type: 'pret' });
          } catch (e) {
            versSwift({ type: 'erreur', valeur: 'rendu-impossible' });
          }
        };
        window.demanderUnJeton = function () {
          if (identifiant === null) { versSwift({ type: 'erreur', valeur: 'widget-absent' }); return; }
          try {
            turnstile.reset(identifiant);
            turnstile.execute(identifiant);
          } catch (e) {
            versSwift({ type: 'erreur', valeur: 'execution-impossible' });
          }
        };
        </script>
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstile&render=explicit" async defer></script>
        </body>
        </html>
        """
    }

    /// Une clé de site Cloudflare est faite de lettres, de chiffres, de
    /// tirets et de soulignés. Tout le reste tombe : c'est plus court à
    /// écrire qu'un échappement, et plus sûr à relire.
    static func cleAssainie(_ brut: String) -> String {
        String(brut.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    }
}

/// CE QUE LE PORTIER RAPPORTE, ET RIEN DE PLUS.
///
/// Trois cas, et volontairement pas de quatrième « refusé » : Turnstile
/// ne dit jamais au client « tu es un robot ». Il rend un jeton, ou il
/// rend une erreur qu'on ne sait pas distinguer d'une panne de réseau.
/// Inventer un « refusé » nous ferait fermer la porte à la place du
/// serveur, sur une supposition — exactement ce qu'on s'interdit.
enum ResultatTurnstile: Equatable, Sendable {

    /// Un jeton neuf, bon pour UN appel.
    case jeton(String)

    /// Aucune clé de site n'est posée. C'est l'état normal AVANT que le
    /// réglage Supabase soit activé, pas une panne.
    case nonConfigure

    /// Le widget n'a rien rendu : pas de réseau, filtrage d'entreprise,
    /// bloqueur, ou énigme laissée en plan.
    case indisponible

    /// Le jeton à joindre à l'appel — `nil` dès qu'on n'en a pas.
    ///
    /// C'est ici que se joue la règle la plus importante du chantier :
    /// PAS DE JETON N'EST PAS UN MOTIF DE REFUS CÔTÉ CLIENT. On appelle
    /// quand même, et c'est le serveur qui tranche.
    var jetonAJoindre: String? {
        if case .jeton(let valeur) = self { return valeur }
        return nil
    }
}
