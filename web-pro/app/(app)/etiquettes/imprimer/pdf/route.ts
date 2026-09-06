import { NextResponse, type NextRequest } from "next/server";

import { getActiveOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { plancheVersPdf } from "@/lib/etiquettes";

import { composerDepuisRequete, lireRequete } from "../../planche.ts";

/**
 * LE PDF DE LA PLANCHE — le seul chemin où les millimètres sont sûrs.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN PDF PLUTÔT QUE « IMPRIMER » DEPUIS LA PAGE
 * ══════════════════════════════════════════════════════════════════
 *
 * DEUX PROBLÈMES QUE L'IMPRESSION DEPUIS UNE PAGE HTML NE RÈGLE PAS :
 *
 *   1. LA MARGE DE 14 MM. `web-pro/app/globals.css` déclare
 *      `@media print { @page { margin: 14mm } }`, et ce fichier est
 *      importé par la mise en page RACINE. Next.js n'offre aucun moyen
 *      de s'y soustraire : les quatre-vingts routes en héritent. Sous
 *      cette règle, une étiquette de 25 × 15 mm a une surface
 *      imprimable NÉGATIVE — 14 + 14 = 28 mm de marges pour 15 mm de
 *      hauteur. Trois des cinq formats du § 17 sont dans ce cas.
 *      On pourrait la contrer par la cascade, en posant un `<style>`
 *      dans le corps du document ; `lib/etiquettes/planche.ts` sait le
 *      faire. Mais cela reste une bataille de spécificité, gagnée sur
 *      les navigateurs d'aujourd'hui.
 *
 *   2. L'ÉCHELLE ET LES MARGES DU NAVIGATEUR. « Ajuster à la page »
 *      redimensionne SILENCIEUSEMENT. Une planche dont les cotes
 *      dérivent de 2 % ne colle pas sur son support, et rien à l'écran
 *      ne l'avait annoncé. Notre code ne peut pas forcer ces réglages.
 *
 * LE PDF FAIT DISPARAÎTRE LES DEUX. Les cotes sont dans le MediaBox du
 * fichier : aucune feuille de style, aucune boîte de dialogue, aucun
 * réglage de poste ne peut les changer. Une Zebra, une Brother ou une
 * Dymo installée comme imprimante du système l'avale par son pilote,
 * comme n'importe quel document — à condition que le format déclaré
 * corresponde au rouleau chargé.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN ROUTE HANDLER, ET CE QUE CELA IMPLIQUE
 * ══════════════════════════════════════════════════════════════════
 *
 * Les mises en page ne s'exécutent PAS pour un route handler : celle
 * de `(app)`, qui vérifie la session et redirige, ne tourne pas ici.
 * La vérification est donc refaite en toutes lettres ci-dessous. Et
 * comme partout, la barrière réelle reste la RLS : la lecture des
 * objets et des jetons se fait avec la session de l'appelant, et un
 * compte sans droit obtient une planche vide plutôt qu'un refus — ce
 * qui est le comportement voulu, pas un oubli.
 *
 * Générer le PDF ici plutôt que dans le navigateur évite d'expédier
 * l'encodeur au client, et surtout garantit que le fichier téléchargé
 * est OCTET POUR OCTET celui que le serveur a composé.
 */

export const dynamic = "force-dynamic";

export async function GET(requeteHttp: NextRequest) {
  const organization = await getActiveOrganization();
  if (!organization) {
    // Un route handler ne redirige pas vers une page de connexion : ce
    // qu'on attend de lui est un fichier, et une page HTML déguisée en
    // PDF donnerait un fichier illisible plutôt qu'un message clair.
    return new NextResponse("Connectez-vous pour imprimer des étiquettes.", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const params = Object.fromEntries(requeteHttp.nextUrl.searchParams.entries());
  const requete = lireRequete(params);
  if (!requete) {
    return new NextResponse(
      "Cette planche n'est pas décrite correctement : il manque le type d'élément ou la liste des identifiants.",
      { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const supabase = await createClient();
  const composee = await composerDepuisRequete(supabase, organization, requete);

  if (!composee.planche) {
    return new NextResponse(composee.erreur ?? "Cette planche est vide.", {
      status: 409,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const octets = plancheVersPdf(composee.planche);
  const telecharger = params.telecharger === "1";
  const nom = `etiquettes-${requete.source}-${composee.planche.nombreEtiquettes}.pdf`;

  return new NextResponse(octets as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      // « inline » ouvre la visionneuse du navigateur, d'où l'on
      // imprime : c'est le chemin normal. « attachment » sert quand on
      // veut porter le fichier sur le poste qui pilote la thermique.
      "content-disposition": `${telecharger ? "attachment" : "inline"}; filename="${nom}"`,
      // UNE PLANCHE NE SE MET PAS EN CACHE. Elle dépend de la session,
      // des droits et de l'état des étiquettes à l'instant du clic ;
      // un cache partagé la servirait à quelqu'un d'autre.
      "cache-control": "no-store, private",
    },
  });
}
