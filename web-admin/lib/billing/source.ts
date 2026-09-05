import "server-only";

import { createClient } from "@/lib/supabase/server";
import { AdminAccessDenied, AdminReadFailed } from "@/lib/customers/errors";

import type {
  Entreprise,
  EtatFacture,
  LigneAbonnement,
  LigneAvoir,
  LigneCalculee,
  LigneCase,
  LigneCredit,
  LigneDeFacture,
  LigneEmetteur,
  LigneEncaissement,
  LigneEvenementAbonnement,
  LigneFacture,
  LigneModule,
  LigneModuleSouscrit,
  LigneOffre,
  LigneOffreDeRemise,
  LigneRemise,
  MentionsFacture,
  RegimeTvaClient,
} from "./types.ts";

/**
 * ==================================================================
 * D'OÙ VIENNENT LES PRIX, LES ABONNEMENTS ET LES FACTURES
 * ==================================================================
 *
 * TOUT PAR LA SESSION DE L'ADMINISTRATEUR — `createClient()` de
 * `lib/supabase/server.ts` —, jamais par `service_role`.
 *
 * Ce n'est pas une préférence : c'est ce qui rend le contrôle d'accès
 * vérifiable. `platform_admin_can('billing.plans.read')` est évalué
 * DANS PostgreSQL, à chaque ligne, par les politiques de 0081. Une clé
 * de service contournerait la RLS — donc aussi les erreurs de
 * raisonnement de ce fichier —, et le seul contrôle restant serait une
 * ligne de TypeScript qu'un remaniement peut déplacer.
 *
 * `import "server-only"` rend la chose mécanique : un composant client
 * qui importerait ce module ne compilerait pas, au lieu de fuir dans le
 * paquet du navigateur avec les prix, les SIRET et les factures.
 *
 * ------------------------------------------------------------------
 * LE PIÈGE DE CE MODULE : LA RLS NE LÈVE PAS, ELLE REND ZÉRO LIGNE
 * ------------------------------------------------------------------
 * Un `select` qu'aucune politique n'autorise ne produit AUCUNE erreur :
 * il rend une liste vide, et l'écran affirme « aucun abonnement ». Ce
 * mode de défaillance est réel ici, et il a un nom précis : après 0081,
 * `organization_subscriptions` ne porte plus qu'une seule politique de
 * lecture, « Members read their subscription ». Un administrateur de
 * plateforme n'est membre d'AUCUNE entreprise — il ne voit donc RIEN.
 *
 * Voir `lireAbonnements()` : ce module ne se contente pas de rendre la
 * liste, il la COMPARE au nombre d'entreprises qui portent un forfait
 * d'après `admin_list_organizations()` (fonction `security definer`,
 * qui traverse les organisations). L'écart est affiché. C'est la seule
 * façon de distinguer « personne n'est abonné » — vrai aujourd'hui — de
 * « je n'ai pas le droit de le voir ».
 */

// ------------------------------------------------------------------
// La traduction des refus
// ------------------------------------------------------------------

/**
 * `PGRST205` / `42P01` : la table n'existe pas. `42703` : la colonne
 * n'existe pas. Les deux disent la même chose — 0081 n'est pas
 * appliquée — et c'est une cause bien plus probable qu'un bug.
 */
function traduire(nom: string, error: { message: string; code?: string }): never {
  if (error.code === "42501") throw new AdminAccessDenied(error.message);
  if (error.code === "PGRST205" || error.code === "42P01" || error.code === "42703") {
    throw new AdminReadFailed(
      `${nom} : ${error.message}. La migration 0081_control_center_suite.sql n'est probablement ` +
        "pas appliquée — ou le cache de schéma de PostgREST n'a pas encore été rechargé.",
    );
  }
  throw new AdminReadFailed(`${nom} : ${error.message} (${error.code ?? "sans code"}).`);
}

function lignes<T>(data: unknown): T[] {
  return (Array.isArray(data) ? data : []) as T[];
}

// ------------------------------------------------------------------
// 1. La grille
// ------------------------------------------------------------------

const COLONNES_OFFRE =
  "key, name, tagline, features, monthly_price_cents, yearly_price_cents, currency, " +
  "is_quote_only, price_floor_cents, max_users, included_seats, seat_policy, " +
  "extra_seat_monthly_price_cents, ai_monthly_quota, storage_gb, badge, position, is_active, " +
  "updated_at, updated_by";

/**
 * Toutes les offres, INACTIVES COMPRISES.
 *
 * `nursery` est désactivée par 0081 — sa promesse est devenue le module
 * Pépinière — mais une entreprise peut encore y être abonnée, et son
 * abonnement doit rester lisible. Masquer les offres inactives ferait
 * apparaître des abonnements sur une offre sans nom.
 */
export async function lireOffres(): Promise<LigneOffre[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_plans")
    .select(COLONNES_OFFRE)
    .order("position", { ascending: true });

  if (error) traduire("organization_plans", error);
  return lignes<LigneOffre>(data);
}

export async function lireModules(): Promise<LigneModule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_modules")
    .select("key, name, tagline, is_delivered, pricing_model, metered_unit, position, note")
    .order("position", { ascending: true });

  if (error) traduire("platform_modules", error);
  return lignes<LigneModule>(data);
}

export async function lireMatrice(): Promise<LigneCase[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("plan_modules")
    .select(
      "plan_key, module_key, availability, monthly_price_cents, yearly_price_cents, metered_unit_price_cents, updated_at",
    );

  if (error) traduire("plan_modules", error);
  return lignes<LigneCase>(data);
}

export async function lireOffresDeRemise(): Promise<LigneOffreDeRemise[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discount_offers")
    .select("code, label, kind, value_cents, percent, duration_months, is_active, available_until, note")
    .order("code", { ascending: true });

  if (error) traduire("discount_offers", error);
  return lignes<LigneOffreDeRemise>(data);
}

// ------------------------------------------------------------------
// 2. L'émetteur
// ------------------------------------------------------------------

export async function lireEmetteur(): Promise<LigneEmetteur | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saas_billing_issuer")
    .select(
      "legal_name, legal_form, siret, siren, vat_number, rcs_city, share_capital_cents, " +
        "address_line1, address_line2, postal_code, city, country, email, phone, website, " +
        "iban, bic, bank_name, payment_terms_days, late_penalty_terms, recovery_indemnity_cents, " +
        "invoice_footer, updated_at",
    )
    .limit(1);

  if (error) traduire("saas_billing_issuer", error);
  const liste = lignes<LigneEmetteur>(data);
  return liste[0] ?? null;
}

/**
 * Ce qui manque à l'émetteur pour qu'une facture puisse partir.
 *
 * On demande la liste À LA BASE (`saas_billing_issuer_missing_fields()`)
 * plutôt que de la recalculer ici. Deux règles de complétude
 * concurrentes finiraient par diverger, et c'est celle de la base qui
 * refuse réellement l'émission : l'écran doit dire exactement ce que la
 * fonction d'émission vérifiera, pas ce qu'un développeur croyait
 * qu'elle vérifiait.
 */
export async function lireChampsManquantsEmetteur(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("saas_billing_issuer_missing_fields");
  if (error) traduire("saas_billing_issuer_missing_fields", error);
  return Array.isArray(data) ? (data as string[]) : [];
}

/** Le nom français de chaque champ manquant. La base rend des noms de colonne. */
export const LIBELLES_CHAMPS_EMETTEUR: Record<string, string> = {
  legal_name: "Raison sociale",
  siret: "SIRET",
  vat_number: "Numéro de TVA intracommunautaire",
  address_line1: "Adresse",
  postal_code: "Code postal",
  city: "Ville",
  iban: "IBAN",
  late_penalty_terms: "Clause de pénalités de retard",
};

// ------------------------------------------------------------------
// 3. Les entreprises
// ------------------------------------------------------------------

const TAILLE_PAGE = 200;
const PAGES_MAX = 5;

type LigneOrganisation = {
  organization_id: string;
  name: string;
  legal_name: string | null;
  siret: string | null;
  country: string | null;
  plan: string | null;
  subscription_status: string | null;
  archived_at: string | null;
  total_count: number;
};

/**
 * Les entreprises, par `admin_list_organizations()`.
 *
 * POURQUOI PAS `lib/ia/source.ts`, QUI A DÉJÀ CETTE FONCTION. Parce que
 * la sienne ne rend que ce dont les écrans IA ont besoin — nom,
 * requêtes du mois, forfait — et qu'ici il faut le SIRET, le pays et le
 * statut d'abonnement, qui décident du régime de TVA et de ce qu'on
 * peut facturer. Élargir son type ferait payer aux écrans IA des
 * colonnes qui ne les regardent pas ; les deux appels partagent la
 * fonction SQL, qui est ce qui compte.
 */
export type ListeEntreprises = {
  entreprises: Entreprise[];
  total: number | null;
  /** Vrai si la borne de pages a été atteinte : la liste est incomplète, et l'écran le dit. */
  tronquee: boolean;
};

export async function listerEntreprises(): Promise<ListeEntreprises> {
  const supabase = await createClient();
  const entreprises: Entreprise[] = [];
  let total: number | null = null;

  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const { data, error } = await supabase.rpc("admin_list_organizations", {
      p_search: null,
      p_filter: "toutes",
      p_page: page,
      p_page_size: TAILLE_PAGE,
    });

    if (error) {
      if (error.code === "42501") throw new AdminAccessDenied(error.message);
      throw new AdminReadFailed(
        `admin_list_organizations : ${error.message} (${error.code ?? "sans code"}).`,
      );
    }

    const brut = lignes<LigneOrganisation>(data);
    for (const ligne of brut) {
      entreprises.push({
        id: ligne.organization_id,
        nom: ligne.name,
        plan: ligne.plan ?? null,
        statutAbonnement: ligne.subscription_status ?? null,
        pays: ligne.country ?? null,
        siret: ligne.siret ?? null,
        // `admin_list_organizations` ne rend pas le numéro de TVA : il
        // se lit sur la fiche, où il compte. On ne le devine pas ici.
        numeroTva: null,
        archiveeLe: ligne.archived_at ?? null,
      });
      total = ligne.total_count;
    }

    if (brut.length < TAILLE_PAGE) return { entreprises, total, tronquee: false };
  }

  return { entreprises, total, tronquee: true };
}

/**
 * Une entreprise par son identifiant.
 *
 * ON RELIT L'IDENTIFIANT RENDU au lieu de prendre la première ligne :
 * la recherche de `admin_list_organizations` est un `or` de plusieurs
 * branches — nom, raison sociale, SIRET, identifiant — et un uuid est
 * plein de chiffres. Prendre `[0]` pourrait afficher les abonnements
 * d'une AUTRE entreprise.
 */
export async function trouverEntreprise(organizationId: string): Promise<Entreprise | null> {
  const liste = await listerEntreprises();
  return liste.entreprises.find((e) => e.id === organizationId) ?? null;
}

// ------------------------------------------------------------------
// 4. Les abonnements
// ------------------------------------------------------------------

const COLONNES_ABONNEMENT =
  "organization_id, plan, provider, status, started_at, current_period_end, cancelled_at, " +
  "external_reference, updated_at, billing_cycle, negotiated_monthly_price_cents, " +
  "negotiated_yearly_price_cents, billable_extra_seats, trial_ends_at, cancel_at_period_end, " +
  "currency, note, managed_by";

/**
 * L'ÉCART DE LECTURE, MESURÉ PLUTÔT QUE SUBI.
 *
 * 0081 pose « Les habilités lisent les abonnements »
 * (`billing.subscriptions.read`) et cette lecture doit donc marcher.
 * Elle est néanmoins instrumentée, parce que le mode de défaillance est
 * SILENCIEUX : sans cette politique, il ne restait que « Members read
 * their subscription », et un administrateur de plateforme n'étant
 * membre d'aucune entreprise cliente, le `select` rendait ZÉRO LIGNE
 * alors que des abonnements existaient — sans erreur, sans code, sans
 * rien.
 *
 * Et le piège était complet : le super-administrateur de production EST
 * membre de l'unique entreprise. L'écran marchait donc parfaitement chez
 * celui qui le testait, et restait vide chez le `billing_admin`, dont
 * c'est le métier. C'est la défaillance qui ne se voit que chez
 * quelqu'un d'autre, et c'est pour elle que ce garde-fou reste.
 *
 * On rend donc TROIS informations et pas une :
 *   `abonnements`  ce qu'on a pu lire ;
 *   `attendus`     combien d'entreprises portent un forfait d'après
 *                  `admin_list_organizations()`, qui est `security
 *                  definer` et traverse les organisations ;
 *   `manquants`    la différence, qui n'est pas un vide mais un refus.
 */
export type LectureAbonnements = {
  abonnements: LigneAbonnement[];
  attendus: number;
  manquants: number;
};

export async function lireAbonnements(
  entreprises: readonly Entreprise[],
): Promise<LectureAbonnements> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_subscriptions")
    .select(COLONNES_ABONNEMENT);

  if (error) traduire("organization_subscriptions", error);

  const abonnements = lignes<LigneAbonnement>(data);
  const attendus = entreprises.filter((e) => e.plan !== null).length;

  return {
    abonnements,
    attendus,
    manquants: Math.max(attendus - abonnements.length, 0),
  };
}

export async function lireAbonnement(organizationId: string): Promise<LigneAbonnement | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_subscriptions")
    .select(COLONNES_ABONNEMENT)
    .eq("organization_id", organizationId)
    .limit(1);

  if (error) traduire("organization_subscriptions", error);
  return lignes<LigneAbonnement>(data)[0] ?? null;
}

export async function lireModulesSouscrits(
  organizationId: string,
): Promise<LigneModuleSouscrit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_subscription_modules")
    .select("organization_id, module_key, activated_at, cancelled_at, note")
    .eq("organization_id", organizationId);

  if (error) traduire("organization_subscription_modules", error);
  return lignes<LigneModuleSouscrit>(data);
}

export async function lireRemises(organizationId: string): Promise<LigneRemise[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscription_discounts")
    .select(
      "id, organization_id, code, label, kind, value_cents, percent, starts_on, ends_on, reason, cancelled_at, created_at",
    )
    .eq("organization_id", organizationId)
    .order("starts_on", { ascending: false });

  if (error) traduire("subscription_discounts", error);
  return lignes<LigneRemise>(data);
}

export async function lireCredits(organizationId: string): Promise<LigneCredit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saas_account_credits")
    .select(
      "id, organization_id, amount_cents, currency, reason, granted_at, consumed_at, consumed_invoice_id, cancelled_at",
    )
    .eq("organization_id", organizationId)
    .order("granted_at", { ascending: false });

  if (error) traduire("saas_account_credits", error);
  return lignes<LigneCredit>(data);
}

/**
 * L'historique, en ajout seul.
 *
 * C'est la table que 0081 pose pour rendre le churn calculable un jour :
 * `organization_subscriptions` ayant `organization_id` pour clé
 * primaire, elle ne porte AUCUNE trace des changements d'offre. Elle
 * est vide aujourd'hui, et ce vide-là est vrai : il se remplira au
 * premier geste administratif.
 */
export async function lireHistoriqueAbonnement(
  organizationId: string,
  limite = 50,
): Promise<LigneEvenementAbonnement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_subscription_events")
    .select(
      "id, organization_id, event, plan_before, plan_after, status_before, status_after, " +
        "old_value, new_value, actor_user_id, reason, occurred_at",
    )
    .eq("organization_id", organizationId)
    .order("occurred_at", { ascending: false })
    .limit(limite);

  if (error) traduire("organization_subscription_events", error);
  return lignes<LigneEvenementAbonnement>(data);
}

/**
 * Le régime de TVA d'un client, tel que la base le tranche.
 *
 * ON NE LE CALCULE PAS ICI, ET C'EST LA RÈGLE LA PLUS IMPORTANTE DE CE
 * FICHIER. Le régime décide du taux, donc du montant d'un document
 * comptable. Une seconde règle en TypeScript finirait par diverger de
 * celle qui refuse réellement l'émission, et l'écran promettrait alors
 * une facture que la base rejette — ou pire, l'inverse.
 */
export async function lireRegimeTva(organizationId: string): Promise<RegimeTvaClient | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("saas_vat_regime", {
    p_organization_id: organizationId,
  });

  if (error) traduire("saas_vat_regime", error);
  return lignes<RegimeTvaClient>(data)[0] ?? null;
}

/**
 * Ce qu'un abonnement doit pour une période — la PRÉVISION.
 *
 * Cette fonction ne lève jamais : elle rend des lignes dont certaines
 * portent un `blocking_reason`. C'est ce qui permet à l'écran de
 * montrer la facture qu'on ne peut pas émettre, avec la raison en face
 * de la ligne fautive.
 */
export async function lireLignesCalculees(
  organizationId: string,
  debut: string,
  fin: string,
): Promise<LigneCalculee[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("saas_subscription_billing_lines", {
    p_organization_id: organizationId,
    p_period_start: debut,
    p_period_end: fin,
  });

  if (error) traduire("saas_subscription_billing_lines", error);
  return lignes<LigneCalculee>(data);
}

// ------------------------------------------------------------------
// 5. Les factures SaaS
// ------------------------------------------------------------------

const COLONNES_FACTURE =
  "id, organization_id, number, status, period_start, period_end, billing_cycle, issued_on, " +
  "due_on, issued_at, currency, vat_regime, vat_rate, vat_note, payment_method, " +
  "payment_reference, external_payment_reference, cancelled_at, cancellation_reason, " +
  "internal_notes, created_at";

const COLONNES_MENTIONS =
  "issuer_legal_name, issuer_legal_form, issuer_siret, issuer_vat_number, issuer_rcs_city, " +
  "issuer_share_capital_cents, issuer_address, issuer_email, issuer_iban, issuer_bic, " +
  "issuer_late_penalty_terms, issuer_recovery_indemnity_cents, issuer_footer, " +
  "customer_name, customer_legal_name, customer_legal_form, customer_siret, " +
  "customer_vat_number, customer_address, customer_country, customer_email";

const COLONNES_ETAT =
  "invoice_id, organization_id, number, stored_status, effective_status, due_on, days_late, " +
  "total_including_vat_cents, paid_cents, credited_cents, outstanding_cents";

/**
 * La liste des factures, chacune avec son ÉTAT EFFECTIF.
 *
 * Deux lectures et une jointure en mémoire, plutôt qu'une seule requête.
 * PostgREST ne sait pas joindre une vue à sa table sans relation
 * déclarée, et surtout : `saas_invoice_state` est la SEULE source du
 * statut « en retard », qui est calculé. Recopier sa logique dans le
 * `select` de la table reviendrait à en écrire une seconde version.
 */
export type FactureAvecEtat = LigneFacture & { etat: EtatFacture | null };

/**
 * LA LISTE, ET CE QU'ELLE NE MONTRE PAS.
 *
 * Une lecture est BORNÉE — 200 documents par défaut — et une somme
 * calculée sur une liste bornée n'est pas un total. La page additionnait
 * `outstanding_cents` sur ce seul échantillon et l'affichait « Restant
 * dû » : au 201ᵉ document, le chiffre serait devenu faux sans le dire,
 * dans un écran qui applique par ailleurs à la lettre la règle « une
 * somme partielle se lirait comme un total » — mais pour la TVA
 * seulement.
 *
 * Le seuil est proche : une facture par mois et par client, 200
 * documents, c'est dix-sept clients au bout d'un an.
 *
 * On rend donc le COMPTE EXACT à côté des lignes. L'appelant compare, et
 * quand la liste est tronquée il affiche INCONNU avec son motif au lieu
 * d'une somme partielle.
 */
export type LectureFactures = {
  factures: FactureAvecEtat[];
  /** Le nombre TOTAL de factures correspondant au filtre, borne comprise. */
  total: number;
  /** `true` dès qu'une facture existe hors de la page lue. */
  tronquee: boolean;
};

export async function listerFactures(options?: {
  organizationId?: string;
  limite?: number;
}): Promise<LectureFactures> {
  const supabase = await createClient();
  const limite = options?.limite ?? 200;

  let requete = supabase
    .from("saas_invoices")
    .select(COLONNES_FACTURE, { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limite);

  if (options?.organizationId) requete = requete.eq("organization_id", options.organizationId);

  const { data, error, count } = await requete;
  if (error) traduire("saas_invoices", error);

  const factures = lignes<LigneFacture>(data);
  // `count` peut être nul si PostgREST ne l'a pas rendu ; dans ce cas on
  // ne prétend pas connaître le total, et on considère la liste comme
  // tronquée dès qu'elle atteint la borne — le doute va vers « INCONNU ».
  const total = count ?? factures.length;
  const tronquee = count === null ? factures.length >= limite : count > factures.length;

  if (factures.length === 0) return { factures: [], total, tronquee: false };

  const { data: etats, error: erreurEtat } = await supabase
    .from("saas_invoice_state")
    .select(COLONNES_ETAT)
    .in(
      "invoice_id",
      factures.map((f) => f.id),
    );

  if (erreurEtat) traduire("saas_invoice_state", erreurEtat);

  const index = new Map(lignes<EtatFacture>(etats).map((e) => [e.invoice_id, e]));
  return {
    factures: factures.map((facture) => ({ ...facture, etat: index.get(facture.id) ?? null })),
    total,
    tronquee,
  };
}

export type FactureComplete = {
  facture: LigneFacture & MentionsFacture;
  etat: EtatFacture | null;
  lignes: LigneDeFacture[];
  encaissements: LigneEncaissement[];
  avoirs: LigneAvoir[];
};

export async function lireFacture(invoiceId: string): Promise<FactureComplete | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("saas_invoices")
    .select(`${COLONNES_FACTURE}, ${COLONNES_MENTIONS}`)
    .eq("id", invoiceId)
    .limit(1);

  if (error) traduire("saas_invoices", error);
  const facture = lignes<LigneFacture & MentionsFacture>(data)[0];
  if (facture === undefined) return null;

  const [etat, corps, encaissements, avoirs] = await Promise.all([
    supabase.from("saas_invoice_state").select(COLONNES_ETAT).eq("invoice_id", invoiceId).limit(1),
    supabase
      .from("saas_invoice_lines")
      .select(
        "id, invoice_id, position, kind, module_key, description, quantity, unit_price_cents, vat_rate, blocking_reason, total_cents",
      )
      .eq("invoice_id", invoiceId)
      .order("position", { ascending: true }),
    supabase
      .from("saas_invoice_payments")
      .select("id, invoice_id, amount_cents, received_on, method, external_reference, note, created_at")
      .eq("invoice_id", invoiceId)
      .order("received_on", { ascending: true }),
    supabase
      .from("saas_credit_notes")
      .select("id, invoice_id, organization_id, number, reason, issued_on, created_at")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true }),
  ]);

  if (etat.error) traduire("saas_invoice_state", etat.error);
  if (corps.error) traduire("saas_invoice_lines", corps.error);
  if (encaissements.error) traduire("saas_invoice_payments", encaissements.error);
  if (avoirs.error) traduire("saas_credit_notes", avoirs.error);

  return {
    facture,
    etat: lignes<EtatFacture>(etat.data)[0] ?? null,
    lignes: lignes<LigneDeFacture>(corps.data),
    encaissements: lignes<LigneEncaissement>(encaissements.data),
    avoirs: lignes<LigneAvoir>(avoirs.data),
  };
}
