import Foundation

/// §15 — L'ADRESSE D'UNE ÉTIQUETTE, ET COMMENT ELLE SE RELIT.
///
/// ══════════════════════════════════════════════════════════════════
/// CE QUI ÉTAIT CASSÉ, ET POURQUOI C'ÉTAIT GRAVE
/// ══════════════════════════════════════════════════════════════════
///
/// Ce fichier portait `domain = "oasis-care.example"`. Le domaine de
/// premier niveau `.example` est RÉSERVÉ par la RFC 2606 : il ne résout
/// pas, il ne résoudra jamais, aucun enregistrement n'est possible.
/// Toute étiquette déjà collée sur une plante était donc morte pour la
/// caméra d'un téléphone : scanner ne menait nulle part.
///
/// CE QUI SAUVE LES CINQ ÉTIQUETTES DÉJÀ ÉMISES : `token(from:)` NE
/// VÉRIFIE PAS L'HÔTE, et ce n'était pas un hasard. Il regarde le
/// schéma et le premier segment du chemin, sans jamais interroger le
/// DNS. Les autocollants qui portent `https://oasis-care.example/p/…`
/// restent donc parfaitement scannables DEPUIS L'APPLICATION, quel que
/// soit le domaine futur. Ce qui est mort pour eux, c'est le scan par
/// l'appareil photo du système ou par un téléphone sans Oasis Care.
/// Cette propriété se conserve : ne jamais ajouter de contrôle d'hôte
/// ici sans décoller les autocollants d'abord.
///
/// ══════════════════════════════════════════════════════════════════
/// L'ADRESSE N'EST PLUS CODÉE EN DUR — TROIS SOURCES, DANS CET ORDRE
/// ══════════════════════════════════════════════════════════════════
///
///   1. UN RÉGLAGE ENREGISTRÉ (`UserDefaults`, clé
///      `etiquettes.domaine`). AUCUN ÉCRAN NE LE POSE, et c'est
///      volontaire — un paysagiste n'a aucune raison de choisir un nom
///      de domaine, et lui en offrir le choix serait lui offrir de
///      casser ses propres étiquettes. Il reste néanmoins ATTEIGNABLE
///      sans recompiler, parce que `UserDefaults.standard` lit aussi le
///      domaine des ARGUMENTS DE LANCEMENT (`-etiquettes.domaine
///      exemple.fr`) et les préférences poussées par un profil de
///      gestion d'appareils. C'est le levier d'urgence : il évite une
///      à deux semaines de délai App Store le jour où le domaine doit
///      basculer avec des étiquettes déjà collées.
///   2. LE PAQUET (`Info.plist`, clé `OASIS_ETIQUETTES_DOMAINE`,
///      déclarée dans `project.yml`). C'est la configuration de
///      compilation, celle qui distingue un binaire de recette d'un
///      binaire de production.
///   3. LE DÉFAUT ci-dessous, quand ni l'un ni l'autre n'a été posé.
///
/// LES DEUX MOITIÉS DU PRODUIT DOIVENT DIRE LA MÊME CHOSE. Le web
/// imprime les planches depuis `OASIS_ETIQUETTES_BASE_URL` ; le
/// téléphone écrit les puces NFC depuis ce qui suit. Un désaccord entre
/// les deux ne se verrait sur aucun écran — il se verrait sur un
/// autocollant, des mois plus tard.
///
/// LE DÉFAUT EST UNE DÉCISION PRISE : `oasisrarecare.com`.
///
/// Le `.fr` avait été proposé pour son caractère de moins. Le calcul a
/// montré que l'argument ne tenait pas : 27 + 32 caractères contre
/// 28 + 32, les deux tombent dans la MÊME version de QR (la 4, capacité
/// 62 en mode octet). Le seul cas où le domaine bascule quelque chose
/// suppose un jeton de 11 caractères ET l'adresse écrite en majuscules —
/// le mode compact du QR n'accepte pas les minuscules —, ce que le
/// générateur d'Apple employé ici ne sait de toute façon pas faire.
/// C'est la longueur du JETON qui décide de la lisibilité, jamais celle
/// du domaine.
///
/// Le dirigeant a donc tranché pour le `.com`, celui qui porte déjà
/// l'authentification du courrier : une seule zone DNS à surveiller
/// plutôt que deux.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI CHANGER L'ADRESSE NE COÛTE RIEN
/// ══════════════════════════════════════════════════════════════════
///
/// L'URL d'une étiquette est CALCULÉE à partir du jeton, jamais
/// stockée. Le jeton, lui, est opaque et résolu par le serveur. Le jour
/// où le domaine change, il n'y a rien à réimprimer : il suffit que
/// l'ancien continue d'être servi, ou que les porteurs scannent avec
/// l'application, qui ne regarde pas l'hôte.
enum SmartTagConfig {
    /// Le domaine proposé, employé quand rien n'a été réglé.
    static let domaineParDefaut = "oasisrarecare.com"

    /// La clé du réglage enregistré, celle qui prime sur tout.
    static let cleReglageDomaine = "etiquettes.domaine"

    /// La clé lue dans `Info.plist`, DÉCLARÉE dans `project.yml`.
    ///
    /// Elle ne l'était pas, et c'était un levier de papier : l'en-tête
    /// promettait une bascule de domaine sans passer par l'App Store
    /// alors que seul le défaut ci-dessus s'appliquait. Elle porte
    /// aujourd'hui la même valeur que ce défaut — ce qui n'est pas une
    /// redondance : c'est le seul endroit où un binaire de recette
    /// change d'adresse sans qu'on touche à une ligne de code.
    static let cleInfoPlistDomaine = "OASIS_ETIQUETTES_DOMAINE"

    /// Le chemin employé pour ÉCRIRE une adresse neuve.
    ///
    /// `/x/` est celui du § 15 (« oasisrare.app/x/AB98K4 ») et celui de
    /// la route web qui résout les jetons. Un caractère de chemin est un
    /// caractère de plus dans le QR : c'est pour cela qu'il n'en fait
    /// qu'un.
    static let cheminActuel = "x"

    /// Les chemins acceptés pour LIRE.
    ///
    /// `/p/` est l'ancien, celui des cinq étiquettes de production. Il
    /// reste accepté pour toujours : un autocollant sur un arbre y reste
    /// dix ans, et il n'y a aucun coût à continuer de le comprendre.
    static let cheminsAcceptes: Set<String> = ["x", "p"]

    /// Le domaine effectif, tel que l'application le calcule.
    static var domaine: String {
        domaineRetenu(
            reglage: UserDefaults.standard.string(forKey: cleReglageDomaine),
            paquet: Bundle.main.object(forInfoDictionaryKey: cleInfoPlistDomaine) as? String
        )
    }

    /// La même décision, en fonction pure : les deux sources arrivent en
    /// paramètre, ce qui la rend vérifiable sans toucher aux réglages du
    /// téléphone ni au paquet.
    static func domaineRetenu(reglage: String?, paquet: String?) -> String {
        if let propre = domainePropre(reglage) { return propre }
        if let propre = domainePropre(paquet) { return propre }
        return domaineParDefaut
    }

    /// Enregistre un domaine, ou l'efface en passant `nil`.
    ///
    /// Volontairement sans écran pour l'appeler : c'est un levier
    /// d'exploitation, pas un réglage d'utilisateur. Un paysagiste n'a
    /// aucune raison de choisir un nom de domaine, et lui en offrir le
    /// choix serait lui offrir de casser ses propres étiquettes.
    ///
    /// Elle n'est donc appelée que par les tests et par une console de
    /// débogage. Le chemin d'exploitation réel passe par les arguments
    /// de lancement ou par un profil de gestion, qui écrivent la même
    /// clé sans qu'aucun code n'ait à s'exécuter — voir l'en-tête.
    static func reglerDomaine(_ domaine: String?, dans reglages: UserDefaults = .standard) {
        guard let propre = domainePropre(domaine) else {
            reglages.removeObject(forKey: cleReglageDomaine)
            return
        }
        reglages.set(propre, forKey: cleReglageDomaine)
    }

    static func url(forToken token: String) -> String {
        "https://\(domaine)/\(cheminActuel)/\(token)"
    }

    /// LES DEUX FORMES ACCEPTÉES, ET LEUR ANALYSE.
    ///
    /// `https://<hôte>/<x|p>/<jeton>` — L'HÔTE N'EST PAS VÉRIFIÉ, et
    /// c'est ce qui garde scannables les étiquettes déjà collées (voir
    /// l'en-tête). Seul le premier segment du chemin compte.
    ///
    /// `com.oasisrarecare.app://<x|p>/<jeton>` — le schéma personnalisé
    /// déjà enregistré dans `project.yml`, qui ne demande aucun
    /// entitlement. Là, le `x` ou le `p` s'analyse comme l'HÔTE, puisque
    /// rien ne le précède.
    ///
    /// CE QUE CETTE FONCTION NE FAIT PAS : juger de la forme du jeton.
    /// Un jeton mal formé ne se distingue pas ici d'un jeton inconnu, et
    /// c'est `jetonPlausible(_:)` — appelé juste avant de déranger le
    /// réseau — qui s'en charge.
    static func token(from url: URL) -> String? {
        let segments = url.pathComponents.filter { $0 != "/" }

        if url.scheme == "https" || url.scheme == "http" {
            guard segments.count >= 2, cheminsAcceptes.contains(segments[0]) else { return nil }
            return jetonPropre(segments[1])
        }

        guard let hote = url.host, cheminsAcceptes.contains(hote) else { return nil }
        return jetonPropre(segments.first)
    }

    /// LA FORME DU JETON, LA MÊME QU'EN BASE ET QUE SUR LE WEB.
    ///
    /// 16 octets en hexadécimal, soit 32 caractères minuscules : c'est
    /// la forme des cinq étiquettes de production (un UUID sans tirets),
    /// celle du défaut posé en base par 0090, et celle du registre de
    /// pépinière absorbé au même endroit. Un seul alphabet, une seule
    /// longueur.
    ///
    /// ELLE SERT À NE PAS DÉRANGER LE RÉSEAU pour un QR qui n'est
    /// visiblement pas le nôtre. Elle ne remplace AUCUN contrôle du
    /// serveur : c'est lui qui décide, toujours.
    static func jetonPlausible(_ jeton: String) -> Bool {
        guard jeton.count == 32 else { return false }
        // Explicitement ASCII, et surtout pas `isHexDigit` : cette
        // propriété de Foundation accepte aussi les chiffres
        // arabo-indiens et leurs cousins. Trente-deux d'entre eux
        // passeraient ce contrôle pour se faire refuser par la base —
        // un aller-retour offert à qui aurait envie d'en fabriquer.
        return jeton.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }

    /// Rogne, met en minuscules, et refuse ce qui n'est manifestement
    /// pas un jeton. Un jeton recopié à la main depuis un autocollant
    /// abîmé porte souvent un espace de trop.
    private static func jetonPropre(_ brut: String?) -> String? {
        guard let brut else { return nil }
        let propre = brut.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return propre.isEmpty ? nil : propre
    }

    /// Accepte qu'on ait saisi « https://oasisrarecare.fr/ » là où on
    /// n'attendait qu'un hôte : le réglage sera posé un jour à la main,
    /// dans l'urgence, et refuser une barre oblique de trop coûterait
    /// une soirée à quelqu'un. Refuse en revanche tout ce qui porte
    /// encore un chemin, un espace ou rien du tout — un domaine
    /// approximatif fabriquerait des adresses approximatives, et elles
    /// partiraient à l'impression.
    private static func domainePropre(_ brut: String?) -> String? {
        guard let brut else { return nil }
        var propre = brut.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for prefixe in ["https://", "http://"] where propre.hasPrefix(prefixe) {
            propre.removeFirst(prefixe.count)
        }
        while propre.hasSuffix("/") { propre.removeLast() }
        guard !propre.isEmpty,
              !propre.contains("/"),
              !propre.contains(" ")
        else { return nil }
        // UN POINT EST EXIGÉ. Sans lui, « oasisrarecare » — le domaine
        // saisi sans son extension — passerait, et toute une planche
        // d'étiquettes sortirait avec une adresse qui ne résout nulle
        // part. Un domaine de recette en a un lui aussi
        // (« recette.oasisrarecare.fr ») : rien d'utile n'est perdu, et
        // « localhost » est délibérément exclu, puisque `url(forToken:)`
        // écrit toujours « https:// » et qu'une adresse locale en
        // « https » ne mènerait nulle part.
        guard propre.contains(".") else { return nil }
        return propre
    }
}
