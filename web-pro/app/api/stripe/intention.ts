/**
 * §STRIPE — CE QUE LE NAVIGATEUR A LE DROIT D'ENVOYER.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE INTENTION, PAS UNE COMMANDE
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce que le client poste tient en trois choses : quelle OFFRE, à quel
 * RYTHME, avec quels MODULES en plus. Rien d'autre ne franchit cette
 * porte — et surtout aucun montant, aucun code de remise, aucune
 * entreprise.
 *
 *   • AUCUN MONTANT. Le serveur relit l'offre, la matrice offre ×
 *     module, les sièges et la remise en base, et calcule. Un client
 *     qui poste « planKey: business, prix: 0 » n'est pas refusé par
 *     politesse : le champ n'existe pas, et ce fichier est l'endroit où
 *     cela se voit.
 *   • AUCUN CODE DE REMISE. La remise est ACCORDÉE, elle ne se réclame
 *     pas : `subscription_discounts` porte celle de l'entreprise, avec
 *     sa date de fin. Accepter un code posté ici ferait du tarif
 *     Fondateur un mot de passe qui finirait sur un forum.
 *   • AUCUNE ENTREPRISE. L'organisation vient de la SESSION. La lui
 *     laisser choisir ne servirait qu'à essayer de payer pour une autre
 *     — ou pire, à composer la souscription d'une autre pour en lire
 *     l'effectif.
 *
 * Ce fichier ne fait AUCUN appel : c'est de la lecture de forme, et
 * c'est ce qui le rend testable sans base ni réseau.
 */

/** Les deux cycles que la grille connaît. Il n'y en a pas de troisième. */
export type CycleFacturationDemande = "monthly" | "yearly";

export type IntentionSouscription = {
  planKey: string;
  billingCycle: CycleFacturationDemande;
  moduleKeys: string[];
};

export type LectureIntention =
  | { ok: true; intention: IntentionSouscription }
  | { ok: false; motif: string };

/**
 * Des bornes, et pas seulement des types.
 *
 * Une clé d'offre de dix mille caractères ne fait pas planter le
 * serveur, mais elle part en requête, en métadonnée et en journal. On
 * borne à l'entrée : c'est le seul endroit où c'est encore facile.
 */
const LONGUEUR_MAX_CLEF = 64;
const MODULES_MAX = 20;

/** Les clés de la grille sont des identifiants, pas du texte libre. */
const FORME_CLEF = /^[a-z0-9][a-z0-9_-]*$/i;

function clefValide(valeur: unknown): valeur is string {
  return (
    typeof valeur === "string" &&
    valeur.length > 0 &&
    valeur.length <= LONGUEUR_MAX_CLEF &&
    FORME_CLEF.test(valeur)
  );
}

/**
 * Lit une intention dans un corps de requête déjà désérialisé.
 *
 * Rend un MOTIF français plutôt qu'une exception : cette réponse est
 * affichée telle quelle sous le bouton, et « Unexpected token » n'aide
 * personne à comprendre qu'il faut choisir une offre.
 */
export function lireIntention(corps: unknown): LectureIntention {
  if (typeof corps !== "object" || corps === null || Array.isArray(corps)) {
    return { ok: false, motif: "La demande de souscription est mal formée." };
  }

  const brut = corps as Record<string, unknown>;

  const planKey = typeof brut.planKey === "string" ? brut.planKey.trim() : brut.planKey;
  if (!clefValide(planKey)) {
    return { ok: false, motif: "Aucune offre n'a été choisie, ou son identifiant est invalide." };
  }

  // Le DÉFAUT EST LE MOIS, et ce n'est pas arbitraire : c'est le seul
  // cycle dont tous les prix existent. L'annuel manque encore au siège
  // supplémentaire et à la remise Fondateur, et la base bloque ces deux
  // cas plutôt que d'inventer un montant.
  let billingCycle: CycleFacturationDemande = "monthly";
  if (brut.billingCycle !== undefined && brut.billingCycle !== null) {
    if (brut.billingCycle !== "monthly" && brut.billingCycle !== "yearly") {
      return {
        ok: false,
        motif: "Le rythme de facturation doit être « au mois » ou « à l'année ».",
      };
    }
    billingCycle = brut.billingCycle;
  }

  let moduleKeys: string[] = [];
  if (brut.moduleKeys !== undefined && brut.moduleKeys !== null) {
    if (!Array.isArray(brut.moduleKeys)) {
      return { ok: false, motif: "La liste des modules est mal formée." };
    }
    if (brut.moduleKeys.length > MODULES_MAX) {
      return { ok: false, motif: "Trop de modules demandés en une seule souscription." };
    }
    for (const valeur of brut.moduleKeys) {
      if (!clefValide(valeur)) {
        return { ok: false, motif: "Un des modules demandés porte un identifiant invalide." };
      }
    }
    // Dédoublonnées et ordonnées : deux fois le même module ne doit pas
    // produire deux lignes, et l'ordre stable rend la clé d'idempotence
    // stable elle aussi — sans quoi deux clics identiques créeraient
    // deux sessions de paiement.
    moduleKeys = [...new Set(brut.moduleKeys as string[])].sort();
  }

  return { ok: true, intention: { planKey, billingCycle, moduleKeys } };
}

/**
 * QUI A LE DROIT D'ENGAGER L'ENTREPRISE.
 *
 * Souscrire, c'est prendre un engagement financier au nom de la
 * société. `lib/auth/permissions.ts` n'a pas (encore) de permission de
 * facturation ; en attendant, on s'en tient aux deux rôles qui
 * administrent l'entreprise. Un chef d'équipe qui clique « Souscrire »
 * dans un menu qu'il n'aurait pas dû voir doit être arrêté par le
 * SERVEUR, pas par l'absence de bouton.
 */
export const ROLES_QUI_PEUVENT_SOUSCRIRE = ["owner", "admin"] as const;

export function peutSouscrire(role: string): boolean {
  return (ROLES_QUI_PEUVENT_SOUSCRIRE as readonly string[]).includes(role);
}
