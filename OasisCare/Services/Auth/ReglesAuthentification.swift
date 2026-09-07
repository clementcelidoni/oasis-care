import Foundation

/// LES RÈGLES DU PARCOURS D'ENTRÉE, SÉPARÉES DES ÉCRANS QUI LES APPLIQUENT.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI UN FICHIER À PART
/// ══════════════════════════════════════════════════════════════════
///
/// Tout ce qui est ici est PUR : on entre une chaîne, on ressort une
/// réponse, sans réseau, sans horloge partagée, sans SwiftUI. C'est la
/// seule forme qui se teste vraiment — un test qui devrait appeler
/// Supabase pour vérifier « douze caractères minimum » n'existerait pas,
/// et la règle finirait dispersée dans trois écrans, écrite trois fois,
/// juste un peu différemment à chaque fois.
///
/// Les écrans, eux, ne décident de rien : ils appellent ces fonctions.
///
/// ══════════════════════════════════════════════════════════════════
/// CE QUI N'EST PAS ICI, ET NE DOIT PAS Y VENIR
/// ══════════════════════════════════════════════════════════════════
///
/// Aucun compteur de tentatives. Le serveur en tient un (limites
/// d'émission et de vérification côté Supabase, plus l'expiration du
/// jeton au bout d'une heure) ; un second compteur écrit ici serait
/// remis à zéro en fermant la feuille, donc inutile, tout en donnant
/// l'illusion d'une protection.
///
/// Et aucun mot de passe n'est conservé : ces fonctions le reçoivent, le
/// mesurent, et l'oublient. Rien n'est écrit sur le disque, ni dans
/// UserDefaults, ni dans un journal.
enum AdresseCourriel {

    /// La forme envoyée au serveur. On enlève les espaces collés par le
    /// copier-coller et on passe en minuscules : « Clement@Exemple.com »
    /// et « clement@exemple.com » sont le même compte, et quelqu'un qui
    /// tape son adresse avec une majuscule ne doit pas se retrouver
    /// devant un compte vide.
    ///
    /// On ne touche à RIEN d'autre. Pas de suppression des points, pas
    /// de retrait de ce qui suit un « + » : ce sont des adresses
    /// différentes pour certains serveurs de courriel, et les
    /// « normaliser » ferait échouer l'envoi sans que personne comprenne
    /// pourquoi.
    static func normalisee(_ saisie: String) -> String {
        saisie.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Un contrôle de PLAUSIBILITÉ, pas de validité. Il n'existe pas de
    /// test local qui dise si une adresse existe — seul l'envoi du code
    /// le dira. On se contente donc d'éviter le bouton actif sur une
    /// saisie manifestement inachevée, et on laisse passer tout le
    /// reste : les adresses valides bizarres sont plus nombreuses que
    /// les gens ne le croient.
    static func estPlausible(_ saisie: String) -> Bool {
        let adresse = normalisee(saisie)
        guard adresse.filter({ $0 == "@" }).count == 1 else { return false }
        guard !adresse.contains(" ") else { return false }
        guard let arobase = adresse.firstIndex(of: "@"), arobase != adresse.startIndex else { return false }
        let domaine = adresse[adresse.index(after: arobase)...]
        guard domaine.contains("."), !domaine.hasPrefix("."), !domaine.hasSuffix(".") else { return false }
        return true
    }

    /// Ce qu'on affiche à l'écran du code : « c••••@exemple.com ».
    ///
    /// L'utilisateur doit pouvoir reconnaître SON adresse — s'il s'est
    /// trompé de lettre, c'est ici qu'il le verra plutôt qu'en
    /// attendant un courriel qui n'arrivera jamais. Mais la feuille peut
    /// rester ouverte sur une table : on n'affiche pas l'adresse
    /// entière.
    static func masquee(_ saisie: String) -> String {
        let adresse = normalisee(saisie)
        guard
            let arobase = adresse.firstIndex(of: "@"),
            let premiere = adresse.first,
            arobase != adresse.startIndex
        else { return adresse }
        return "\(premiere)•••••\(adresse[arobase...])"
    }
}

/// LE CODE REÇU PAR COURRIEL — huit chiffres, une heure de validité.
///
/// ══════════════════════════════════════════════════════════════════
/// HUIT, ET PAS SIX : LA RAISON EST AILLEURS QUE DANS LA SÉCURITÉ
/// ══════════════════════════════════════════════════════════════════
///
/// Le projet Supabase est réglé sur `mailer_otp_length = 8`. Ce n'est
/// pas seulement cent millions de combinaisons au lieu d'un million :
/// c'est surtout ce qui distingue, À L'ŒIL, le code d'ENTRÉE (huit
/// chiffres, reçus par courriel, valables une heure) du code de SECOND
/// FACTEUR du Control Center (six chiffres, lus dans une application,
/// valables trente secondes). Deux champs de six chiffres dans le même
/// produit, et personne ne sait plus lequel est lequel.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI ON ACCEPTE QUAND MÊME SIX CHIFFRES
/// ══════════════════════════════════════════════════════════════════
///
/// La longueur du code est un RÉGLAGE de serveur, changeable en trois
/// clics par quelqu'un qui n'ouvrira jamais ce fichier. Si le bouton
/// « Continuer » n'acceptait que huit chiffres exactement, ce réglage
/// ramené à six enfermerait tout le monde dehors avec un bouton grisé
/// et aucune explication. On exige donc SIX chiffres pour activer le
/// bouton, on en accepte huit au maximum dans le champ, et c'est le
/// serveur qui tranche. Le libellé, lui, annonce huit : c'est ce que le
/// courriel contient aujourd'hui.
enum CodeCourriel {

    /// Ce que le courriel contient aujourd'hui, et ce que le champ
    /// laisse taper au maximum.
    static let longueurAttendue = 8

    /// En dessous, « Continuer » reste inactif — inutile d'aller
    /// déranger le serveur pour trois chiffres.
    static let longueurMinimaleAcceptee = 6

    /// Le serveur n'envoie qu'un courriel par minute et par adresse
    /// (`smtp_max_frequency = 60`). Le bouton « Renvoyer » attendait
    /// trente secondes : il redevenait donc cliquable une demi-minute
    /// AVANT que le serveur accepte, et l'utilisateur récoltait un
    /// refus en anglais pour avoir suivi ce que l'écran lui proposait.
    /// Un bouton qui n'est cliquable que quand ça marche vaut mieux
    /// qu'un message d'erreur bien traduit.
    static let delaiEntreDeuxEnvois: TimeInterval = 60

    /// Le champ n'accepte que des chiffres. Les gens collent le code
    /// depuis le courriel, avec parfois une espace ou un retour à la
    /// ligne accroché ; refuser la saisie serait absurde, la nettoyer
    /// est immédiat.
    ///
    /// `isASCII` en plus de `isNumber` : les chiffres arabes-indiens ou
    /// devanagari passeraient `isNumber` et seraient refusés par le
    /// serveur, ce qui donnerait un « code faux » incompréhensible.
    static func nettoye(_ saisie: String) -> String {
        String(saisie.filter { $0.isASCII && $0.isNumber }.prefix(longueurAttendue))
    }

    static func estComplet(_ saisie: String) -> Bool {
        nettoye(saisie).count >= longueurMinimaleAcceptee
    }
}

/// LA RÈGLE DU MOT DE PASSE : LA LONGUEUR, RIEN D'AUTRE.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI AUCUNE EXIGENCE DE COMPOSITION
/// ══════════════════════════════════════════════════════════════════
///
/// Réclamer une majuscule, un chiffre et un symbole produit
/// « Paysage1! » : neuf caractères, prévisible, et recopié sur un
/// carnet. « le figuier du balcon nord » en fait vingt-six, se retient,
/// et ne se devine pas. On fixe donc un plancher généreux et on
/// n'interdit rien — ni espaces, ni accents, ni émojis.
///
/// Aucune expiration non plus : faire changer le mot de passe tous les
/// trois mois produit « Paysage1! » puis « Paysage2! ». Les organismes
/// qui recommandaient cette pratique l'ont abandonnée.
///
/// La seule vérification qui protège vraiment est celle des mots de
/// passe déjà éventés, et elle ne peut pas s'écrire ici : c'est une
/// case à cocher côté Supabase (`password_hibp_enabled`). Quand elle
/// est active, le serveur refuse avec `weak_password` et
/// `MessageErreurAuth` le traduit.
enum RegleMotDePasse {

    /// Douze caractères. Le serveur, lui, n'en exige que six
    /// (`password_min_length = 6`) : ce plancher-ci est plus haut à
    /// dessein, et c'est celui que l'utilisateur voit.
    static let longueurMinimale = 12

    enum Refus: Equatable {
        case tropCourt
        case saisiesDifferentes
    }

    /// L'ordre compte : on signale d'abord la longueur, sinon quelqu'un
    /// qui tape deux fois un mot de passe trop court se voit reprocher
    /// une différence entre deux champs identiques.
    ///
    /// LA COMPARAISON DES DEUX SAISIES N'EST PAS UN CONTRÔLE DE
    /// SÉCURITÉ : c'est un garde-fou contre la faute de frappe, puisque
    /// les caractères sont masqués. Le serveur n'en reçoit qu'une.
    static func refus(motDePasse: String, confirmation: String) -> Refus? {
        // `count` compte les caractères tels que l'utilisateur les voit
        // (un émoji vaut un), pas les octets. C'est le seul décompte
        // qu'on puisse lui expliquer.
        if motDePasse.count < longueurMinimale { return .tropCourt }
        if motDePasse != confirmation { return .saisiesDifferentes }
        return nil
    }

    static func message(pour refus: Refus) -> String {
        switch refus {
        case .tropCourt:
            return "Votre mot de passe doit faire au moins \(longueurMinimale) caractères."
        case .saisiesDifferentes:
            return "Les deux mots de passe ne sont pas identiques."
        }
    }

    /// Affiché sous les champs, en permanence : une consigne qu'on lit
    /// avant de se tromper vaut mieux qu'un reproche après.
    static let conseil = "Au moins \(longueurMinimale) caractères. Une phrase que vous êtes seul à connaître vaut mieux qu'un mot compliqué : « le figuier du balcon nord »."
}

/// À QUI L'ON PROPOSE UN MOT DE PASSE, ET À QUI L'ON N'EN PARLE JAMAIS.
///
/// ══════════════════════════════════════════════════════════════════
/// DEUX POPULATIONS, DEUX PARCOURS
/// ══════════════════════════════════════════════════════════════════
///
/// Qui entre par Apple ou par Google n'a pas de mot de passe, et n'a
/// aucune raison d'en avoir un : lui en réclamer un — à l'entrée, plus
/// tard, ou dans les réglages — serait une porte qui n'existe pas.
/// Qui crée un compte avec son adresse passe, lui, par le parcours
/// complet.
///
/// LA SEULE SOURCE FIABLE EST `user.identities`. On pourrait croire que
/// `encrypted_password is null` répond à la question : c'est FAUX sur
/// ce projet. Trois des quatre comptes existants portent une empreinte
/// bcrypt alors qu'aucun mot de passe utilisable n'existe — le serveur
/// en fabrique une au hasard quand il crée un compte par code. Le
/// fournisseur d'identité, lui, ne ment pas.
///
/// ══════════════════════════════════════════════════════════════════
/// LE MOMENT OÙ L'ON A LE DROIT DE POSER LA QUESTION
/// ══════════════════════════════════════════════════════════════════
///
/// APRÈS la vérification du code, jamais avant. Avant, on n'a qu'une
/// adresse tapée par un inconnu, et toute réponse dirait à cet inconnu
/// si l'adresse est cliente. Après, la personne vient de prouver
/// qu'elle possède la boîte : lui décrire son propre compte ne révèle
/// rien à personne d'autre.
enum IdentiteCompte {

    static let fournisseurCourriel = "email"

    static func peutPoserUnMotDePasse(fournisseurs: [String]) -> Bool {
        fournisseurs.contains { $0.lowercased() == fournisseurCourriel }
    }
}
