/**
 * §STRIPE — L'ABONNEMENT EN COURS, lu une seule fois.
 *
 * Extrait de `provider.ts` pour la même raison que le catalogue : les
 * deux fournisseurs doivent lire l'abonnement de la même façon. Une
 * seconde requête aurait fini par retomber sur un défaut différent, et
 * l'écran aurait dit « actif » là où la caisse disait « résilié ».
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Les valeurs de la colonne `provider` (migration 0060). */
export type BillingProviderId = "none" | "web" | "apple" | "manual";

/** Les valeurs de la colonne `status` (migration 0060). */
export type SubscriptionStatus = "trialing" | "active" | "pastDue" | "cancelled";

export type OrganizationSubscription = {
  planKey: string;
  provider: BillingProviderId;
  status: SubscriptionStatus;
  startedAt: string;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  /**
   * LES TROIS COLONNES QUE L'ÉCRAN DE CONFIRMATION LISAIT À PART.
   *
   * Il en avait besoin pour dire « votre essai finit le 6 octobre, la
   * première facture part ce jour-là, puis chaque mois à la même
   * date », et faisait donc SA PROPRE requête sur la même table. Deux
   * lectures d'un même contrat finissent par ne plus dire la même
   * chose ; celle-ci est désormais la seule.
   */
  billingCycle: "monthly" | "yearly";
  trialEndsAt: string | null;
  /** La fin de période au format date (0089), à défaut l'horodatage. */
  currentPeriodEndOn: string | null;
};

type LigneAbonnement = {
  plan: string;
  provider: string;
  status: string;
  started_at: string;
  current_period_end: string | null;
  cancelled_at: string | null;
  billing_cycle: string | null;
  trial_ends_at: string | null;
  current_period_end_on: string | null;
};

const PROVIDER_IDS: BillingProviderId[] = ["none", "web", "apple", "manual"];
const STATUSES: SubscriptionStatus[] = ["trialing", "active", "pastDue", "cancelled"];

export async function lireAbonnement(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<OrganizationSubscription | null> {
  const { data } = await supabase
    .from("organization_subscriptions")
    // UNE SEULE CHAÎNE LITTÉRALE, PAS UNE CONCATÉNATION : le typage de
    // supabase-js LIT cette chaîne pour déduire la forme de la ligne.
    // Découpée sur deux lignes avec un `+`, elle n'est plus un littéral
    // et le résultat retombe sur un type d'erreur générique.
    .select("plan, provider, status, started_at, current_period_end, cancelled_at, billing_cycle, trial_ends_at, current_period_end_on")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!data) return null;
  const ligne = data as LigneAbonnement;

  // Les contraintes `check` de la table garantissent déjà ces valeurs.
  // On retombe malgré tout sur un défaut plutôt que de laisser passer
  // une chaîne inconnue : l'écran s'en sert pour choisir une couleur, et
  // une teinte manquante casserait la page entière.
  const provider = PROVIDER_IDS.find((id) => id === ligne.provider) ?? "none";
  const status = STATUSES.find((valeur) => valeur === ligne.status) ?? "trialing";

  return {
    planKey: ligne.plan,
    provider,
    status,
    startedAt: ligne.started_at,
    currentPeriodEnd: ligne.current_period_end,
    cancelledAt: ligne.cancelled_at,
    // Le mensuel est le défaut de la colonne comme du produit : une
    // valeur inconnue ne doit pas faire annoncer un engagement d'un an.
    billingCycle: ligne.billing_cycle === "yearly" ? "yearly" : "monthly",
    trialEndsAt: ligne.trial_ends_at,
    currentPeriodEndOn: ligne.current_period_end_on,
  };
}
