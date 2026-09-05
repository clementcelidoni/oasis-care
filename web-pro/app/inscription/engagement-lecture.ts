import type { SupabaseClient } from "@supabase/supabase-js";
import {
  annoncerEngagement,
  engagementEnCours,
  type AnnonceEngagement,
  type EngagementEnCours,
  type LigneRemise,
  type OffreEngageante,
  type TexteEngagement,
} from "./engagement.ts";

/**
 * §INSCRIPTION — LES LECTURES DE L'ENGAGEMENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CES LECTURES SONT SÉPARÉES DES RÈGLES
 * ══════════════════════════════════════════════════════════════════
 *
 * `engagement.ts` est pur : il tourne des deux côtés et se teste sans
 * base. Ce fichier-ci parle à Postgres, donc il ne tourne qu'au serveur
 * — même découpage que `identite.ts` / `catalogue.ts`.
 *
 * ══════════════════════════════════════════════════════════════════
 * CHAQUE LECTURE PEUT ÉCHOUER, ET AUCUNE NE DOIT FAIRE TOMBER L'ÉCRAN
 * ══════════════════════════════════════════════════════════════════
 *
 * Deux causes, et elles sont toutes les deux normales aujourd'hui :
 *
 *   1. LA MIGRATION 0081 N'EST PAS DÉPLOYÉE. `discount_offers`,
 *      `subscription_discounts` et `subscription_commitment_acceptances`
 *      n'existent pas encore en production (la base est à 0080). Une
 *      requête qui les demande échoue ENTIÈRE.
 *   2. LA POLITIQUE RLS REFUSE. `discount_offers` n'est lisible que par
 *      un administrateur de plateforme (`billing.plans.read`) — voir le
 *      compte rendu : il manque une porte pour le client, et c'est un
 *      point à trancher, pas un bug de ce fichier.
 *
 * Dans les deux cas la lecture rend « rien », et « rien » veut dire
 * « aucun engagement à annoncer ». C'est le comportement SÛR : on
 * n'annonce pas un engagement qu'on n'a pas lu, et on n'exige pas
 * l'acceptation d'un texte qu'on n'a pas pu montrer. Le contraire —
 * bloquer la souscription parce qu'une table manque — punirait le
 * client d'un état du déploiement.
 */

/** La clé sous laquelle vit le texte contractuel courant (0081, § 4.c bis). */
const CLE_TEXTE = "billing.commitment.terms";

/**
 * LE TEXTE COURANT, celui que l'abonné lira et dont on gardera copie.
 *
 * `commercial_config` est lisible par tout compte connecté depuis 0041 :
 * c'est le seul des trois objets de ce fichier qui n'a besoin d'aucune
 * ouverture supplémentaire.
 */
export async function lireTexteEngagement(
  supabase: SupabaseClient,
): Promise<TexteEngagement | null> {
  const { data, error } = await supabase
    .from("commercial_config")
    .select("config_value")
    .eq("config_key", CLE_TEXTE)
    .maybeSingle();

  if (error || data === null) return null;

  const brut = (data as { config_value: unknown }).config_value;
  if (typeof brut !== "object" || brut === null) return null;

  const objet = brut as Record<string, unknown>;
  const version = typeof objet.version === "string" ? objet.version.trim() : "";
  const texte = typeof objet.texte === "string" ? objet.texte.trim() : "";

  // UN TEXTE VIDE N'EST PAS UN TEXTE. La base refuse déjà d'enregistrer
  // une preuve dont le texte est blanc ; on refuse une étape plus tôt,
  // en n'affichant rien, plutôt que de faire cocher une case devant un
  // cadre vide.
  if (version === "" || texte === "") return null;

  return { version, texte };
}

type LigneOffre = {
  code: string;
  label: string;
  kind: string | null;
  value_cents: number | string | null;
  duration_months: number | null;
  applies_to_plan: string | null;
  requires_commitment: boolean | null;
  is_active: boolean | null;
  available_until: string | null;
};

/** Un `bigint` revient parfois en chaîne. `null` reste `null`. */
function centimes(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  const nombre = typeof valeur === "string" ? Number.parseInt(valeur, 10) : valeur;
  return Number.isFinite(nombre) ? nombre : null;
}

/**
 * LES OFFRES QUI ENGAGENT, et rien d'autre.
 *
 * On ne retient que le cas « prix mensuel imposé, offre visée, durée
 * connue » : c'est le seul dont les trois chiffres soient annonçables.
 * Une remise en pourcentage qui engagerait serait écartée ici — et
 * c'est délibéré : son prix pendant se calcule à la facture, donc il ne
 * s'ANNONCE pas, donc il ne peut pas être accepté en connaissance de
 * cause. 0081 rend d'ailleurs le même verdict de son côté.
 *
 * `available_until` borne l'ENTRÉE dans l'offre, pas sa durée : on peut
 * souscrire jusqu'au 31 décembre et garder la remise douze mois après.
 * Une offre dont la porte est fermée ne s'annonce donc plus, même si
 * des abonnés en profitent encore.
 */
export async function lireOffresEngageantes(
  supabase: SupabaseClient,
  leJour: string,
): Promise<OffreEngageante[]> {
  const { data, error } = await supabase
    .from("discount_offers")
    .select(
      "code, label, kind, value_cents, duration_months, applies_to_plan, requires_commitment, is_active, available_until",
    )
    .eq("requires_commitment", true)
    .eq("is_active", true);

  if (error || !data) return [];

  const retenues: OffreEngageante[] = [];
  for (const ligne of data as LigneOffre[]) {
    if (ligne.kind !== "fixedMonthlyPrice") continue;
    if (ligne.applies_to_plan === null) continue;
    if (ligne.duration_months === null || ligne.duration_months < 1) continue;
    if (ligne.available_until !== null && ligne.available_until < leJour) continue;

    const prix = centimes(ligne.value_cents);
    // Un prix inconnu ne devient pas gratuit parce qu'on l'affiche.
    if (prix === null) continue;

    retenues.push({
      code: ligne.code,
      label: ligne.label,
      planKey: ligne.applies_to_plan,
      dureeMois: ligne.duration_months,
      prixPendantHtCents: prix,
    });
  }
  return retenues;
}

/**
 * LES ANNONCES, PRÊTES À AFFICHER, indexées par clé d'offre.
 *
 * Le prix d'APRÈS vient du tarif public de l'offre visée — jamais
 * recopié, donc jamais périmé. `prixPublicParOffre` est fourni par
 * l'appelant, qui a déjà lu le catalogue : une seconde requête sur
 * `organization_plans` aurait divergé de celle du catalogue au premier
 * changement, et l'écran aurait annoncé un prix de retour que la carte
 * d'à côté contredit.
 *
 * DEUX OFFRES ENGAGEANTES SUR LA MÊME OFFRE NE SE CUMULENT PAS : on
 * garde la première lue et on ignore la suivante. Ce cas ne se produit
 * pas aujourd'hui (une seule offre est semée) ; s'il se produisait, en
 * afficher deux ferait choisir le client entre deux engagements dont un
 * seul pourra être posé.
 */
export function annoncesParOffre(
  offresEngageantes: OffreEngageante[],
  prixPublicParOffre: Map<string, number | null>,
): Map<string, AnnonceEngagement> {
  const annonces = new Map<string, AnnonceEngagement>();
  for (const offre of offresEngageantes) {
    if (annonces.has(offre.planKey)) continue;
    const annonce = annoncerEngagement(offre, prixPublicParOffre.get(offre.planKey) ?? null);
    if (annonce !== null) annonces.set(offre.planKey, annonce);
  }
  return annonces;
}

type LigneRemiseBase = {
  code: string | null;
  label: string;
  applies_to_plan: string | null;
  value_cents: number | string | null;
  ends_on: string;
  commitment_ends_on: string | null;
  cancelled_at: string | null;
};

/**
 * L'ENGAGEMENT QUI COURT POUR CETTE ENTREPRISE, ou `null`.
 *
 * `subscription_discounts` est lisible par les membres de l'entreprise
 * depuis 0081 (« Le client voit sa remise ») : c'est la contrepartie de
 * l'engagement, et elle n'a pas eu à être ouverte pour cet écran.
 */
export async function lireEngagementEnCours(
  supabase: SupabaseClient,
  organizationId: string,
  leJour: string,
): Promise<EngagementEnCours | null> {
  const { data, error } = await supabase
    .from("subscription_discounts")
    .select("code, label, applies_to_plan, value_cents, ends_on, commitment_ends_on, cancelled_at")
    .eq("organization_id", organizationId);

  if (error || !data) return null;

  const lignes: LigneRemise[] = (data as LigneRemiseBase[]).map((ligne) => ({
    code: ligne.code,
    label: ligne.label,
    appliesToPlan: ligne.applies_to_plan,
    valueCents: centimes(ligne.value_cents),
    endsOn: ligne.ends_on,
    commitmentEndsOn: ligne.commitment_ends_on,
    cancelledAt: ligne.cancelled_at,
  }));

  return engagementEnCours(lignes, leJour);
}

export type AcceptationEnregistree = {
  accepteLe: string;
  version: string;
  /** La remise acceptée. Sans lui, on ne saurait pas ce qui a été accepté. */
  discountCode: string;
  dureeMois: number;
  prixPendantHtCents: number;
  prixApresHtCents: number;
  planKey: string;
  texte: string;
};

/**
 * LA DERNIÈRE PREUVE ENREGISTRÉE — pour que l'abonné RELISE ce qu'il a
 * accepté.
 *
 * C'est la contrepartie de l'engagement, et 0081 l'a prévue au niveau de
 * la politique RLS : « Le client relit son engagement ». Un contrat
 * qu'on ne peut pas relire n'engage personne de bonne foi.
 */
export async function lireDerniereAcceptation(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<AcceptationEnregistree | null> {
  const { data, error } = await supabase
    .from("subscription_commitment_acceptances")
    .select(
      "accepted_at, terms_version, terms_text, discount_code, commitment_months, monthly_price_during_cents, monthly_price_after_cents, plan_key",
    )
    .eq("organization_id", organizationId)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || data === null) return null;

  const ligne = data as {
    accepted_at: string;
    terms_version: string;
    terms_text: string;
    discount_code: string;
    commitment_months: number;
    monthly_price_during_cents: number | string;
    monthly_price_after_cents: number | string;
    plan_key: string;
  };

  const pendant = centimes(ligne.monthly_price_during_cents);
  const apres = centimes(ligne.monthly_price_after_cents);
  // Les deux colonnes sont NOT NULL en base ; si la conversion échoue,
  // c'est que la ligne est illisible, et une preuve illisible ne
  // s'affiche pas comme une preuve.
  if (pendant === null || apres === null) return null;

  return {
    accepteLe: ligne.accepted_at,
    version: ligne.terms_version,
    discountCode: ligne.discount_code,
    dureeMois: ligne.commitment_months,
    prixPendantHtCents: pendant,
    prixApresHtCents: apres,
    planKey: ligne.plan_key,
    texte: ligne.terms_text,
  };
}
