import SwiftUI
import UIKit

/// LA PORTE D'ENTRÉE PAR ADRESSE E-MAIL, SUR TÉLÉPHONE.
///
/// ══════════════════════════════════════════════════════════════════
/// CE QUI A CHANGÉ, ET POURQUOI CE N'EST PAS UN CONFORT
/// ══════════════════════════════════════════════════════════════════
///
/// Le produit n'avait aucun mot de passe : on recevait un lien, on
/// cliquait, on entrait. C'était agréable tant que le courrier partait.
///
/// Or tous les courriels du produit sortent d'UN SEUL domaine, partagé
/// par tous les paysagistes clients : la réputation d'envoi est
/// commune. Qu'un seul client se fasse signaler comme indésirable et la
/// délivrabilité tombe pour tout le parc — y compris pour les courriels
/// d'authentification, qui passent par le même domaine. Avec un lien
/// magique, une panne de courrier devient une panne d'ACCÈS : plus
/// personne n'entre, nulle part. Avec un mot de passe, une panne de
/// courrier reste une panne de courrier.
///
/// ══════════════════════════════════════════════════════════════════
/// LES TROIS ÉTAPES, ET POURQUOI IL N'Y A AUCUN AIGUILLAGE
/// ══════════════════════════════════════════════════════════════════
///
///   1. IDENTIFIANTS — adresse et mot de passe, les deux visibles
///      d'emblée, plus un lien permanent « je n'ai pas de mot de passe,
///      ou je l'ai oublié ».
///   2. CODE — huit chiffres reçus par courriel. Les saisir CONFIRME
///      l'adresse : une seule étape valide la boîte et ouvre le compte.
///   3. MOT DE PASSE — deux saisies, et c'est fini. Les fois suivantes,
///      l'étape 1 suffit.
///
/// L'écran ne cherche JAMAIS à savoir si l'adresse tapée existe, ni si
/// elle a déjà un mot de passe. Il ne le peut pas — aucune API cliente
/// ne le dit — et il ne le doit pas : une réponse, même indirecte,
/// donnerait à n'importe qui le moyen d'énumérer les clients. C'est le
/// lien permanent qui remplace l'aiguillage, et il rend l'écran
/// insensible à l'existence du compte par construction.
///
/// La seule question qu'on se permet — « faut-il proposer un mot de
/// passe ? » — n'est posée qu'APRÈS la vérification du code, quand la
/// personne a prouvé qu'elle possède la boîte.
///
/// ══════════════════════════════════════════════════════════════════
/// CE QUE LE TÉLÉPHONE FAIT MIEUX QUE LE WEB, ET DONT ON SE SERT
/// ══════════════════════════════════════════════════════════════════
///
///   • `.oneTimeCode` : iOS lit le code dans le courriel et le propose
///     au-dessus du clavier. Un code qu'on ne recopie pas est un code
///     qu'on ne recopie pas de travers.
///   • `.username` + `.password` sur l'étape 1, `.newPassword` sur
///     l'étape 3 : le trousseau propose d'enregistrer le mot de passe,
///     puis le ressort tout seul. Un mot de passe qu'on ne retape
///     jamais est un mot de passe qu'on peut faire long — c'est ce qui
///     rend tenable la règle « la longueur prime ».
///     RÉSERVE HONNÊTE : pour que le trousseau partage ce mot de passe
///     avec le site web et le propose de façon fiable, l'application
///     doit déclarer `webcredentials:oasisrarecare.com` en Associated
///     Domains — une clé de `project.yml`, hors du périmètre de ce
///     chantier. Sans elle, iOS enregistre quand même, mais rattaché à
///     l'application seule.
///
/// ══════════════════════════════════════════════════════════════════
/// LE SECRET NE VA NULLE PART
/// ══════════════════════════════════════════════════════════════════
///
/// Un mot de passe ne quitte cet écran que vers Supabase. Il n'est pas
/// journalisé, pas mis dans une URL, pas rangé dans les réglages de
/// l'appareil, pas répété dans un message d'erreur — et les
/// champs sont vidés dès l'appel réussi, pour qu'il ne traîne pas en
/// mémoire d'écran le temps que la feuille se ferme.
struct EmailSignInView: View {
    @Environment(\.dismiss) private var dismiss

    private enum Etape {
        case identifiants
        case code
        case motDePasse
    }

    private enum Champ: Hashable {
        case adresse
        case code
    }

    @State private var etape: Etape = .identifiants
    @State private var adresse = ""
    @State private var motDePasse = ""
    @State private var code = ""
    @State private var nouveauMotDePasse = ""
    @State private var confirmation = ""
    @State private var enCours = false
    @State private var message: String?
    @State private var renvoiPossibleA: Date = .distantPast
    @FocusState private var champActif: Champ?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    switch etape {
                    case .identifiants:
                        etapeIdentifiants
                    case .code:
                        etapeCode
                    case .motDePasse:
                        etapeMotDePasse
                    }

                    if let message {
                        Text(message)
                            .font(.callout)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("authErrorMessage")
                    }
                }
                .padding()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(titre)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    // À l'étape du mot de passe, la session est DÉJÀ
                    // ouverte : le code l'a établie. « Annuler »
                    // laisserait croire qu'on renonce à entrer, alors
                    // qu'on est déjà entré. On dit donc ce qui se passe
                    // vraiment — on remet le choix du mot de passe à
                    // plus tard.
                    Button(etape == .motDePasse ? "Plus tard" : "Annuler") { dismiss() }
                }
            }
        }
    }

    private var titre: String {
        switch etape {
        case .identifiants: return "Connexion"
        case .code: return "Votre code"
        case .motDePasse: return "Votre mot de passe"
        }
    }

    // MARK: - 1. Adresse et mot de passe

    private var etapeIdentifiants: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Entrez votre adresse e-mail et votre mot de passe.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            TextField("email@exemple.com", text: $adresse)
                // `.username` plutôt que `.emailAddress` : c'est ce qui
                // dit au trousseau que ce champ et le suivant forment
                // un COUPLE. Avec `.emailAddress`, iOS propose des
                // adresses, mais n'enregistre ni ne restitue le duo.
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .submitLabel(.next)
                .focused($champActif, equals: .adresse)
                .accessibilityIdentifier("emailField")

            ChampMotDePasse(
                titre: "Mot de passe",
                texte: $motDePasse,
                contenu: .password,
                identifiant: "passwordField"
            )

            Button {
                Task { await seConnecter() }
            } label: {
                libelle("Se connecter")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!AdresseCourriel.estPlausible(adresse) || motDePasse.isEmpty || enCours)
            .accessibilityIdentifier("signInButton")

            Divider().padding(.vertical, 4)

            // LE LIEN PERMANENT. Il est le cœur du dessin : c'est lui
            // qui dispense l'écran de deviner quoi que ce soit sur
            // l'adresse tapée. Il sert trois cas d'un coup — premier
            // compte, mot de passe jamais choisi, mot de passe oublié —
            // et personne n'a besoin de savoir dans lequel il se
            // trouve.
            VStack(alignment: .leading, spacing: 8) {
                Text("Vous n'avez pas encore de mot de passe, ou vous l'avez oublié ?")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button {
                    Task { await envoyerLeCode() }
                } label: {
                    libelle("Recevoir un code par e-mail")
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(!AdresseCourriel.estPlausible(adresse) || enCours)
                .accessibilityIdentifier("sendCodeButton")
            }
        }
    }

    // MARK: - 2. Le code reçu par courriel

    private var etapeCode: some View {
        VStack(alignment: .leading, spacing: 16) {
            // On nomme la SOURCE du code, et pas seulement le code.
            // C'est la seule chose qui, pour l'utilisateur, distingue
            // celui-ci d'un code d'application d'authentification.
            Text("Nous avons envoyé un code à \(AdresseCourriel.masquee(adresse)). Il est valable une heure.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text("Code à \(CodeCourriel.longueurAttendue) chiffres reçu par e-mail")
                .font(.caption)
                .foregroundStyle(.secondary)

            TextField("00000000", text: $code)
                .keyboardType(.numberPad)
                // Ce qui fait tout le confort sur iPhone : le code lu
                // dans le courriel est proposé au-dessus du clavier.
                .textContentType(.oneTimeCode)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.center)
                .font(.title2.monospacedDigit())
                .tracking(6)
                .focused($champActif, equals: .code)
                .accessibilityIdentifier("codeField")
                .onChange(of: code) { _, nouveau in
                    // On nettoie la saisie plutôt que de la refuser :
                    // beaucoup de gens collent le code avec une espace
                    // ou un retour à la ligne accroché.
                    let propre = CodeCourriel.nettoye(nouveau)
                    if propre != nouveau { code = propre }
                }

            Button {
                Task { await verifierLeCode() }
            } label: {
                libelle("Continuer")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!CodeCourriel.estComplet(code) || enCours)
            .accessibilityIdentifier("verifyCodeButton")

            // Le décompte est affiché, pas seulement subi : un bouton
            // grisé sans explication donne l'impression que l'écran est
            // cassé. `TimelineView` rafraîchit la seconde sans qu'on
            // ait à tenir un minuteur, donc sans rien à annuler quand
            // la feuille se ferme.
            TimelineView(.periodic(from: .now, by: 1)) { contexte in
                let restant = Int(renvoiPossibleA.timeIntervalSince(contexte.date).rounded(.up))
                Button(restant > 0 ? "Renvoyer le code (\(restant) s)" : "Renvoyer le code") {
                    Task { await envoyerLeCode() }
                }
                .font(.callout)
                .disabled(restant > 0 || enCours)
                .accessibilityIdentifier("resendCodeButton")
            }

            Button("Modifier l'adresse") {
                message = nil
                code = ""
                etape = .identifiants
                champActif = .adresse
            }
            .font(.callout)
            .accessibilityIdentifier("changeEmailButton")
        }
    }

    // MARK: - 3. Le mot de passe, choisi une bonne fois

    private var etapeMotDePasse: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Votre adresse est confirmée. Choisissez maintenant un mot de passe : c'est lui qui vous ouvrira Oasis Care les prochaines fois, sans passer par un e-mail.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            ChampMotDePasse(
                titre: "Nouveau mot de passe",
                texte: $nouveauMotDePasse,
                contenu: .newPassword,
                identifiant: "newPasswordField"
            )

            ChampMotDePasse(
                titre: "Répétez le mot de passe",
                texte: $confirmation,
                contenu: .newPassword,
                identifiant: "confirmPasswordField"
            )

            Text(RegleMotDePasse.conseil)
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                Task { await enregistrerLeMotDePasse() }
            } label: {
                libelle("Enregistrer et continuer")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(nouveauMotDePasse.isEmpty || confirmation.isEmpty || enCours)
            .accessibilityIdentifier("savePasswordButton")
        }
    }

    private func libelle(_ texte: String) -> some View {
        Group {
            if enCours {
                ProgressView()
            } else {
                Text(texte)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Les quatre gestes

    private func seConnecter() async {
        message = nil
        enCours = true
        defer { enCours = false }
        do {
            try await AuthService.signInWithPassword(
                email: AdresseCourriel.normalisee(adresse),
                password: motDePasse
            )
            // Vidé tout de suite : la feuille met un instant à se
            // fermer, et le secret n'a aucune raison de rester dans
            // l'état de l'écran pendant ce temps.
            motDePasse = ""
            dismiss()
        } catch {
            message = MessageErreurAuth.texte(pour: error, geste: .connexionParMotDePasse)
        }
    }

    private func envoyerLeCode() async {
        message = nil
        enCours = true
        defer { enCours = false }
        do {
            try await AuthService.sendEmailCode(to: AdresseCourriel.normalisee(adresse))
            code = ""
            etape = .code
            champActif = .code
            renvoiPossibleA = Date.now.addingTimeInterval(CodeCourriel.delaiEntreDeuxEnvois)
        } catch {
            message = MessageErreurAuth.texte(pour: error, geste: .envoiDuCode)
        }
    }

    private func verifierLeCode() async {
        message = nil
        enCours = true
        defer { enCours = false }
        do {
            let resultat = try await AuthService.verifyEmailCode(
                email: AdresseCourriel.normalisee(adresse),
                code: CodeCourriel.nettoye(code)
            )
            code = ""
            // À partir d'ici la session est ouverte. Reste à savoir si
            // l'on doit proposer un mot de passe : oui pour un compte
            // qui a une identité e-mail, jamais pour un compte qui
            // n'entre que par Apple ou par Google.
            if resultat.peutPoserUnMotDePasse {
                etape = .motDePasse
            } else {
                dismiss()
            }
        } catch {
            message = MessageErreurAuth.texte(pour: error, geste: .verificationDuCode)
        }
    }

    private func enregistrerLeMotDePasse() async {
        // Le contrôle local d'abord : inutile de faire un aller-retour
        // au serveur pour une faute de frappe entre les deux champs.
        // Ce n'est PAS un contrôle de sécurité — le serveur a le sien,
        // et il n'en voit qu'une des deux saisies.
        if let refus = RegleMotDePasse.refus(motDePasse: nouveauMotDePasse, confirmation: confirmation) {
            message = RegleMotDePasse.message(pour: refus)
            return
        }
        message = nil
        enCours = true
        defer { enCours = false }
        do {
            try await AuthService.setPassword(nouveauMotDePasse)
            nouveauMotDePasse = ""
            confirmation = ""
            dismiss()
        } catch {
            message = MessageErreurAuth.texte(pour: error, geste: .enregistrementDuMotDePasse)
        }
    }
}

/// Un champ masqué avec un œil pour relire ce qu'on tape.
///
/// Ce n'est pas une coquetterie : la règle du produit est « la longueur
/// prime », donc on encourage une phrase de douze caractères ou plus, et
/// une phrase longue tapée à l'aveugle sur un clavier de téléphone se
/// trompe une fois sur trois. Pouvoir relire évite le refus, et le refus
/// évité évite le mot de passe court choisi par lassitude.
///
/// La visibilité est locale à chaque champ et repart toujours de
/// « masqué » : rien n'est retenu d'une ouverture à l'autre.
private struct ChampMotDePasse: View {
    var titre: String
    @Binding var texte: String
    var contenu: UITextContentType
    var identifiant: String

    @State private var visible = false

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if visible {
                    TextField(titre, text: $texte)
                } else {
                    SecureField(titre, text: $texte)
                }
            }
            .textContentType(contenu)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityIdentifier(identifiant)

            Button {
                visible.toggle()
            } label: {
                Image(systemName: visible ? "eye.slash" : "eye")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(visible ? "Masquer le mot de passe" : "Afficher le mot de passe")
            .accessibilityIdentifier("\(identifiant)VisibilityToggle")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
    }
}
