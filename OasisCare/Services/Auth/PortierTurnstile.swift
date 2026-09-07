import Foundation
import UIKit
import WebKit

/// LE PORTIER : IL VA CHERCHER UN JETON, ET IL REND TOUJOURS LA MAIN.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI UNE VUE WEB, ET POURQUOI ELLE EST VRAIMENT MONTÉE
/// ══════════════════════════════════════════════════════════════════
///
/// Le widget Cloudflare est une page web ; il n'existe pas en natif, et
/// aucun contournement honnête n'existe. On rend donc la page dans un
/// `WKWebView`, minuscule tant qu'aucune énigme n'est demandée.
///
/// « Minuscule », pas « détachée » : une vue web hors de la hiérarchie
/// voit ses minuteurs ralentis par WebKit, et le widget se charge en
/// différé. Un pixel dans la pile de vues fonctionne ; une vue orpheline
/// gardée dans une variable ne fonctionne pas de façon fiable. C'est
/// pour cela que `VueTurnstile` la pose dans la mise en page de l'écran
/// de connexion, à un pixel sur un pixel, plutôt que de la garder ici.
///
/// ══════════════════════════════════════════════════════════════════
/// LE JETON EST À USAGE UNIQUE, ET LE COMPTAGE SE FAIT SUR L'APPEL
/// ══════════════════════════════════════════════════════════════════
///
/// Un jeton Turnstile vaut UN appel, et cinq minutes. Ici, aucun jeton
/// n'est conservé : `jetonNeuf()` réinitialise le widget puis le relance
/// à chaque fois, et le jeton part directement dans l'appel qui l'a
/// demandé. Il n'y a donc rien à invalider, rien à faire vieillir, et
/// rien à « oublier de réinitialiser » — l'erreur classique qui produit
/// un deuxième appel refusé et un utilisateur qui ne comprend pas.
///
/// Sur cet écran, DEUX appels partagent la même page sans qu'elle soit
/// rechargée : « Se connecter » et « Recevoir un code », et le second
/// suit très souvent le premier quand le mot de passe a été mal tapé.
/// Chacun repasse par ici, donc chacun a son jeton.
///
/// ══════════════════════════════════════════════════════════════════
/// LE PORTIER NE FERME JAMAIS LA PORTE
/// ══════════════════════════════════════════════════════════════════
///
/// Toutes les issues rendent la main : un jeton, ou l'aveu qu'il n'y en
/// aura pas. Aucune ne laisse l'appelant suspendu, et aucune ne décide
/// d'annuler l'appel. Le serveur seul refuse — avant l'activation du
/// réglage Supabase il acceptera un appel sans jeton, après il le
/// refusera, et `MessageErreurAuth` traduit ce refus en français.
///
/// C'est ce qui rend la version iPhone livrable AVANT l'activation :
/// elle se comporte exactement comme aujourd'hui tant que le réglage est
/// éteint, y compris si la clé de site n'est pas encore posée.
///
/// ══════════════════════════════════════════════════════════════════
/// RIEN N'EST JOURNALISÉ, RIEN N'EST CONSERVÉ
/// ══════════════════════════════════════════════════════════════════
///
/// Aucun `print`, aucun jeton rangé quelque part, aucune adresse ne
/// traverse ce fichier — le portier ne sait même pas qui se connecte.
@MainActor
final class PortierTurnstile: NSObject, ObservableObject {

    /// Vrai quand Cloudflare a annoncé qu'il allait devoir montrer
    /// quelque chose. C'est le seul état que l'écran observe, et c'est
    /// lui qui fait grandir la vue web.
    @Published private(set) var enigmeAffichee = false

    private let cleDeSite: String?
    private let origine: URL
    private let delaiSilencieux: TimeInterval
    private let delaiInteractif: TimeInterval
    private let reposApresPanne: TimeInterval

    /// Où en est la page. Trois états, et il en faut trois : sans
    /// distinguer « pas encore chargée » de « en train de charger », on
    /// relancerait un chargement par-dessus celui qui est en cours au
    /// premier clic — le moment précis où l'on veut aller vite.
    private enum EtatPage {
        case vierge
        case enCours
        case prete
    }

    private var vueWeb: WKWebView?
    private var etatPage: EtatPage = .vierge
    private var attente: CheckedContinuation<ResultatTurnstile, Never>?
    private var garde: Task<Void, Never>?

    /// Après une panne franche, on rend la main tout de suite jusqu'à
    /// cette date plutôt que de réinfliger le délai d'attente. Cette
    /// mémoire vit en mémoire d'écran et disparaît avec lui : rien n'est
    /// écrit sur le disque, et un abandon n'est jamais définitif.
    private var reposJusqua: Date = .distantPast

    init(
        cleDeSite: String? = TurnstileConfig.cleDeSite,
        origine: URL = TurnstileConfig.origine,
        delaiSilencieux: TimeInterval = TurnstileConfig.delaiSilencieux,
        delaiInteractif: TimeInterval = TurnstileConfig.delaiInteractif,
        reposApresPanne: TimeInterval = TurnstileConfig.reposApresPanne
    ) {
        self.cleDeSite = cleDeSite
        self.origine = origine
        self.delaiSilencieux = delaiSilencieux
        self.delaiInteractif = delaiInteractif
        self.reposApresPanne = reposApresPanne
        super.init()
    }

    /// Vrai quand une clé de site est posée. L'écran s'en sert pour ne
    /// pas monter une vue web qui n'aurait rien à faire.
    var actif: Bool { cleDeSite != nil }

    // MARK: - Ce que l'écran demande

    /// UN JETON NEUF, OU L'AVEU QU'IL N'Y EN AURA PAS. Ne lève jamais,
    /// n'attend jamais indéfiniment.
    ///
    /// À appeler JUSTE AVANT l'appel protégé, et pour cet appel-là
    /// seulement. Deux appels protégés, deux passages ici.
    func jetonNeuf() async -> ResultatTurnstile {
        guard cleDeSite != nil else { return .nonConfigure }

        // Une panne récente : on ne refait pas attendre. Le repos expire
        // tout seul, un réseau revient, un bloqueur se désactive.
        if Date.now < reposJusqua { return .indisponible }

        // Deux demandes en même temps ne peuvent pas arriver — les
        // boutons sont désactivés pendant l'appel — mais si cela
        // arrivait, la seconde ne doit pas voler la réponse de la
        // première ni rester suspendue.
        if attente != nil { return .indisponible }

        // La page a pu être abandonnée après une panne. On la remonte
        // ici plutôt qu'au moment de la panne : recharger tout de suite
        // après un échec, sur un téléphone hors couverture, ferait une
        // boucle de rechargement dont personne ne verrait rien sinon la
        // batterie.
        if etatPage == .vierge { charger() }

        return await withCheckedContinuation { (suite: CheckedContinuation<ResultatTurnstile, Never>) in
            attente = suite
            armerLaGarde(delaiSilencieux)
            lancerLaDemande()
        }
    }

    /// À appeler quand l'écran disparaît : une demande en cours doit
    /// rendre la main, sinon la tâche qui l'attend ne se termine jamais.
    func abandonner() {
        guard attente != nil else { return }
        terminer(.indisponible)
    }

    // MARK: - La vue web, fabriquée une fois

    /// Rend la vue web, en la créant au premier appel et en lançant tout
    /// de suite le chargement de la page.
    ///
    /// LE CHARGEMENT EST ANTICIPÉ, ET C'EST TOUT L'INTÉRÊT : quand la
    /// personne tape son mot de passe, la page est déjà là et le jeton
    /// arrive en une seconde. Attendre le premier clic pour charger
    /// ajouterait le temps du réseau au temps du défi.
    func vue() -> WKWebView {
        if let vueWeb { return vueWeb }

        let configuration = WKWebViewConfiguration()
        // Le relais tient le portier FAIBLEMENT : le gestionnaire de
        // messages est retenu fortement par WebKit, et se désigner
        // soi-même ferait un cycle que rien ne casserait.
        configuration.userContentController.add(
            RelaisTurnstile(cible: self),
            name: TurnstileConfig.nomDuCanal
        )

        let vue = WKWebView(frame: CGRect(x: 0, y: 0, width: 320, height: 320), configuration: configuration)
        vue.isOpaque = false
        vue.backgroundColor = .clear
        vue.scrollView.backgroundColor = .clear
        vue.scrollView.isScrollEnabled = false
        vue.navigationDelegate = self
        vueWeb = vue
        charger()
        return vue
    }

    private func charger() {
        guard let cleDeSite, let vueWeb else { return }
        etatPage = .enCours
        // L'ORIGINE VIENT D'ICI, ET DE NULLE PART AILLEURS. Cloudflare
        // compare cet hôte à la liste de domaines de la clé de site ;
        // c'est le seul rôle du `baseURL`, et c'est pour cela qu'aucune
        // page n'a besoin d'être hébergée.
        vueWeb.loadHTMLString(TurnstileConfig.html(cleDeSite: cleDeSite), baseURL: origine)
    }

    private func lancerLaDemande() {
        // Si la page n'est pas prête, on ne fait rien : le message
        // « pret » relancera la demande dès qu'elle le sera, et la garde
        // veille pendant ce temps.
        guard etatPage == .prete, let vueWeb else { return }
        vueWeb.evaluateJavaScript("window.demanderUnJeton && window.demanderUnJeton();")
    }

    // MARK: - Le délai de garde

    /// UN BOUTON NE DOIT JAMAIS RESTER FIGÉ. Sans cette garde, un réseau
    /// d'entreprise qui avale silencieusement les requêtes vers
    /// Cloudflare laisserait l'écran en attente pour toujours — le
    /// défaut que tout le monde oublie et qui produit les appels au
    /// support.
    private func armerLaGarde(_ delai: TimeInterval) {
        garde?.cancel()
        garde = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delai * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.gardeEchue()
        }
    }

    private func gardeEchue() {
        if etatPage != .prete {
            // Le script n'est jamais arrivé : réseau coupé, bloqueur,
            // filtrage d'entreprise. Inutile de réinfliger douze
            // secondes d'attente au geste suivant — mais on ne renonce
            // pas pour autant : le repos expire tout seul.
            reposJusqua = Date.now.addingTimeInterval(reposApresPanne)
        }
        // Le widget est resté à mi-chemin et ne se remet pas en marche
        // tout seul. On oublie la page ; la prochaine demande la
        // remontera.
        etatPage = .vierge
        terminer(.indisponible)
    }

    private func terminer(_ resultat: ResultatTurnstile) {
        garde?.cancel()
        garde = nil
        enigmeAffichee = false
        guard let suite = attente else { return }
        attente = nil
        suite.resume(returning: resultat)
    }

    // MARK: - Ce que la page raconte

    fileprivate func recevoir(_ charge: [String: Any]) {
        switch charge["type"] as? String ?? "" {

        case "pret":
            etatPage = .prete
            // Une demande peut avoir été faite avant que la page soit
            // prête : c'est le cas normal du tout premier clic.
            if attente != nil { lancerLaDemande() }

        case "jeton":
            let valeur = charge["valeur"] as? String ?? ""
            terminer(valeur.isEmpty ? .indisponible : .jeton(valeur))

        case "interactif":
            // Cloudflare va montrer quelque chose : la vue grandit, et
            // on laisse à la personne le temps de répondre.
            enigmeAffichee = true
            armerLaGarde(delaiInteractif)

        case "discret":
            enigmeAffichee = false

        case "expire":
            // Ne devrait pas arriver — on demande le jeton juste avant
            // de s'en servir — mais un jeton périmé rendu à l'appelant
            // vaudrait un refus serveur incompréhensible.
            terminer(.indisponible)

        case "erreur", "delai", "nonsupporte":
            // ON NE DISTINGUE PAS « tu es un robot » DE « le widget est
            // cassé » : Cloudflare ne le dit pas au client. On oublie
            // la page pour que la tentative suivante reparte propre, et
            // on laisse le serveur trancher.
            //
            // LE RECHARGEMENT N'EST SURTOUT PAS FAIT ICI. Une clé de
            // site dont le domaine n'est pas autorisé produit une
            // erreur DÈS LE RENDU, avant toute demande : recharger à
            // cet endroit ferait une boucle infinie de chargements, sur
            // un écran où personne ne verrait rien d'autre que la
            // batterie fondre.
            etatPage = .vierge
            if attente == nil {
                // Erreur survenue hors de toute demande : c'est le
                // symptôme d'une configuration fausse. On se met au
                // repos pour que le prochain geste échoue vite au lieu
                // d'attendre douze secondes pour rien.
                reposJusqua = Date.now.addingTimeInterval(reposApresPanne)
                return
            }
            terminer(.indisponible)

        default:
            break
        }
    }
}

// MARK: - Quand la page elle-même ne se charge pas

extension PortierTurnstile: WKNavigationDelegate {

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        pageEnEchec()
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        pageEnEchec()
    }

    /// La page elle-même n'a pas pu être posée — ce qui, avec une page
    /// fabriquée en mémoire, ne peut venir que du réseau. On se met au
    /// repos et on rend la main : surtout pas de rechargement en boucle
    /// sur un téléphone hors couverture.
    private func pageEnEchec() {
        etatPage = .vierge
        reposJusqua = Date.now.addingTimeInterval(reposApresPanne)
        terminer(.indisponible)
    }
}

/// LE RELAIS, ET POURQUOI IL EXISTE.
///
/// `WKUserContentController` retient FORTEMENT son gestionnaire de
/// messages. Un portier qui se désignerait lui-même se retiendrait donc
/// à travers sa propre vue web, et ne serait jamais libéré quand la
/// feuille de connexion se ferme. Ce relais tient le portier faiblement
/// et casse le cycle.
private final class RelaisTurnstile: NSObject, WKScriptMessageHandler {

    private weak var cible: PortierTurnstile?

    init(cible: PortierTurnstile) {
        self.cible = cible
        super.init()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let charge = message.body as? [String: Any] else { return }
        // WebKit livre ces messages sur le fil principal. On le vérifie
        // quand même : `assumeIsolated` s'arrête net si l'hypothèse est
        // fausse, et une porte d'entrée n'est pas l'endroit où l'on
        // s'offre un arrêt brutal.
        if Thread.isMainThread {
            MainActor.assumeIsolated { cible?.recevoir(charge) }
        } else {
            Task { @MainActor [cible] in cible?.recevoir(charge) }
        }
    }
}
