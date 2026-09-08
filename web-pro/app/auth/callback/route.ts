import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * LE RETOUR DE CONNEXION, ET SES DEUX FORMES.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI DEUX, ALORS QU'UNE SUFFISAIT HIER
 * ══════════════════════════════════════════════════════════════════
 *
 * Cette route n'acceptait que `?code=`. C'est la forme dite PKCE, et
 * elle a une propriété qu'on oublie facilement : ELLE EXIGE QUE LE LIEN
 * SOIT OUVERT DANS LE NAVIGATEUR QUI L'A DEMANDÉ. Au moment de la
 * demande, le client dépose une clé de vérification dans le stockage
 * local ; au retour, le serveur d'authentification la réclame. Sans
 * elle, l'échange échoue.
 *
 * Or personne ne se connecte comme ça. On demande le lien sur son
 * ordinateur et on ouvre le courriel sur son téléphone. On clique
 * depuis une application de messagerie qui ouvre son propre navigateur.
 * On est en navigation privée. Dans tous ces cas la clé manque, et
 * l'utilisateur retombait sur `/login?error=missing_code` — un écran de
 * connexion qui ne dit rien de ce qui vient d'échouer, et qui donne
 * l'impression que le lien « ne marche pas ».
 *
 * C'est arrivé pour de vrai, et c'est ce qui a motivé cette réécriture.
 *
 * LA SECONDE FORME, `?token_hash=` + `?type=`, EST SANS ÉTAT. Rien
 * n'est stocké côté navigateur : le jeton se suffit à lui-même. Elle
 * fonctionne donc depuis n'importe quel appareil, ce qui est
 * exactement ce qu'on attend d'un lien reçu par courriel.
 *
 * ON GARDE LES DEUX PLUTÔT QUE DE CHOISIR. `?code=` reste la forme
 * employée par la connexion Google et Apple, qui se déroule toujours
 * dans le même navigateur : la retirer casserait ces deux boutons.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CETTE ROUTE NE FAIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle ne redirige JAMAIS ailleurs que sur ce site. Un `next` absolu
 * fourni par un tiers transformerait une connexion réussie en tremplin
 * vers n'importe quelle adresse — et le lien viendrait d'un courriel,
 * donc d'un endroit où l'on clique sans réfléchir.
 *
 * Et elle ne dit pas à l'utilisateur ce qui a échoué dans le détail.
 * Un message technique dans une barre d'adresse n'aide personne et
 * renseigne un curieux ; l'écran de connexion, lui, saura traduire.
 */

/** Les types d'envoi qui peuvent revenir par un lien de courriel. */
const TYPES_ACCEPTES: readonly EmailOtpType[] = [
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
  "email",
];

function estTypeAccepte(valeur: string | null): valeur is EmailOtpType {
  return valeur !== null && (TYPES_ACCEPTES as readonly string[]).includes(valeur);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  // Là où l'utilisateur allait avant d'être renvoyé vers la connexion.
  const next = searchParams.get("next") ?? "/";
  // Un chemin de ce site, et rien d'autre.
  const suiteSure = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const echec = (motif: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(motif)}`);

  const supabase = await createClient();

  // ------------------------------------------------------------
  // FORME 1 — le jeton sans état, celui des liens de courriel
  // ------------------------------------------------------------
  // Essayée EN PREMIER : c'est celle qui fonctionne depuis n'importe
  // quel appareil, donc celle qui a le plus de chances d'être la bonne
  // quand quelqu'un clique dans sa boîte de réception.
  const jeton = searchParams.get("token_hash") ?? searchParams.get("token");
  const type = searchParams.get("type");

  if (jeton !== null) {
    if (!estTypeAccepte(type)) {
      // Un type inconnu n'est pas une erreur d'utilisateur : c'est un
      // gabarit de courriel mal formé. On le refuse plutôt que de
      // deviner, parce que deviner reviendrait à accepter n'importe
      // quel jeton pour n'importe quel usage.
      return echec("type_de_lien_inconnu");
    }

    const { error } = await supabase.auth.verifyOtp({ type, token_hash: jeton });
    if (error) return echec(error.message);
    return NextResponse.redirect(`${origin}${suiteSure}`);
  }

  // ------------------------------------------------------------
  // FORME 2 — le code d'échange, celui de Google et d'Apple
  // ------------------------------------------------------------
  const code = searchParams.get("code");

  if (code !== null) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return echec(error.message);
    return NextResponse.redirect(`${origin}${suiteSure}`);
  }

  // ------------------------------------------------------------
  // NI L'UN NI L'AUTRE
  // ------------------------------------------------------------
  // Le plus souvent : un lien recopié à la main et tronqué, ou un lien
  // déjà consommé dont le navigateur a gardé l'adresse sans ses
  // paramètres.
  return echec("lien_incomplet");
}
