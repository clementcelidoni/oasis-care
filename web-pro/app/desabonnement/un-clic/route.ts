import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/**
 * §EMAILS — LE DÉSABONNEMENT EN UN CLIC (RFC 8058).
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE POINT DE TERMINAISON EXISTE, EN PLUS DE LA PAGE
 * ══════════════════════════════════════════════════════════════════
 *
 * Gmail et Yahoo exigent des envois de masse, depuis 2024, un en-tête
 * `List-Unsubscribe` accompagné de
 * `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Leur bouton
 * natif « Se désabonner » POSTE alors sur cette adresse, sans ouvrir
 * quoi que ce soit et sans que la personne ait à cliquer une seconde
 * fois.
 *
 * Un en-tête qui pointerait une page ne répondant qu'au GET ferait
 * disparaître ce bouton. Le destinataire n'aurait plus qu'un geste :
 * « signaler comme indésirable » — la plainte qui remplit la liste de
 * blocage TRANSACTIONNELLE du transporteur, et qui bloquera ensuite la
 * FACTURE de la même adresse.
 *
 * Une page Next et un point de terminaison POST ne pouvant pas
 * cohabiter sur la même route, l'en-tête pointe ici, et le bouton du
 * corps pointe la page. Le GET redirige vers elle : quelqu'un qui
 * ouvrira cette adresse à la main verra une page, pas du JSON.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL RÉPOND 200 MÊME QUAND LE JETON EST INCONNU
 * ══════════════════════════════════════════════════════════════════
 *
 * Un 4xx apprendrait à qui essaie des jetons lesquels ont existé. Et un
 * client de messagerie qui reçoit une erreur peut décider que le
 * désabonnement a échoué et proposer à la place de signaler le message.
 * On répond donc toujours « c'est noté », et la base tranche en
 * silence — exactement ce que fait `email_unsubscribe`, qui donne la
 * même phrase pour un jeton inconnu et pour un jeton déjà utilisé.
 */

async function retirer(jeton: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !cle || jeton.trim() === "") return;

  const supabase = createClient(url, cle, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Le résultat n'est pas lu : il n'y a personne à qui le montrer. La
  // page, elle, l'affiche. Et une panne ne doit surtout pas remonter en
  // 500 : un client de messagerie qui reçoit une erreur peut proposer
  // « signaler comme indésirable » à la place.
  try {
    await supabase.rpc("email_unsubscribe", { p_token: jeton });
  } catch {
    // Rien à faire d'ici. Le message porte aussi un bouton vers la
    // page, qui explique et propose de réessayer.
  }
}

export async function POST(requete: NextRequest) {
  const jeton = requete.nextUrl.searchParams.get("jeton") ?? "";
  await retirer(jeton);
  return new NextResponse(null, { status: 200 });
}

export async function GET(requete: NextRequest) {
  // Un humain a ouvert l'adresse de l'en-tête. On ne désabonne PAS au
  // GET : les aperçus de lien et les analyseurs de sécurité des
  // messageries visitent les URL qu'ils trouvent, et désabonneraient
  // des gens qui n'ont rien demandé. On l'envoie sur la page, qui
  // demande puis confirme.
  const jeton = requete.nextUrl.searchParams.get("jeton") ?? "";
  const destination = new URL("/desabonnement", requete.nextUrl.origin);
  if (jeton !== "") destination.searchParams.set("jeton", jeton);
  return NextResponse.redirect(destination);
}
