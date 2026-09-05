/**
 * §STRIPE — LE CATALOGUE, LU UNE SEULE FOIS.
 *
 * Cette lecture existait dans `provider.ts`, à l'intérieur du
 * fournisseur « aucun encaissement ». Elle en sort pour une raison
 * simple : deux fournisseurs (celui qui n'encaisse rien, celui qui
 * encaisse) doivent montrer EXACTEMENT le même catalogue. Deux requêtes
 * séparées auraient divergé au premier ajout de colonne, et le client
 * aurait vu deux prix selon l'écran.
 *
 * CE QUE LA LECTURE D'ORIGINE IGNORAIT, et qui manque pour vendre :
 * `yearly_price_cents` (impossible de proposer l'annuel sans lui),
 * `is_quote_only` (Enterprise apparaissait comme souscriptible),
 * `included_seats` et `extra_seat_monthly_price_cents` (le siège
 * supplémentaire), `price_floor_cents` (le « à partir de 249 € HT »).
 *
 * TOUS LES MONTANTS SONT HORS TAXES. C'est la règle de la grille, et
 * l'affichage doit le dire : un prix hors taxes montré sans sa mention à
 * un professionnel est une pratique trompeuse.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Un forfait, tel qu'il est ENREGISTRÉ.
 *
 * §"Noms configurables. NE PAS figer définitivement ces noms." — d'où
 * `key: string` et aucune énumération : renommer « Team » en « Équipe »
 * se fait par un `update`, pas par un déploiement.
 */
export type OrganizationPlan = {
  key: string;
  name: string;
  tagline: string | null;
  features: string[];
  /** HORS TAXES. `null` = pas de prix mensuel public (offre sur devis, ou non fixé). */
  monthlyPriceCents: number | null;
  /** HORS TAXES. `null` = pas de tarif annuel : l'annuel ne se propose alors pas. */
  yearlyPriceCents: number | null;
  /** Indication d'affichage héritée de 0060. Ce n'est PAS le seuil de facturation. */
  maxUsers: number | null;
  /** Le seuil de FACTURATION des sièges. `null` = non décidé, et non « zéro ». */
  includedSeats: number | null;
  seatPolicy: "hardCap" | "billedBeyondIncluded";
  /** HORS TAXES, par mois. Le siège supplémentaire n'a pas de prix annuel décidé. */
  extraSeatMonthlyPriceCents: number | null;
  /** Cette offre ne se souscrit pas en ligne : elle se construit sur devis. */
  isQuoteOnly: boolean;
  /** Le plancher affiché (« à partir de … »), pour les offres sur devis. */
  priceFloorCents: number | null;
  currency: string;
  position: number;
};

type LignePlan = {
  key: string;
  name: string;
  tagline: string | null;
  features: unknown;
  monthly_price_cents: number | string | null;
  yearly_price_cents: number | string | null;
  max_users: number | null;
  included_seats: number | null;
  seat_policy: string | null;
  extra_seat_monthly_price_cents: number | string | null;
  is_quote_only: boolean | null;
  price_floor_cents: number | string | null;
  currency: string | null;
  position: number;
};

/**
 * PostgREST rend le jsonb déjà désérialisé, mais rien ne garantit sa
 * FORME : une ligne saisie à la main dans l'éditeur SQL peut contenir
 * autre chose qu'un tableau de chaînes, et un forfait ne doit pas
 * disparaître de l'écran pour ça.
 */
function toFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Un `bigint` revient parfois en chaîne. `null` reste `null` : un prix
 * inconnu ne devient pas gratuit parce qu'on l'a converti.
 */
function centimes(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  const nombre = typeof valeur === "string" ? Number.parseInt(valeur, 10) : valeur;
  return Number.isFinite(nombre) ? nombre : null;
}

const COLONNES_PLAN =
  "key, name, tagline, features, monthly_price_cents, yearly_price_cents, max_users, included_seats, seat_policy, extra_seat_monthly_price_cents, is_quote_only, price_floor_cents, currency, position";

/**
 * Les colonnes que 0081 ajoute n'existent pas tant que la migration
 * n'est pas déployée. Une requête qui les demande échoue alors ENTIÈRE
 * — catalogue vide, écran d'abonnement muet. On retente donc avec le
 * jeu de colonnes de 0060 : le catalogue reste affichable, sans annuel
 * ni sièges, et c'est exactement l'état du produit avant 0081.
 */
const COLONNES_PLAN_AVANT_0081 =
  "key, name, tagline, features, monthly_price_cents, max_users, position";

export async function lirePlansActifs(supabase: SupabaseClient): Promise<OrganizationPlan[]> {
  const { data, error } = await supabase
    .from("organization_plans")
    .select(COLONNES_PLAN)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) {
    const { data: repli } = await supabase
      .from("organization_plans")
      .select(COLONNES_PLAN_AVANT_0081)
      .eq("is_active", true)
      .order("position", { ascending: true });
    return ((repli ?? []) as LignePlan[]).map(versPlan);
  }

  return ((data ?? []) as LignePlan[]).map(versPlan);
}

function versPlan(ligne: LignePlan): OrganizationPlan {
  return {
    key: ligne.key,
    name: ligne.name,
    tagline: ligne.tagline,
    features: toFeatures(ligne.features),
    monthlyPriceCents: centimes(ligne.monthly_price_cents),
    yearlyPriceCents: centimes(ligne.yearly_price_cents),
    maxUsers: ligne.max_users,
    includedSeats: ligne.included_seats ?? null,
    seatPolicy: ligne.seat_policy === "hardCap" ? "hardCap" : "billedBeyondIncluded",
    extraSeatMonthlyPriceCents: centimes(ligne.extra_seat_monthly_price_cents),
    isQuoteOnly: ligne.is_quote_only === true,
    priceFloorCents: centimes(ligne.price_floor_cents),
    currency: ligne.currency ?? "EUR",
    position: ligne.position,
  };
}
