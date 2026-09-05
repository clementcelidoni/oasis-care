import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { lirePlansActifs, type OrganizationPlan } from "@/lib/billing/plans";
import type { CycleFacturation } from "@/lib/billing/provider";
import type { BusinessType } from "@/lib/auth/permissions";
import {
  economieAnnuelle,
  formaterHt,
  formaterHtParPeriode,
  optionAffichable,
  recommanderOffre,
  type ModuleDansOffre,
  type OptionAffichable,
  type Recommandation,
} from "./grille.ts";

/**
 * §INSCRIPTION — LA GRILLE, LUE EN BASE ET JAMAIS CODÉE EN DUR.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE SEULE SOURCE POUR LES PRIX
 * ══════════════════════════════════════════════════════════════════
 *
 * Les offres et leurs montants viennent de `lirePlansActifs()`
 * (`lib/billing/plans.ts`) — la MÊME lecture que celle du fournisseur
 * d'encaissement. Une seconde requête écrite ici aurait divergé au
 * premier ajout de colonne, et le client aurait vu un prix à
 * l'inscription et un autre au moment de payer.
 *
 * CE FICHIER N'AJOUTE QUE CE QUE CETTE LECTURE-LÀ NE PORTE PAS :
 *   • le BADGE de la grille (`bestSeller` / `new`), colonne posée par
 *     0081 mais pas encore relue par `plans.ts` ;
 *   • la MATRICE offre × module (`platform_modules` × `plan_modules`),
 *     dont l'écran d'inscription a besoin pour montrer ce qui est
 *     compris et ce qui coûte en plus.
 * Les deux requêtes portent sur des colonnes DISJOINTES de celles de
 * `plans.ts` : aucune valeur n'est lue deux fois, donc aucune ne peut
 * diverger. (Voir le compte rendu : le badge a vocation à rejoindre
 * `plans.ts`, ce fichier appartenant à un autre chantier en cours.)
 *
 * ══════════════════════════════════════════════════════════════════
 * 0081 N'EST PAS ENCORE DÉPLOYÉE, ET CE FICHIER DOIT SURVIVRE À ÇA
 * ══════════════════════════════════════════════════════════════════
 *
 * `platform_modules`, `plan_modules` et la colonne `badge` n'existent
 * pas tant que la migration 0081 n'est pas appliquée — et elle ne l'est
 * pas à ce jour (la production est à 0080). Une requête qui les demande
 * échoue ALORS ENTIÈRE, et un écran d'inscription muet vaut une
 * inscription perdue.
 *
 * Chaque lecture retombe donc sur du vide plutôt que de lever : sans
 * matrice, la grille s'affiche sans ses options ; sans badge, aucune
 * offre n'est mise en avant. C'est exactement l'état du produit avant
 * 0081, et il reste utilisable.
 *
 * NOTE DE NOMMAGE : les variables de boucle s'appellent `mod` et non
 * `module`. Ce n'est pas une préférence — `module` est un identifiant
 * réservé par CommonJS, et la règle `no-assign-module-variable` de Next
 * le refuse.
 */

// ------------------------------------------------------------------
// Ce que l'écran reçoit
// ------------------------------------------------------------------

export type OffreAffichable = {
  offre: OrganizationPlan;
  badge: "bestSeller" | "new" | null;

  /** Prêts à afficher, mention « HT » comprise. Rien à calculer à l'écran. */
  prixMensuel: string | null;
  prixAnnuel: string | null;
  /** « À partir de 249,00 € HT / mois » pour les offres sur devis. */
  prixPlancher: string | null;
  /** La phrase d'économie de l'annuel, ou null s'il n'y a rien à annoncer. */
  economieAnnuelle: string | null;

  /** Les modules COMPRIS, avec leur nom lisible. */
  modulesCompris: { key: string; name: string }[];

  /**
   * LES DEUX CYCLES SONT PRÉPARÉS D'AVANCE, et c'est délibéré.
   *
   * Basculer « au mois / à l'année » change le prix de chaque option, et
   * un module peut être vendable au mois et pas à l'année (le tarif
   * annuel n'est pas arrêté partout). Le navigateur ne doit pour autant
   * RIEN recalculer : il reçoit les deux jeux tout faits et se contente
   * de choisir lequel afficher. Deux arrondis vaudraient deux montants.
   */
  optionsParCycle: Record<CycleFacturation, OptionAffichable[]>;

  /** L'annuel se propose-t-il ? Faux quand aucun tarif annuel n'est posé. */
  annuelDisponible: boolean;
  /** Cette offre se souscrit-elle en ligne ? Faux pour les offres sur devis. */
  souscriptibleEnLigne: boolean;
};

export type Catalogue = {
  offres: OffreAffichable[];
  /** Vrai quand AUCUNE offre ne porte de prix : la grille n'est pas encore posée. */
  aucunPrix: boolean;
  /** Vrai quand la matrice n'a pas pu être lue (0081 non déployée). */
  matriceIndisponible: boolean;
  /** L'offre mise en avant pour le métier de l'entreprise, ou null. */
  recommandation: Recommandation | null;
};

// ------------------------------------------------------------------
// Les lectures
// ------------------------------------------------------------------

type LigneBadge = { key: string; badge: string | null };

/**
 * Les badges, isolés dans leur propre requête.
 *
 * POURQUOI SÉPARÉMENT ET NON EN AJOUTANT UNE COLONNE À `plans.ts` : ce
 * fichier-là appartient à un autre chantier en cours, et le modifier
 * écraserait un travail à moitié écrit. La requête est donc posée ici,
 * bornée aux deux colonnes qui manquent, et le compte rendu demande sa
 * fusion à l'intégration.
 */
async function lireBadges(supabase: SupabaseClient): Promise<Map<string, "bestSeller" | "new">> {
  const { data, error } = await supabase
    .from("organization_plans")
    .select("key, badge")
    .eq("is_active", true);

  // La colonne n'existe pas avant 0081 : aucune offre n'est mise en
  // avant, et c'est tout. Ce n'est pas une panne.
  if (error || !data) return new Map();

  const badges = new Map<string, "bestSeller" | "new">();
  for (const ligne of data as LigneBadge[]) {
    if (ligne.badge === "bestSeller" || ligne.badge === "new") badges.set(ligne.key, ligne.badge);
  }
  return badges;
}

type LigneModule = {
  key: string;
  name: string;
  tagline: string | null;
  is_delivered: boolean | null;
  pricing_model: string | null;
  metered_unit: string | null;
  position: number;
};

type LigneCase = {
  plan_key: string;
  module_key: string;
  availability: string | null;
  monthly_price_cents: number | string | null;
  yearly_price_cents: number | string | null;
};

/** Un `bigint` revient parfois en chaîne. `null` reste `null`. */
function centimes(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  const nombre = typeof valeur === "string" ? Number.parseInt(valeur, 10) : valeur;
  return Number.isFinite(nombre) ? nombre : null;
}

function modeleTarifaire(valeur: string | null): "flat" | "metered" | "commission" {
  return valeur === "metered" || valeur === "commission" ? valeur : "flat";
}

function disponibilite(valeur: string | null): ModuleDansOffre["disponibilite"] {
  // « undecided » est le défaut de la base, et c'est le bon défaut ici
  // aussi : une case inconnue BLOQUE, elle ne se comporte ni comme
  // incluse ni comme indisponible.
  return valeur === "included" || valeur === "optional" || valeur === "unavailable"
    ? valeur
    : "undecided";
}

export type Matrice = {
  /** Pour une offre donnée, l'état de chaque module du catalogue. */
  parOffre: Map<string, ModuleDansOffre[]>;
  /** Le nom lisible de chaque module, pour écrire des phrases. */
  noms: Record<string, string>;
  /** Vrai quand la matrice n'a pas pu être lue du tout. */
  indisponible: boolean;
};

export async function lireMatrice(
  supabase: SupabaseClient,
  clesDOffres: string[],
): Promise<Matrice> {
  const vide: Matrice = { parOffre: new Map(), noms: {}, indisponible: true };
  if (clesDOffres.length === 0) return { ...vide, indisponible: false };

  const [catalogue, cases] = await Promise.all([
    supabase
      .from("platform_modules")
      .select("key, name, tagline, is_delivered, pricing_model, metered_unit, position")
      .order("position", { ascending: true }),
    supabase
      .from("plan_modules")
      .select("plan_key, module_key, availability, monthly_price_cents, yearly_price_cents")
      .in("plan_key", clesDOffres),
  ]);

  if (catalogue.error || !catalogue.data) return vide;

  const modules = catalogue.data as LigneModule[];
  const noms: Record<string, string> = {};
  for (const mod of modules) noms[mod.key] = mod.name;

  // La table des cases peut manquer là où le catalogue existe : on
  // continue avec des cases vides, qui valent « non décidé » — et « non
  // décidé » bloque, ce qui est le comportement sûr.
  const parCase = new Map<string, LigneCase>();
  for (const ligne of (cases.data ?? []) as LigneCase[]) {
    parCase.set(`${ligne.plan_key} ${ligne.module_key}`, ligne);
  }

  const parOffre = new Map<string, ModuleDansOffre[]>();
  for (const cle of clesDOffres) {
    parOffre.set(
      cle,
      modules.map((mod) => {
        const caseMatrice = parCase.get(`${cle} ${mod.key}`);
        return {
          key: mod.key,
          name: mod.name,
          tagline: mod.tagline,
          disponibilite: disponibilite(caseMatrice?.availability ?? null),
          livre: mod.is_delivered === true,
          modeleTarifaire: modeleTarifaire(mod.pricing_model),
          uniteComptee: mod.metered_unit,
          prixMensuelHtCents: centimes(caseMatrice?.monthly_price_cents),
          prixAnnuelHtCents: centimes(caseMatrice?.yearly_price_cents),
        } satisfies ModuleDansOffre;
      }),
    );
  }

  return { parOffre, noms, indisponible: false };
}

// ------------------------------------------------------------------
// L'assemblage
// ------------------------------------------------------------------

/**
 * LE CATALOGUE, PRÊT À AFFICHER.
 *
 * Tout ce qui ressemble à un calcul est fait ici, au serveur : la
 * conversion des centimes, l'économie de l'annuel, le prix de chaque
 * option pour chacun des deux cycles. Le navigateur ne reçoit que des
 * chaînes et des booléens.
 *
 * `metier` est FACULTATIF : l'écran d'abonnement d'une entreprise le
 * connaît, une grille montrée hors contexte non. Sans lui, aucune offre
 * n'est recommandée — et la grille complète reste affichée, ce qui est
 * l'issue correcte.
 */
export async function lireCatalogue(
  options: {
    metier?: BusinessType;
    libelleMetier?: string;
    supabase?: SupabaseClient;
  } = {},
): Promise<Catalogue> {
  const supabase = options.supabase ?? (await createClient());

  const offres = await lirePlansActifs(supabase);
  const cles = offres.map((offre) => offre.key);

  const [badges, matrice] = await Promise.all([lireBadges(supabase), lireMatrice(supabase, cles)]);

  const affichables: OffreAffichable[] = offres.map((offre) => {
    const modules = matrice.parOffre.get(offre.key) ?? [];
    // On n'affiche pas les cases « indisponible » : une liste de ce
    // qu'on ne vend pas n'apprend rien à personne et allonge l'écran.
    const affichables = modules.filter((mod) => mod.disponibilite !== "unavailable");
    const economie = economieAnnuelle(offre.monthlyPriceCents, offre.yearlyPriceCents);

    return {
      offre,
      badge: badges.get(offre.key) ?? null,

      prixMensuel: formaterHtParPeriode(offre.monthlyPriceCents, "monthly"),
      prixAnnuel: formaterHtParPeriode(offre.yearlyPriceCents, "yearly"),
      prixPlancher:
        offre.isQuoteOnly && offre.priceFloorCents !== null
          ? `À partir de ${formaterHt(offre.priceFloorCents)} / mois`
          : null,
      economieAnnuelle: economie?.phrase ?? null,

      modulesCompris: modules
        .filter((mod) => mod.disponibilite === "included")
        .map((mod) => ({ key: mod.key, name: mod.name })),

      optionsParCycle: {
        monthly: affichables.map((mod) => optionAffichable(mod, "monthly")),
        yearly: affichables.map((mod) => optionAffichable(mod, "yearly")),
      },

      annuelDisponible: offre.yearlyPriceCents !== null,
      souscriptibleEnLigne: !offre.isQuoteOnly && offre.monthlyPriceCents !== null,
    } satisfies OffreAffichable;
  });

  const recommandation =
    options.metier === undefined
      ? null
      : recommanderOffre(
          options.metier,
          options.libelleMetier ?? options.metier,
          affichables.map((a) => ({
            key: a.offre.key,
            name: a.offre.name,
            monthlyPriceCents: a.offre.monthlyPriceCents,
            isQuoteOnly: a.offre.isQuoteOnly,
            badge: a.badge,
            modulesCompris: a.modulesCompris.map((m) => m.key),
          })),
          matrice.noms,
        );

  return {
    offres: affichables,
    // « Aucun prix » n'est pas « catalogue vide » : les offres existent,
    // c'est la grille tarifaire qui n'est pas encore posée.
    aucunPrix:
      affichables.length > 0 && affichables.every((a) => a.offre.monthlyPriceCents === null),
    matriceIndisponible: matrice.indisponible,
    recommandation,
  };
}
