/**
 * §STRIPE — LA SOURCE RÉELLE : ce que la BASE dit.
 *
 * L'implémentation de `SourceFacturation` qui lit la production. Elle ne
 * décide rien : elle rapporte. Toute la règle — la matrice, les sièges,
 * la remise, le refus de deviner — vit dans `composition.ts`, qui la
 * teste contre une source en mémoire.
 *
 * ══════════════════════════════════════════════════════════════════
 * ELLE LIT SOUS LE JETON DE L'UTILISATEUR, ET C'EST VOULU
 * ══════════════════════════════════════════════════════════════════
 *
 * Aucune clé de service ici. Les quatre lectures passent par la RLS :
 *
 *   • `organization_plans`                  — « tout compte connecté » (0060) ;
 *   • `organization_members`                — les membres de son entreprise (0043) ;
 *   • `organization_subscription_modules`   — « l'entreprise et les habilités » (0081) ;
 *   • `subscription_discounts`              — « le client voit sa remise » (0081) ;
 *   • `billing_provider_price_terms()`      — `execute` accordé à `authenticated` (0083),
 *     et la fonction est `security definer` précisément pour que cette
 *     route n'ait pas besoin d'une clé de service pour lire un prix.
 *
 * Une entreprise ne peut donc pas composer la souscription d'une autre :
 * ce n'est pas ce fichier qui l'empêche, c'est la base.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DemandeTermes,
  ModePrestataire,
  OffreLue,
  RemiseLue,
  SourceFacturation,
  TermesTarif,
} from "./composition";

/** La clé du prestataire dans `billing_providers` (0083). */
export const PRESTATAIRE_STRIPE = "stripe";

type LigneOffre = {
  key: string;
  name: string;
  is_active: boolean;
  is_quote_only: boolean;
  monthly_price_cents: number | null;
  yearly_price_cents: number | null;
  included_seats: number | null;
  seat_policy: string;
  extra_seat_monthly_price_cents: number | null;
  price_floor_cents: number | null;
  currency: string | null;
};

type LigneRemise = {
  code: string | null;
  label: string;
  kind: string;
  value_cents: number | null;
  percent: number | null;
  starts_on: string;
  ends_on: string;
};

type LigneTermes = {
  provider_price_id: string | null;
  provider_product_id: string | null;
  our_amount_cents: number | null;
  mapped_amount_cents: number | null;
  currency: string | null;
  blocking_reason: string | null;
};

/**
 * `numeric` et `bigint` reviennent de PostgREST en `string` dès qu'ils
 * dépassent ce qu'un JSON sait porter sans perte. Un `Number()` direct
 * sur `null` rendrait `0` — c'est-à-dire un prix inconnu transformé en
 * gratuit. On rend donc `null` tel quel, et on ne coalesce JAMAIS.
 */
function centimes(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  const nombre = typeof valeur === "string" ? Number.parseInt(valeur, 10) : valeur;
  return Number.isFinite(nombre) ? nombre : null;
}

export class SourceFacturationSupabase implements SourceFacturation {
  readonly #supabase: SupabaseClient;
  readonly #mode: ModePrestataire;
  readonly #prestataire: string;

  constructor(
    supabase: SupabaseClient,
    mode: ModePrestataire,
    prestataire: string = PRESTATAIRE_STRIPE,
  ) {
    this.#supabase = supabase;
    this.#mode = mode;
    this.#prestataire = prestataire;
  }

  async lireOffre(planKey: string): Promise<OffreLue | null> {
    const { data } = await this.#supabase
      .from("organization_plans")
      .select(
        "key, name, is_active, is_quote_only, monthly_price_cents, yearly_price_cents, included_seats, seat_policy, extra_seat_monthly_price_cents, price_floor_cents, currency",
      )
      .eq("key", planKey)
      .maybeSingle();

    if (!data) return null;
    const ligne = data as LigneOffre;

    return {
      key: ligne.key,
      name: ligne.name,
      isActive: ligne.is_active,
      isQuoteOnly: ligne.is_quote_only,
      monthlyPriceCents: centimes(ligne.monthly_price_cents),
      yearlyPriceCents: centimes(ligne.yearly_price_cents),
      includedSeats: ligne.included_seats,
      // La contrainte `organization_plans_seat_policy_valid` garantit
      // ces deux valeurs. On retombe malgré tout sur la plus PRUDENTE :
      // `billedBeyondIncluded` bloque quand le seuil est inconnu, là où
      // `hardCap` laisserait passer sans rien facturer.
      seatPolicy: ligne.seat_policy === "hardCap" ? "hardCap" : "billedBeyondIncluded",
      extraSeatMonthlyPriceCents: centimes(ligne.extra_seat_monthly_price_cents),
      priceFloorCents: centimes(ligne.price_floor_cents),
      currency: ligne.currency ?? "EUR",
    };
  }

  /**
   * Les SIÈGES, et non l'effectif.
   *
   * `organization_employee_count()` retombe sur
   * `employee_count_override`, un nombre déclaratif que le dirigeant
   * saisit pour son tableau de bord. Facturer dessus ferait payer
   * quarante licences à un paysagiste qui a quarante salariés et trois
   * comptes. Un siège, c'est un compte qui se connecte.
   */
  async compterSieges(organizationId: string): Promise<number> {
    const { count, error } = await this.#supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("archived_at", null);

    if (error || count === null) {
      // On ne rend PAS zéro : zéro siège ferait passer la souscription
      // sans aucune ligne de siège, et le client paierait trop peu sans
      // que personne ne le voie. Lever fait remonter le problème.
      throw new Error(
        "Le nombre d'utilisateurs de l'entreprise n'a pas pu être lu : la souscription ne peut pas être composée sans lui.",
      );
    }
    return count;
  }

  async lireModulesSouscrits(organizationId: string): Promise<string[]> {
    const { data } = await this.#supabase
      .from("organization_subscription_modules")
      .select("module_key")
      .eq("organization_id", organizationId)
      .is("cancelled_at", null);

    return ((data ?? []) as { module_key: string }[]).map((ligne) => ligne.module_key);
  }

  async lireRemiseActive(organizationId: string, leJour: string): Promise<RemiseLue | null> {
    // `[starts_on, ends_on)` — même intervalle semi-ouvert que le
    // `daterange(…, '[)')` de `saas_subscription_billing_lines`. Le jour
    // de fin N'EST PAS couvert : deux règles d'intervalle différentes
    // pour le même objet feraient diverger l'encaissement de la facture
    // exactement un jour par an.
    const { data } = await this.#supabase
      .from("subscription_discounts")
      .select("code, label, kind, value_cents, percent, starts_on, ends_on")
      .eq("organization_id", organizationId)
      .is("cancelled_at", null)
      .lte("starts_on", leJour)
      .gt("ends_on", leJour)
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    const ligne = data as LigneRemise;

    const kind =
      ligne.kind === "fixedMonthlyPrice" || ligne.kind === "percentOff" || ligne.kind === "amountOff"
        ? ligne.kind
        : null;
    if (kind === null) {
      // Une nature inconnue n'est pas « pas de remise » : c'est une
      // remise qu'on ne sait pas appliquer. La signaler comme telle
      // fait refuser la souscription plus loin, au lieu d'encaisser le
      // tarif plein à quelqu'un qui a une remise.
      return {
        code: ligne.code,
        label: ligne.label,
        kind: "amountOff",
        valueCents: null,
        percent: null,
        startsOn: ligne.starts_on,
        endsOn: ligne.ends_on,
      };
    }

    return {
      code: ligne.code,
      label: ligne.label,
      kind,
      valueCents: centimes(ligne.value_cents),
      percent: ligne.percent,
      startsOn: ligne.starts_on,
      endsOn: ligne.ends_on,
    };
  }

  async termesTarif(demande: DemandeTermes): Promise<TermesTarif> {
    const { data, error } = await this.#supabase.rpc("billing_provider_price_terms", {
      p_provider: this.#prestataire,
      p_mode: this.#mode,
      p_kind: demande.kind,
      p_plan_key: demande.planKey ?? null,
      p_billing_cycle: demande.billingCycle,
      p_module_key: demande.moduleKey ?? null,
      p_discount_code: demande.discountCode ?? null,
    });

    if (error) {
      // La fonction de 0083 NE LÈVE JAMAIS ; une erreur ici est donc un
      // problème de droits ou de réseau, pas un cas commercial. On rend
      // un blocage plutôt qu'une exception, pour que l'écran affiche une
      // phrase au lieu d'une page d'erreur.
      return {
        providerPriceId: null,
        providerProductId: null,
        ourAmountCents: null,
        mappedAmountCents: null,
        currency: null,
        blockingReason: "providerPriceMissing",
      };
    }

    const lignes = (data ?? []) as LigneTermes[];
    const ligne = lignes[0];
    if (!ligne) {
      return {
        providerPriceId: null,
        providerProductId: null,
        ourAmountCents: null,
        mappedAmountCents: null,
        currency: null,
        blockingReason: "providerPriceMissing",
      };
    }

    return {
      providerPriceId: ligne.provider_price_id,
      providerProductId: ligne.provider_product_id,
      ourAmountCents: centimes(ligne.our_amount_cents),
      mappedAmountCents: centimes(ligne.mapped_amount_cents),
      currency: ligne.currency,
      blockingReason: ligne.blocking_reason,
    };
  }
}
