import Foundation
import Supabase

/// Ce que la vérification d'un code apprend sur le compte, réduit à ce
/// dont l'écran a besoin.
///
/// On ne fait PAS remonter le `User` du SDK jusqu'à la vue : la vue n'a
/// qu'une question à poser — « faut-il proposer un mot de passe ? » — et
/// lui tendre l'objet entier l'inviterait à lire des champs qui ne la
/// regardent pas. C'est aussi ce qui rend la décision testable sans le
/// SDK (voir `IdentiteCompte`).
struct ResultatVerificationCode: Equatable, Sendable {

    /// Les fournisseurs d'identité du compte : `email`, `apple`,
    /// `google`, dans n'importe quelle combinaison — un même compte peut
    /// porter les trois.
    var fournisseurs: [String]

    /// Vrai seulement si le compte a une identité « e-mail ». Un compte
    /// purement Apple ou Google ne se voit JAMAIS réclamer un mot de
    /// passe : il n'en a pas besoin, et la porte n'existe pas.
    var peutPoserUnMotDePasse: Bool {
        IdentiteCompte.peutPoserUnMotDePasse(fournisseurs: fournisseurs)
    }
}

/// Single entry point for every Supabase Auth call — views never talk to
/// SupabaseClient directly (mirrors CareScheduleEngine's "one path in" shape
/// from earlier phases).
enum AuthService {
    static let client = SupabaseClient(supabaseURL: SupabaseConfig.url, supabaseKey: SupabaseConfig.publishableKey)

    // ══════════════════════════════════════════════════════════════
    // LE PARCOURS PAR ADRESSE : CODE, PUIS MOT DE PASSE
    // ══════════════════════════════════════════════════════════════
    //
    // Trois appels, dans cet ordre, et c'est tout le mécanisme :
    //
    //   sendEmailCode  → verifyEmailCode  → setPassword
    //   (le courriel)    (l'adresse est     (les fois suivantes,
    //                     par là même         signInWithPassword
    //                     CONFIRMÉE)          suffit)
    //
    // La même séquence sert à trois choses que l'on croirait
    // différentes : créer un compte, poser un premier mot de passe, et
    // en changer parce qu'on l'a oublié. Un seul mécanisme à écrire, un
    // seul à éprouver.

    /// Demande l'envoi du code à six-huit chiffres.
    ///
    /// `shouldCreateUser` n'est pas passé, donc il vaut `true` : sur le
    /// téléphone, S'INSCRIRE ET SE CONNECTER SONT LE MÊME GESTE, et
    /// c'est voulu. Une adresse inconnue crée donc un compte.
    ///
    /// CONSÉQUENCE À CONNAÎTRE, ET C'EST LE PIÈGE QUI A DÉJÀ COÛTÉ UNE
    /// SEMAINE : le gabarit de courriel employé par Supabase N'EST PAS
    /// LE MÊME selon que l'adresse existe déjà (« Magic Link ») ou non
    /// (« Confirm signup »). Le premier a été soigné et porte bien
    /// `{{ .Token }}` ; le second est resté celui d'origine, en anglais,
    /// avec un lien et AUCUN code. Un compte neuf reçoit donc
    /// aujourd'hui un courriel dans lequel il n'y a rien à recopier.
    /// C'est un réglage du tableau de bord, pas du code d'application —
    /// il est écrit dans la notice, et il doit être fait avant la mise
    /// en service.
    ///
    /// Aucun `redirectTo` : le lien de retour n'a pas de sens ici.
    /// L'application ne sait ouvrir que `com.oasisrarecare.app://…` pour
    /// les étiquettes, et aucune reprise de session par URL n'existe.
    /// Le code est le seul chemin, et c'est le chemin qui marche
    /// partout.
    ///
    /// LE JETON ANTI-ROBOT EST EXIGÉ ICI. Cet appel part sur
    /// `POST /otp`, l'une des routes que GoTrue enveloppe de sa
    /// vérification de captcha dès que le réglage est activé. C'est même
    /// la route la plus concernée des deux : c'est elle qui fait PARTIR
    /// UN COURRIEL, et donc elle qu'une machine emploierait pour arroser
    /// des inconnus depuis notre domaine.
    ///
    /// `nil` reste accepté, et c'est la clé de la mise en service :
    /// tant que le réglage est éteint, le serveur ne regarde même pas ce
    /// paramètre.
    static func sendEmailCode(to email: String, jetonCaptcha: String? = nil) async throws {
        try await client.auth.signInWithOTP(email: email, captchaToken: jetonCaptcha)
    }

    /// Vérifie le code. En cas de succès, la session est établie ET
    /// l'adresse est confirmée par la même occasion — c'est tout
    /// l'intérêt du parcours.
    ///
    /// `type: .email` couvre les DEUX cas : le code d'un compte existant
    /// et celui d'une confirmation d'inscription. Il n'y a donc pas à
    /// deviner, avant l'appel, si le compte existait — ce qui tombe
    /// bien, puisque le deviner serait précisément ce qu'on s'interdit.
    ///
    /// Ce que la réponse rapporte : `identities`, la seule source fiable
    /// pour savoir si ce compte a une identité e-mail. On la lit ici,
    /// une fois, et on n'en garde que la liste des fournisseurs.
    ///
    /// AUCUN JETON ANTI-ROBOT ICI, ET C'EST DÉLIBÉRÉ — ne pas
    /// « harmoniser ». L'interface Swift accepte bien un
    /// `captchaToken:` sur cet appel, mais il part sur `POST /verify`,
    /// qui n'est PAS enveloppé par la vérification de captcha de GoTrue.
    /// Un jeton posé là serait dépensé pour rien : comme il ne vaut
    /// qu'un seul appel, il serait volé au prochain appel qui, lui, en a
    /// réellement besoin — typiquement le renvoi de code juste après.
    static func verifyEmailCode(email: String, code: String) async throws -> ResultatVerificationCode {
        let reponse = try await client.auth.verifyOTP(email: email, token: code, type: .email)
        let fournisseurs = reponse.user.identities?.map(\.provider) ?? []
        return ResultatVerificationCode(fournisseurs: fournisseurs)
    }

    /// La connexion ordinaire, celle de tous les jours : adresse et mot
    /// de passe, aucun courriel.
    ///
    /// Le serveur ne distingue jamais « compte inexistant », « mauvais
    /// mot de passe » et « ce compte n'entre que par Google » : les
    /// trois rendent `invalid_credentials`. La non-divulgation n'est
    /// donc pas une précaution de notre part, elle est garantie par le
    /// serveur — et l'écran n'a rien à faire pour la préserver, sinon
    /// s'abstenir d'afficher trois messages différents.
    ///
    /// LE JETON ANTI-ROBOT EST EXIGÉ ICI. Cet appel part sur
    /// `POST /token?grant_type=password`, que GoTrue enveloppe de sa
    /// vérification de captcha — et il n'entre dans aucune des
    /// exemptions du serveur (les grants `pkce`, `refresh_token` et
    /// `id_token`, eux, en sont exemptés).
    ///
    /// C'est aussi la route par laquelle on devine qui est client en
    /// chronométrant : une adresse connue met environ deux fois plus de
    /// temps à répondre. L'écart est chez Supabase et ne se corrige pas
    /// d'ici — le captcha coupe le volume, et sans volume l'écart ne se
    /// moissonne plus.
    static func signInWithPassword(email: String, password: String, jetonCaptcha: String? = nil) async throws {
        _ = try await client.auth.signIn(email: email, password: password, captchaToken: jetonCaptcha)
    }

    /// Pose ou remplace le mot de passe du compte actuellement connecté.
    ///
    /// À N'APPELER QUE JUSTE APRÈS `verifyEmailCode`, sur une session
    /// fraîche : le projet n'exige ni ré-authentification ni mot de
    /// passe actuel (`security_update_password_require_reauthentication`
    /// et `..._require_current_password` sont à faux), la séquence passe
    /// donc d'un seul trait. Si l'un des deux réglages était activé un
    /// jour, cet appel réclamerait un `nonce` et échouerait ici — c'est
    /// écrit dans la notice.
    ///
    /// Le mot de passe ne fait que traverser : il n'est ni journalisé,
    /// ni conservé, ni renvoyé.
    ///
    /// AUCUN JETON ANTI-ROBOT ICI, et l'interface n'en propose même
    /// pas : cet appel part sur `PUT /user`, hors de la vérification de
    /// captcha de GoTrue.
    static func setPassword(_ password: String) async throws {
        _ = try await client.auth.update(user: UserAttributes(password: password))
    }

    // ══════════════════════════════════════════════════════════════
    // LES DEUX AUTRES PORTES, INCHANGÉES
    // ══════════════════════════════════════════════════════════════
    //
    // Sign in with Apple reste exactement ce qu'il était : ce n'est pas
    // un confort, c'est une exigence de l'App Store dès lors qu'une
    // autre connexion existe. Y toucher pour « harmoniser » ferait
    // refuser la prochaine version.
    //
    // NI L'UN NI L'AUTRE NE PORTE DE JETON ANTI-ROBOT, ET LE JOUR DE
    // L'ACTIVATION NE CHANGERA RIEN POUR EUX.
    //
    //   • Apple part sur `POST /token?grant_type=id_token`, que le
    //     serveur exempte explicitement de la vérification. L'interface
    //     Swift n'offre d'ailleurs aucun paramètre pour en poser un.
    //   • Google est une redirection vers un fournisseur
    //     (`GET /authorize`), pas un appel à notre serveur
    //     d'authentification. Il n'y a rien à protéger là, et rien à
    //     envoyer.
    //
    // Autrement dit : les deux portes qui n'envoient jamais de courriel
    // sont aussi les deux qui n'ont pas besoin de captcha. Ce n'est pas
    // une coïncidence.

    static func signInWithApple(idToken: String, nonce: String) async throws {
        try await client.auth.signInWithIdToken(
            credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce)
        )
    }

    /// Uses Supabase's OAuth flow (ASWebAuthenticationSession under the
    /// hood) rather than the native GoogleSignIn SDK — one fewer
    /// third-party dependency, and Supabase handles the OAuth exchange
    /// server-side. The redirect scheme must also be allow-listed in the
    /// Supabase dashboard under Authentication → URL Configuration.
    static func signInWithGoogle() async throws {
        try await client.auth.signInWithOAuth(
            provider: .google,
            redirectTo: URL(string: "com.oasisrarecare.app://")
        ) { _ in }
    }

    static func signOut() async throws {
        try await client.auth.signOut()
    }

    /// Calls the delete-account Edge Function — real, irreversible deletion
    /// (Storage photos, all workspace data, the auth user itself), never a
    /// soft deactivation. Deleting the auth user needs the service_role
    /// key, which must never be in this app, hence the server-side
    /// function; see supabase/functions/delete-account.
    static func deleteAccount() async throws {
        struct DeleteAccountResponse: Decodable {
            var success: Bool
        }
        let _: DeleteAccountResponse = try await client.functions.invoke("delete-account")
    }

    static var authStateChanges: AsyncStream<(event: AuthChangeEvent, session: Session?)> {
        get async {
            await client.auth.authStateChanges
        }
    }
}
