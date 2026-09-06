import { NextResponse } from "next/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { passerLesRelances } from "../dependances.ts";

/**
 * §EMAILS — LE PASSAGE DE RELANCES, DÉCLENCHÉ À LA MAIN.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CETTE ROUTE N'EST PAS : UN PLANIFICATEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * Rien ne l'appelle. Ni `pg_cron` (absent du projet), ni `pg_net`
 * (absent), ni un cron Supabase, ni un cron chez l'hébergeur. C'est le
 * SEUIL sur lequel un ordonnanceur se branchera le jour où l'on aura
 * choisi lequel — et tant que ce choix n'est pas fait, la relance de
 * devis et la relance de facture ne partent pas toutes seules. Il faut
 * le dire franchement plutôt que de laisser croire le contraire : c'est
 * la moitié temporelle du besoin, elle est calculée, elle n'est pas
 * déclenchée.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI ELLE S'AUTHENTIFIE PAR LA SESSION, ET NON PAR UN SECRET
 * ══════════════════════════════════════════════════════════════════
 *
 * La tentation évidente serait un secret partagé dans un en-tête, pour
 * qu'un cron puisse frapper la route au nom de tout le parc. On ne l'a
 * pas écrit, et l'abstention est le point :
 *
 *   • un secret d'en-tête sans clé de service ne donne accès à RIEN.
 *     Ce serveur lit sous RLS avec la session de l'appelant ; un cron
 *     n'a pas de session, donc verrait zéro devis et zéro facture. La
 *     route aurait l'air de marcher et ne ferait rien — le pire des
 *     deux mondes ;
 *
 *   • poser une clé de service dans `web-pro` change la posture de
 *     sécurité de toute l'application, et `.env.example` l'interdit
 *     nommément. Ce n'est pas une décision à glisser dans une route
 *     d'e-mail.
 *
 * Elle traite donc UNE entreprise : celle de la personne connectée. Ce
 * qui, en attendant l'ordonnanceur, est utilisable tel quel — un
 * paysagiste peut lancer ses relances depuis son écran — et ne peut
 * jamais toucher une autre entreprise que la sienne, même si
 * l'identifiant était trafiqué : il n'est pas lu depuis la requête.
 *
 * ══════════════════════════════════════════════════════════════════
 * POST, ET PAS GET
 * ══════════════════════════════════════════════════════════════════
 *
 * Un GET est préchargé par les navigateurs, suivi par les robots
 * d'indexation et rejoué au retour arrière. Une route qui expédie du
 * courrier ne peut pas être de celles-là.
 *
 * ── ET C'EST AUSSI POURQUOI IL N'Y A AUCUN RÉGLAGE DE SEGMENT ──────
 *
 * Pas de `export const runtime`, pas de `export const dynamic`. Les
 * routes d'IA voisines en portent, écrites sous une version
 * antérieure ; la documentation de cette version-ci dit le contraire
 * (`node_modules/next/dist/docs/.../route-segment-config/runtime.md`) :
 * le runtime Edge est déprécié et il faut RETIRER l'export, `nodejs`
 * étant le défaut. Quant au cache, les Route Handlers ne sont pas mis
 * en cache par défaut et un POST ne l'est jamais — `force-dynamic`
 * n'achèterait rien et donnerait à croire qu'il protège de quelque
 * chose.
 */

export async function POST() {
  const organisation = await getActiveOrganization();
  if (!organisation) {
    // CE QUE CETTE BRANCHE COUVRE RÉELLEMENT, vérifié contre le serveur
    // plutôt que supposé : un visiteur NON CONNECTÉ n'arrive jamais
    // jusqu'ici — `proxy.ts` le renvoie vers `/login` par une
    // redirection 307, avant le handler. Il reste le cas d'un
    // utilisateur connecté SANS organisation active, et c'est lui qu'on
    // traite : 401 et une phrase, plutôt que la redirection de
    // `requireOrganization()`, parce qu'un appelant programmatique doit
    // recevoir une réponse et non une page de connexion.
    return NextResponse.json(
      { erreur: "Connectez-vous pour lancer les relances de votre entreprise." },
      { status: 401 },
    );
  }

  const bilan = await passerLesRelances(organisation.organizationId);

  // 200 dans tous les cas où le calcul a abouti, y compris quand rien
  // n'est parti. « Les relances ne sont pas activées » n'est pas une
  // panne : c'est le réglage par défaut, et l'appelant doit lire la
  // phrase plutôt que d'interpréter un code.
  return NextResponse.json({
    entreprise: bilan.organizationId,
    inactif: bilan.raisonInactive,
    misEnFile: bilan.misEnFile,
    dejaParti: bilan.dejaParti,
    refuse: bilan.refuse,
    indisponible: bilan.indisponible,
    erreur: bilan.erreur,
    details: bilan.details.map((d) => ({
      reference: d.reference,
      etat: d.resultat.etat,
      // On ne renvoie que la phrase destinée à l'écran. Jamais
      // l'adresse du destinataire, jamais un identifiant de message
      // d'un autre objet : cette réponse traverse le réseau et finira
      // dans un journal d'accès.
      raison: "raison" in d.resultat ? d.resultat.raison : null,
    })),
  });
}
