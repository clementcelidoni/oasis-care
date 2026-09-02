import { createClient } from "@/lib/supabase/server";

/**
 * §16 BILLING — « Créer abstraction BillingProvider. Prévoir
 * WebBillingProvider, AppleBillingProvider. Réutiliser le système
 * d'entitlements existant de Phase 12. NE PAS créer un deuxième moteur
 * commercial. »
 *
 * Ce fichier définit l'INTERFACE que devront remplir un encaissement
 * web et un achat In-App, et une seule implémentation : celle qui
 * décrit la réalité d'aujourd'hui — aucun fournisseur de paiement n'est
 * branché. Écrire dès maintenant un `WebBillingProvider` vide donnerait
 * un objet qui ment sur ce qu'il sait faire ; le jour où Stripe (ou
 * autre) sera configuré, il naîtra avec ses clés, son webhook et ses
 * tests, pas avant.
 *
 * §"Si aucun fournisseur de paiement web réel configuré : ne pas
 * simuler une transaction." D'où `unavailableReason` : l'écran ne
 * devine pas si le tunnel de paiement est jouable, il demande au
 * fournisseur, et affiche la phrase que celui-ci renvoie.
 *
 * Pourquoi PAS un deuxième moteur commercial : la Phase 12 accorde des
 * droits à un COMPTE (`subscription_entitlements`, validés par Apple).
 * Oasis Care Pro se vend à une ENTREPRISE. On ajoute donc l'échelle
 * manquante — `organization_subscriptions` — et on se contente de LIRE
 * les entitlements existants (voir `getAccountEntitlements`), sans
 * jamais les recalculer ni les réécrire ici.
 */

/** Les valeurs de la colonne `provider` (migration 0060). */
export type BillingProviderId = "none" | "web" | "apple" | "manual";

/** Les valeurs de la colonne `status` (migration 0060). */
export type SubscriptionStatus = "trialing" | "active" | "pastDue" | "cancelled";

/**
 * Un forfait, tel qu'il est ENREGISTRÉ.
 *
 * §"Noms configurables. NE PAS figer définitivement ces noms." — il n'y
 * a donc volontairement aucune énumération `"solo" | "team" | …` dans ce
 * fichier : `key` est un `string`, et renommer « Team » en « Équipe » se
 * fait par un `update`, pas par un déploiement.
 */
export type OrganizationPlan = {
  key: string;
  name: string;
  tagline: string | null;
  features: string[];
  monthlyPriceCents: number | null;
  /** null = pas de plafond d'utilisateurs sur ce forfait. */
  maxUsers: number | null;
  position: number;
};

export type OrganizationSubscription = {
  planKey: string;
  provider: BillingProviderId;
  status: SubscriptionStatus;
  startedAt: string;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
};

export type CheckoutIntent = {
  organizationId: string;
  planKey: string;
};

/**
 * Ce que produit une tentative de souscription.
 *
 * `unavailable` n'est pas une erreur : c'est l'état normal tant qu'aucun
 * encaissement n'existe. Le distinguer d'un échec évite qu'un écran
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
   * d'entrée du tunnel. Aucun appelant aujourd'hui : l'écran n'affiche
   * pas de bouton tant que `unavailableReason` n'est pas null, et c'est
   * exactement ce que demande la spec.
   */
  startCheckout(intent: CheckoutIntent): Promise<CheckoutOutcome>;
}

/**
 * Les lignes brutes de `organization_plans`. PostgREST renvoie le jsonb
 * déjà désérialisé, mais rien ne garantit sa FORME : une ligne saisie à
 * la main dans l'éditeur SQL peut contenir autre chose qu'un tableau de
 * chaînes, et un forfait ne doit pas disparaître de l'écran pour ça.
 */
type PlanRow = {
  key: string;
  name: string;
  tagline: string | null;
  features: unknown;
  monthly_price_cents: number | null;
  max_users: number | null;
  position: number;
};

function toFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

type SubscriptionRow = {
  plan: string;
  provider: string;
  status: string;
  started_at: string;
  current_period_end: string | null;
  cancelled_at: string | null;
};

const PROVIDER_IDS: BillingProviderId[] = ["none", "web", "apple", "manual"];
const STATUSES: SubscriptionStatus[] = ["trialing", "active", "pastDue", "cancelled"];

/**
 * L'état réel : rien n'encaisse.
 *
 * Ce fournisseur sait tout lire — les forfaits, l'abonnement en cours —
 * et refuse la seule chose qu'il ne sait pas faire. C'est ce qui permet
 * à l'écran d'être complet et honnête en même temps : on montre le
 * forfait actuel et le catalogue, on n'ouvre pas une caisse vide.
 */
class UnconfiguredBillingProvider implements BillingProvider {
  readonly id = "none" as const;
  readonly label = "Aucun encaissement configuré";
  readonly unavailableReason =
    "Aucun moyen de paiement n'est branché sur Oasis Care Pro. Tant que ce n'est pas le cas, cet écran ne peut pas enregistrer de changement de forfait.";

  async listPlans(): Promise<OrganizationPlan[]> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organization_plans")
      .select("key, name, tagline, features, monthly_price_cents, max_users, position")
      .eq("is_active", true)
      .order("position", { ascending: true });

    return ((data ?? []) as PlanRow[]).map((row) => ({
      key: row.key,
      name: row.name,
      tagline: row.tagline,
      features: toFeatures(row.features),
      monthlyPriceCents: row.monthly_price_cents,
      maxUsers: row.max_users,
      position: row.position,
    }));
  }

  async getSubscription(organizationId: string): Promise<OrganizationSubscription | null> {
    const supabase = await createClient();
    const { data } = await supabase
      .from("organization_subscriptions")
      .select("plan, provider, status, started_at, current_period_end, cancelled_at")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!data) return null;
    const row = data as SubscriptionRow;

    // Les contraintes `check` de la table garantissent déjà ces valeurs.
    // On retombe malgré tout sur un défaut plutôt que de laisser passer
    // une chaîne inconnue : l'écran s'en sert pour choisir une couleur,
    // et une teinte manquante casserait la page entière.
    const provider = PROVIDER_IDS.find((id) => id === row.provider) ?? "none";
    const status = STATUSES.find((value) => value === row.status) ?? "trialing";

    return {
      planKey: row.plan,
      provider,
      status,
      startedAt: row.started_at,
      currentPeriodEnd: row.current_period_end,
      cancelledAt: row.cancelled_at,
    };
  }

  async startCheckout(intent: CheckoutIntent): Promise<CheckoutOutcome> {
    // §"ne pas simuler une transaction" : pas d'écriture, pas de faux
    // succès, pas de page de confirmation. On renvoie la raison, telle
    // quelle, et l'appelant l'affiche.
    void intent;
    return { kind: "unavailable", reason: this.unavailableReason };
  }
}

const unconfigured = new UnconfiguredBillingProvider();

/**
 * Le fournisseur actif.
 *
 * C'est ici — et nulle part ailleurs — que se fera le choix le jour où
 * un encaissement existera : lire la configuration, rendre le
 * `WebBillingProvider` s'il est complet, l'`AppleBillingProvider` quand
 * la souscription vient de l'app iPhone. Les écrans, eux, ne changeront
 * pas : ils parlent déjà à l'interface.
 */
export function getBillingProvider(): BillingProvider {
  return unconfigured;
}

/**
 * §16 « Réutiliser le système d'entitlements existant de Phase 12. »
 *
 * Lecture seule, et volontairement. Ces lignes sont écrites par la
 * fonction Edge qui vérifie les notifications Apple (migration 0041) et
 * par elle seule ; la politique RLS ne rend visibles que celles de
 * l'utilisateur connecté. Les afficher ici explique au client pourquoi
 * son abonnement iPhone n'est pas son abonnement Pro — sans dupliquer
 * la moindre règle de droits.
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
