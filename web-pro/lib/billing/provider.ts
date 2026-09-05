import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { lireAbonnement } from "./abonnement";
import { lirePlansActifs } from "./plans";
import { construireStripeBillingProvider } from "./stripe";
import type { CycleFacturation } from "./composition";

/**
 * §16 BILLING — L'ABSTRACTION, ET CE QU'ELLE PORTE MAINTENANT.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER A CHANGÉ DE RÔLE, ET L'INTERFACE N'A PAS BOUGÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Il définissait l'interface ET la seule implémentation possible :
 * « rien n'encaisse ». Il définit toujours l'interface — mêmes méthodes,
 * même `CheckoutOutcome`, même `unavailableReason` — mais l'aiguillage
 * de `getBillingProvider()` mène désormais à Stripe quand ses variables
 * d'environnement sont posées, et retombe sur « rien n'encaisse »
 * sinon, EN DISANT CE QUI MANQUE.
 *
 * §"Si aucun fournisseur de paiement web réel configuré : ne pas
 * simuler une transaction." L'absence de clé reste un état NORMAL, pas
 * une panne : elle rend une phrase, l'écran n'affiche pas de bouton, et
 * rien ne ment.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'INTERFACE S'EST ÉLARGIE — VOICI POURQUOI, PRÉCISÉMENT
 * ══════════════════════════════════════════════════════════════════
 *
 * `CheckoutIntent` portait DEUX champs : `organizationId` et `planKey`.
 * Avec ces deux-là on ne peut exprimer ni le cycle (mois / an), ni les
 * modules optionnels — c'est-à-dire la moitié de ce que la grille sait
 * vendre. Deux champs FACULTATIFS s'y ajoutent donc, `billingCycle` et
 * `moduleKeys` ; tout appelant existant continue de compiler, et le
 * défaut est le mois, seul cycle dont tous les prix existent.
 *
 * CE QUI N'A PAS ÉTÉ AJOUTÉ, ET C'EST LE POINT : AUCUN MONTANT. Pas de
 * prix, pas de total, pas de code de remise saisi par le navigateur. Le
 * client qui posterait « planKey: business, prix: 0 » n'est pas refusé
 * par politesse — le champ n'existe pas. Le serveur relit l'offre, la
 * matrice offre × module, les sièges et la remise en base, et calcule.
 */

/** Les valeurs de la colonne `provider` (migration 0060). */
export type { BillingProviderId, SubscriptionStatus } from "./abonnement";
export type { OrganizationSubscription } from "./abonnement";
export type { OrganizationPlan } from "./plans";

import type { BillingProviderId, OrganizationSubscription } from "./abonnement";
import type { OrganizationPlan } from "./plans";

/**
 * L'INTENTION, et rien d'autre.
 *
 * `billingCycle` et `moduleKeys` sont facultatifs : un appelant qui n'en
 * sait rien demande l'offre au mois, sans module supplémentaire. Les
 * modules DÉJÀ souscrits sont relus en base de toute façon — cette
 * liste dit ce que le client veut EN PLUS, et la matrice tranche si ça
 * se facture ou si c'est compris.
 */
export type CheckoutIntent = {
  organizationId: string;
  planKey: string;
  billingCycle?: CycleFacturation;
  moduleKeys?: string[];
};

/**
 * Ce que produit une tentative de souscription.
 *
 * `unavailable` n'est pas une erreur : c'est l'état normal tant qu'aucun
 * encaissement n'existe, et c'est aussi la réponse à « cette offre se
 * construit sur devis ». Le distinguer d'un échec évite qu'un écran
 * affiche « une erreur est survenue » là où il n'y a rien de cassé.
 */
export type CheckoutOutcome =
  | { kind: "redirect"; url: string }
  | { kind: "completed"; planKey: string }
  | { kind: "unavailable"; reason: string };

export interface BillingProvider {
  readonly id: BillingProviderId;
  /** Le nom montré à l'utilisateur (« Achat In-App », « Carte bancaire »…). */
  readonly label: string;

  /**
   * `null` quand le fournisseur peut réellement encaisser. Sinon, la
   * phrase à afficher À LA PLACE du tunnel de paiement.
   */
  readonly unavailableReason: string | null;

  /** §15 — les forfaits proposés, lus en base et jamais codés en dur. */
  listPlans(): Promise<OrganizationPlan[]>;

  /** L'abonnement de l'entreprise, ou null si aucune ligne n'existe. */
  getSubscription(organizationId: string): Promise<OrganizationSubscription | null>;

  /**
   * §15 « Choisir → Résumé → Paiement → Confirmation ». Le point
   * d'entrée du tunnel.
   */
  startCheckout(intent: CheckoutIntent): Promise<CheckoutOutcome>;
}

/**
 * L'état « rien n'encaisse ».
 *
 * Ce fournisseur sait tout LIRE — les forfaits, l'abonnement en cours —
 * et refuse la seule chose qu'il ne sait pas faire. C'est ce qui permet
 * à l'écran d'être complet et honnête en même temps : on montre le
 * forfait actuel et le catalogue, on n'ouvre pas une caisse vide.
 *
 * LA RAISON EST DÉSORMAIS UN PARAMÈTRE. « Aucun moyen de paiement n'est
 * branché » et « la clé secrète n'est pas posée sur CE serveur » ne
 * demandent pas le même geste : la première attend une décision, la
 * seconde attend une variable d'environnement. Une phrase générique
 * enverrait chercher au mauvais endroit.
 */
export class UnconfiguredBillingProvider implements BillingProvider {
  readonly id = "none" as const;
  readonly label = "Aucun encaissement configuré";
  readonly unavailableReason: string;
  readonly #supabase: () => Promise<SupabaseClient>;

  constructor(raison: string, supabase: () => Promise<SupabaseClient> = createClient) {
    this.unavailableReason = raison;
    this.#supabase = supabase;
  }

  async listPlans(): Promise<OrganizationPlan[]> {
    return lirePlansActifs(await this.#supabase());
  }

  async getSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
    return lireAbonnement(await this.#supabase(), organizationId);
  }

  async startCheckout(intent: CheckoutIntent): Promise<CheckoutOutcome> {
    // §"ne pas simuler une transaction" : pas d'écriture, pas de faux
    // succès, pas de page de confirmation. On renvoie la raison, telle
    // quelle, et l'appelant l'affiche.
    void intent;
    return { kind: "unavailable", reason: this.unavailableReason };
  }
}

/**
 * Le fournisseur actif.
 *
 * C'est ICI — et nulle part ailleurs — que se fait le choix, exactement
 * comme le prévoyait la première version de ce fichier. Les écrans, eux,
 * n'ont pas changé : ils parlaient déjà à l'interface.
 *
 * POURQUOI LA CONSTRUCTION EST REFAITE À CHAQUE APPEL, et non mise en
 * cache dans un module : une variable d'environnement ajoutée sur
 * l'hébergeur doit prendre effet au déploiement suivant, pas au
 * redémarrage suivant d'un processus qu'on ne contrôle pas. Le coût est
 * une lecture de `process.env` — rien.
 */
export function getBillingProvider(): BillingProvider {
  const stripe = construireStripeBillingProvider(createClient);
  if ("indisponible" in stripe) return new UnconfiguredBillingProvider(stripe.indisponible);
  return stripe;
}

/**
 * §16 « Réutiliser le système d'entitlements existant de Phase 12. »
 *
 * Lecture seule, et volontairement. Ces lignes sont écrites par la
 * fonction Edge qui vérifie les notifications Apple (migration 0041) et
 * par elle seule ; la politique RLS ne rend visibles que celles de
 * l'utilisateur connecté. Les afficher ici explique au client pourquoi
 * son abonnement iPhone n'est pas son abonnement Pro — sans dupliquer
 * la moindre règle de droits, et sans JAMAIS additionner les deux :
 * l'un est net de la commission d'Apple, l'autre non.
 */
export type AccountEntitlementSummary = {
  /** Les plans validés par Apple (« premium », « biolab »…). */
  plans: string[];
  /** Le nombre de droits accordés. */
  count: number;
  /** La plus proche échéance, ou null si aucun droit n'expire. */
  expiresAt: string | null;
};

/**
 * Un RÉSUMÉ, et pas la liste.
 *
 * Un abonnement iPhone accorde une vingtaine de droits techniques
 * (`smartIrrigation`, `qrNfc`, `biolabAnalytics`…). Les aligner ici
 * remplirait l'écran d'un vocabulaire qui n'appartient pas à ce
 * produit — §1 « réduire la densité visuelle ». Ce qui compte sur cette
 * page, c'est qu'un abonnement iPhone existe, et qu'il ne finance pas
 * Oasis Care Pro.
 *
 * Renvoie null quand le compte n'a aucun droit : l'écran dit alors la
 * vérité plutôt que d'afficher « 0 droit ».
 */
export async function getAccountEntitlementSummary(
  workspaceId: string,
): Promise<AccountEntitlementSummary | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscription_entitlements")
    .select("plan, expires_at")
    .eq("workspace_id", workspaceId);

  const rows = (data ?? []) as { plan: string; expires_at: string | null }[];
  if (rows.length === 0) return null;

  const expiries = rows
    .map((row) => row.expires_at)
    .filter((value): value is string => value !== null)
    .sort();

  return {
    plans: [...new Set(rows.map((row) => row.plan))].sort(),
    count: rows.length,
    expiresAt: expiries[0] ?? null,
  };
}
