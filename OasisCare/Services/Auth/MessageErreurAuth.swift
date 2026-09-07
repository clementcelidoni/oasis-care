import Foundation

/// Le geste en cours quand l'erreur est survenue. Il ne sert qu'à écrire
/// la phrase de repli : « nous n'avons pas pu ENVOYER le code » et
/// « nous n'avons pas pu VÉRIFIER ce code » n'appellent pas la même
/// réaction, et une phrase générique unique obligerait l'utilisateur à
/// deviner ce qui vient d'échouer.
enum GesteAuthentification {
    case envoiDuCode
    case verificationDuCode
    case connexionParMotDePasse
    case enregistrementDuMotDePasse
}

/// TRADUIRE HONNÊTEMENT CE QUE LE SERVEUR REFUSE.
///
/// ══════════════════════════════════════════════════════════════════
/// LA RÈGLE : AUCUNE PHRASE ANGLAISE NE DOIT ATTEINDRE L'ÉCRAN
/// ══════════════════════════════════════════════════════════════════
///
/// Les écrans affichaient `error.localizedDescription`, c'est-à-dire le
/// message brut de Supabase : « Token has expired or is invalid »,
/// « For security purposes, you can only request this after 60
/// seconds ». Pour la personne qui essaie simplement d'entrer dans son
/// logiciel, c'est une porte fermée sans explication.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI ON RECONNAÎT L'ERREUR PAR SON TEXTE, ET NON PAR SON TYPE
/// ══════════════════════════════════════════════════════════════════
///
/// Le SDK Supabase expose bien un type d'erreur avec des cas nommés,
/// mais la forme de ce type a CHANGÉ plusieurs fois à l'intérieur de la
/// même version majeure, et `project.yml` dépend du paquet « from
/// 2.0.0 » — c'est-à-dire de la dernière 2.x publiée le jour de la
/// résolution, pas d'une version figée. Filtrer sur les cas de cette
/// énumération, c'est accepter que la traduction cesse de compiler à la
/// prochaine mise à jour du paquet.
///
/// On lit donc l'indice textuel de l'erreur, et on y cherche DEUX
/// filets pour chaque cas :
///   • le code machine renvoyé par GoTrue (`otp_expired`,
///     `invalid_credentials`…), stable et documenté ;
///   • le message anglais correspondant, au cas où le code ne
///     transparaîtrait pas dans la description de l'erreur.
/// Il suffit qu'un des deux accroche.
///
/// ══════════════════════════════════════════════════════════════════
/// CE QU'ON NE PEUT PAS FAIRE, ET IL FAUT LE DIRE
/// ══════════════════════════════════════════════════════════════════
///
/// GoTrue ne distingue PAS « code faux » de « code périmé » : les deux
/// rendent `otp_expired`, avec un unique message « Token has expired or
/// is invalid ». Inventer deux phrases différentes reviendrait à en
/// deviner une. On en écrit donc UNE seule, qui couvre les deux causes,
/// et l'écran offre les deux gestes côte à côte : retaper, ou demander
/// un nouveau code.
enum MessageErreurAuth {

    /// Point d'entrée des écrans.
    static func texte(pour erreur: Error, geste: GesteAuthentification) -> String {
        // Le réseau d'abord : `URLError` vient de Foundation, sa forme
        // ne bougera pas, et « le serveur n'a jamais été joint » n'a
        // rien à voir avec « le serveur a refusé ».
        if let reseau = erreur as? URLError {
            switch reseau.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
                return "Pas de connexion Internet. Reconnectez-vous à un réseau, puis réessayez."
            case .timedOut, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
                return "Le serveur ne répond pas. Réessayez dans un instant."
            default:
                break
            }
        }
        return texte(indice: indice(de: erreur), geste: geste)
    }

    /// Tout ce qu'on peut lire d'une erreur sans rien savoir de son
    /// type : sa description technique (qui porte le code machine) et
    /// sa description destinée à l'utilisateur (qui porte le message du
    /// serveur). L'une des deux contient ce qu'on cherche.
    static func indice(de erreur: Error) -> String {
        (String(describing: erreur) + " " + erreur.localizedDescription).lowercased()
    }

    /// La traduction elle-même : une chaîne entre, une phrase française
    /// sort. Aucun réseau, aucun type du SDK — c'est ce qui la rend
    /// testable.
    ///
    /// L'ORDRE DES TESTS EST SIGNIFIANT. « Email link is invalid or has
    /// expired » contient « invalid » : si l'on cherchait les
    /// identifiants incorrects en premier, un code périmé s'afficherait
    /// comme un mot de passe erroné.
    static func texte(indice: String, geste: GesteAuthentification) -> String {
        func contient(_ aiguilles: [String]) -> Bool {
            aiguilles.contains { indice.contains($0) }
        }

        // ── Trop de courriels, ou trop vite ────────────────────────
        if contient(["over_email_send_rate_limit", "you can only request this after", "email rate limit exceeded"]) {
            return "Un code vient déjà d'être envoyé à cette adresse. Attendez une minute avant d'en demander un autre."
        }
        if contient(["over_request_rate_limit", "too many requests", "request rate limit reached"]) {
            return "Trop de tentatives en peu de temps. Patientez quelques minutes, puis réessayez."
        }

        // ── Le code refusé : une seule phrase pour deux causes ─────
        if contient(["otp_expired", "token has expired", "expired or is invalid", "invalid or has expired"]) {
            return "Ce code n'est pas accepté. Il est peut-être mal recopié, ou périmé — un code n'est valable qu'une heure. Réessayez, ou demandez-en un nouveau."
        }

        // ── Le compte, tel que le serveur le voit ──────────────────
        //
        // `email_not_confirmed` N'A PLUS DE PHRASE À LUI, ET C'EST
        // VOLONTAIRE. Il tombe plus bas, dans celle des identifiants
        // refusés.
        //
        // Il en avait une — « cette adresse n'a pas encore été
        // confirmée » — et elle était juste, utile, et de trop : elle
        // dit que le compte EXISTE. Les deux applications web fondent
        // ce cas dans une phrase unique pour exactement cette raison ;
        // les trois portes doivent se comporter pareil sur la règle
        // qu'on a posée comme non négociable, sans quoi l'écart se
        // recopie ailleurs.
        //
        // La portée réelle est étroite, disons-le : le serveur ne rend
        // ce refus qu'APRÈS avoir validé le mot de passe. Il faut donc
        // déjà le connaître pour le voir. Mais la phrase de repli mène
        // au même geste — « demandez un code » —, donc on ne perd rien
        // en la supprimant.
        if contient(["user_banned"]) {
            return "Ce compte est suspendu. Écrivez à bonjour@oasisrarecare.com."
        }
        if contient(["otp_disabled", "signup_disabled", "signups not allowed", "email logins are disabled"]) {
            return "La connexion par e-mail est momentanément indisponible. Essayez avec Apple ou Google, ou réessayez plus tard."
        }

        // ── Le mot de passe ────────────────────────────────────────
        // `same_password` avant `weak_password` : le message du serveur
        // pour « déjà le vôtre » parle lui aussi de mot de passe.
        if contient(["same_password", "should be different from the old password"]) {
            return "C'est déjà votre mot de passe actuel. Choisissez-en un autre, ou revenez en arrière."
        }
        if contient(["weak_password", "password should be at least", "password is known to be weak", "pwned"]) {
            return "Ce mot de passe est trop court, ou trop répandu pour être sûr. Choisissez une phrase plus longue, connue de vous seul."
        }
        if contient([
            "invalid_credentials", "invalid login credentials",
            // `email_not_confirmed` EST ICI, AVEC LES AUTRES, ET C'EST
            // TOUT L'INTÉRÊT. Lui donner sa propre phrase reviendrait à
            // dire « ce compte existe, il n'est simplement pas
            // confirmé ». La phrase commune n'est fausse dans aucun des
            // cas — elle ne dit pas ce qui cloche, elle dit ce qu'il
            // reste à faire — et le geste qu'elle nomme, demander un
            // code, débloque précisément une adresse non confirmée.
            "email_not_confirmed", "email not confirmed",
        ]) {
            // On ne dit surtout pas laquelle des deux valeurs est en
            // cause : le serveur lui-même ne le dit pas, et c'est ce
            // qui empêche d'apprendre, adresse après adresse, qui est
            // client. Le geste de secours est nommé dans la phrase.
            return "Adresse e-mail ou mot de passe incorrect. Si vous n'avez jamais choisi de mot de passe, demandez un code."
        }

        // ── L'adresse elle-même ────────────────────────────────────
        if contient(["email_address_invalid", "unable to validate email", "email_address_not_authorized", "validation_failed"]) {
            return "Cette adresse e-mail n'est pas valide. Vérifiez-la, puis réessayez."
        }

        // ── Rien de connu : on reste utile, et en français ─────────
        switch geste {
        case .envoiDuCode:
            return "Nous n'avons pas pu envoyer le code. Vérifiez votre adresse et votre connexion, puis réessayez."
        case .verificationDuCode:
            return "Nous n'avons pas pu vérifier ce code. Réessayez, ou demandez-en un nouveau."
        case .connexionParMotDePasse:
            return "La connexion n'a pas abouti. Réessayez dans un instant."
        case .enregistrementDuMotDePasse:
            return "Nous n'avons pas pu enregistrer ce mot de passe. Réessayez dans un instant."
        }
    }
}
