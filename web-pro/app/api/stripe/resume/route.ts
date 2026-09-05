import { getActiveOrganization } from "@/lib/auth/organization";
import { getBillingProvider } from "@/lib/billing/provider";
import { lireIntention, peutSouscrire } from "../intention";

/**
 * §15 « Choisir → Résumé → Paiement → Confirmation » — L'ÉTAPE
 * « RÉSUMÉ », qui n'engage rien.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE ROUTE SÉPARÉE, ET NON UN CALCUL DANS L'ÉCRAN
 * ══════════════════════════════════════════════════════════════════
 *
 * Le résumé et le paiement sont produits par LE MÊME code, appelé deux
 * fois. Un résumé calculé à part — ne serait-ce qu'une multiplication
 * refaite dans le gabarit — finirait par annoncer un montant et en
 * prélever un autre, et le client ne le verrait qu'au relevé bancaire.
 *
 * Ce que rend cette route est déjà nettoyé de l'identifiant de tarif du
 * prestataire (voir `versResumePublic`) : le navigateur reçoit ce qu'il
 * doit AFFICHER, pas ce qui sert à encaisser.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES MONTANTS SONT HORS TAXES, ET LA RÉPONSE LE DIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Chaque résumé porte `mentionPrix: "HT"`. Un prix hors taxes montré
 * sans sa mention à un professionnel est une pratique commerciale
 * trompeuse, et une mention laissée au gabarit finit par manquer au
 * deuxième écran.
 *
 * CE QUE CETTE ROUTE NE DIT PAS ENCORE : le montant réellement DÉBITÉ.
 * Une entreprise française paiera 95,88 € pour 79,90 € HT, une
 * néerlandaise avec numéro intracommunautaire validé paiera 79,90 €.
 * Le régime est décidé par `saas_vat_regime()` — et cette fonction
 * appartient à la chaîne de facturation, qui n'est pas encore déployée.
 * Tant qu'elle ne l'est pas, mieux vaut afficher un HT clairement
 * étiqueté qu'un TTC calculé de tête.
 */

export async function POST(request: Request) {
  const organization = await getActiveOrganization();
  if (!organization) {
    return Response.json(
      { jouable: false, code: "sessionExpiree", motif: "Votre session a expiré." },
      { status: 401 },
    );
  }

  // Le résumé montre l'effectif facturable et la remise accordée à
  // l'entreprise : ce sont des informations de direction, pas des
  // informations d'écran. On les réserve à ceux qui peuvent souscrire.
  if (!peutSouscrire(organization.role)) {
    return Response.json(
      {
        jouable: false,
        code: "roleInsuffisant",
        motif:
          "Seul le propriétaire ou un administrateur de l'entreprise peut consulter le détail d'une souscription.",
      },
      { status: 403 },
    );
  }

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return Response.json(
      { jouable: false, code: "corpsIllisible", motif: "La demande est mal formée." },
      { status: 400 },
    );
  }

  const lecture = lireIntention(corps);
  if (!lecture.ok) {
    return Response.json(
      { jouable: false, code: "intentionInvalide", motif: lecture.motif },
      { status: 400 },
    );
  }

  const provider = getBillingProvider();

  // `previewCheckout` est FACULTATIVE sur l'interface : un fournisseur
  // qui n'encaisse pas ne sait pas détailler une souscription, et il ne
  // doit pas avoir à faire semblant. On répond alors avec la phrase
  // qu'il donne déjà pour expliquer pourquoi la caisse est fermée.
  if (typeof provider.previewCheckout !== "function") {
    return Response.json({
      jouable: false,
      code: "encaissementIndisponible",
      motif:
        provider.unavailableReason ??
        "Le détail d'une souscription n'est pas disponible pour le moment.",
    });
  }

  const resume = await provider.previewCheckout({
    organizationId: organization.organizationId,
    planKey: lecture.intention.planKey,
    billingCycle: lecture.intention.billingCycle,
    moduleKeys: lecture.intention.moduleKeys,
  });

  return Response.json(resume);
}
