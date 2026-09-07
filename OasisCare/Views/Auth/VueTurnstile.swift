import SwiftUI
import WebKit

/// LA VÉRIFICATION ANTI-ROBOT, INVISIBLE TANT QU'ELLE PEUT L'ÊTRE.
///
/// ══════════════════════════════════════════════════════════════════
/// CE QUE CETTE VUE EST, ET CE QU'ELLE N'EST PAS
/// ══════════════════════════════════════════════════════════════════
///
/// Ce n'est pas une étape de plus dans le parcours : c'est un pixel posé
/// dans la mise en page, qui ne devient une case à cocher que le jour où
/// Cloudflare l'exige. La très grande majorité des connexions ne verront
/// jamais rien.
///
/// ══════════════════════════════════════════════════════════════════
/// UN SEUL PONT, JAMAIS DEUX
/// ══════════════════════════════════════════════════════════════════
///
/// La taille change, le pont non. Écrire `if énigme { … } else { … }`
/// avec un `UIViewRepresentable` de chaque côté ferait démonter et
/// remonter la vue web au moment précis où elle est en train de résoudre
/// un défi. On garde donc UNE vue, et on la fait grandir.
///
/// ══════════════════════════════════════════════════════════════════
/// LA PLACE DANS L'ÉCRAN, ET POURQUOI ELLE EST HORS DES ÉTAPES
/// ══════════════════════════════════════════════════════════════════
///
/// L'écran de connexion a trois temps, et DEUX d'entre eux déclenchent
/// un appel protégé : « Se connecter » et « Recevoir un code » au
/// premier, « Renvoyer le code » au deuxième. Une vue posée à
/// l'intérieur d'une étape disparaîtrait en changeant d'étape, et le
/// renvoi de code se retrouverait sans widget — donc sans jeton, donc
/// refusé. Elle est donc posée UNE FOIS, en dehors de l'aiguillage.
///
/// ══════════════════════════════════════════════════════════════════
/// L'ACCESSIBILITÉ : UNE PROTECTION NE DOIT PAS DEVENIR UN MUR
/// ══════════════════════════════════════════════════════════════════
///
///   • Tant que rien n'est demandé, la vue est masquée aux
///     technologies d'assistance et ne reçoit aucun geste : VoiceOver
///     ne s'arrête pas sur un pixel vide, et le clavier ne s'y perd
///     pas.
///   • Quand l'énigme apparaît, une phrase la précède et la nomme —
///     sans elle, un lecteur d'écran annoncerait un contenu web surgi
///     de nulle part au milieu d'un formulaire de connexion.
///   • Rien ne piège le clavier : la vue vit dans le flux de l'écran,
///     au-dessus des boutons qui restent atteignables, et le bouton
///     « Annuler » de la barre de navigation reste accessible à tout
///     moment.
///   • Il n'y a AUCUN écran modal : une énigme dans une feuille
///     par-dessus une feuille est exactement le genre de chose dont on
///     ne ressort pas quand elle se bloque.
struct VueTurnstile: View {

    @ObservedObject var portier: PortierTurnstile

    /// Là où VoiceOver doit se poser quand l'énigme surgit.
    ///
    /// Sans cela, une personne aveugle appuie sur « Se connecter »,
    /// entend un indicateur d'activité, et rien d'autre : la case à
    /// cocher est apparue plus bas, hors du chemin de lecture, et
    /// l'écran paraît simplement bloqué. On amène donc la lecture sur la
    /// phrase qui explique ce qui vient de se passer.
    @AccessibilityFocusState private var focusSurLEnigme: Bool

    /// La hauteur laissée à l'énigme. Cloudflare dessine sa case dans
    /// une boîte de 65 points, mais une énigme réelle occupe davantage
    /// et se dessine par-dessus. On donne large, et la vue web fait
    /// défiler ce qui dépasse — mieux vaut une marge inutile qu'un
    /// bouton « Vérifier » coupé en bas.
    private let hauteurDeLEnigme: CGFloat = 300

    /// Un point tant que rien n'est demandé — assez pour que WebKit
    /// considère la vue montée et ne ralentisse pas ses minuteurs, assez
    /// peu pour que personne ne la voie. Une hauteur nulle, elle, n'est
    /// pas fiable : une vue de taille zéro peut être traitée comme
    /// absente, et le widget se chargerait au ralenti ou pas du tout.
    private var hauteur: CGFloat { portier.enigmeAffichee ? hauteurDeLEnigme : 1 }

    /// `nil` veut dire « prends la largeur qu'on te propose ». Pendant
    /// l'énigme, la vue occupe donc toute la carte ; le reste du temps
    /// elle fait un point de large.
    private var largeur: CGFloat? { portier.enigmeAffichee ? nil : CGFloat(1) }

    var body: some View {
        // Sans clé de site, il n'y a rien à monter : ni vue web, ni
        // requête réseau, ni pixel. C'est l'état de l'application tant
        // que le réglage Supabase n'est pas activé, et il ne coûte rien.
        if portier.actif {
            VStack(alignment: .leading, spacing: 8) {
                if portier.enigmeAffichee {
                    Text("Encore un instant : confirmez ci-dessous que vous n'êtes pas un robot.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .accessibilityFocused($focusSurLEnigme)
                        .accessibilityIdentifier("captchaExplanation")
                }

                // AUCUN `accessibilityLabel` ICI, ET C'EST DÉLIBÉRÉ.
                // Coller une étiquette sur une vue qui a des enfants
                // risque de la réduire à un seul élément — c'est-à-dire
                // de cacher à VoiceOver la case à cocher qu'on lui
                // demande justement de cocher. Le widget de Cloudflare
                // porte sa propre accessibilité ; la phrase ci-dessus
                // lui donne son contexte.
                PontTurnstile(portier: portier)
                    .frame(width: largeur, height: hauteur)
                    .clipped()
                    .allowsHitTesting(portier.enigmeAffichee)
                    .accessibilityHidden(!portier.enigmeAffichee)
                    .accessibilityIdentifier("captchaWidget")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .onChange(of: portier.enigmeAffichee) { _, affichee in
                if affichee { focusSurLEnigme = true }
            }
        }
    }
}

/// Le pont vers UIKit. Il ne fabrique rien : la vue web appartient au
/// portier, qui la crée une seule fois et la garde tant que l'écran
/// vit. C'est ce qui permet à la page de rester chargée quand on passe
/// de l'étape « identifiants » à l'étape « code ».
private struct PontTurnstile: UIViewRepresentable {

    let portier: PortierTurnstile

    func makeUIView(context: Context) -> WKWebView {
        portier.vue()
    }

    func updateUIView(_ vue: WKWebView, context: Context) {
        // On n'autorise le défilement QUE pendant une énigme. Le reste
        // du temps, la vue fait un pixel et un défilement actif y
        // volerait des gestes à la liste qui la contient.
        vue.scrollView.isScrollEnabled = portier.enigmeAffichee
    }
}
