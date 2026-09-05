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
};

type LigneAbonnement = {
  plan: string;
  provider: string;
  status: string;
  started_at: string;
  current_period_end: string | null;
  cancelled_at: string | null;
};

const PROVIDER_IDS: BillingProviderId[] = ["none", "web", "apple", "manual"];
const STATUSES: SubscriptionStatus[] = ["trialing", "active", "pastDue", "cancelled"];

export async function lireAbonnement(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<OrganizationSubscription | null> {
  const { data } = await supabase
    .from("organization_subscriptions")
    .select("plan, provider, status, started_at, current_period_end, cancelled_at")
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
  };
}
