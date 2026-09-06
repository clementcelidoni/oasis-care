/**
 * §7 « statistiques » — LES CHIFFRES DU LABORATOIRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA RÈGLE QUI COMMANDE CE FICHIER : UNE SEULE DÉFINITION PAR TAUX
 * ══════════════════════════════════════════════════════════════════
 *
 * Un taux de contamination calculé dans le navigateur et un autre
 * calculé en base finissent toujours par différer — et le jour où ils
 * diffèrent, personne ne sait lequel croire. Ce fichier tient donc deux
 * moitiés, et rien d'autre ne calcule de taux dans le module :
 *
 *   • LES TAUX QUE 0087 PORTE EN SQL sont LUS, jamais recalculés :
 *     `biolab_statistiques_especes` et
 *     `biolab_statistiques_bioreacteurs` ici,
 *     `biolab_tableau_de_bord` dans le socle (`cultures.ts`), qui le
 *     lisait déjà — un second lecteur pour la même fonction, ce
 *     seraient deux formes de résultat et deux arrondis. Ces fonctions
 *     reprennent `BioLabDashboardService` et `BioLabAnalyticsService`
 *     du téléphone. Le web les appelle et affiche ce qu'elles rendent.
 *
 *   • LES TAUX QUE 0087 NE PORTE PAS — la performance par VERSION DE
 *     RECETTE (`BioLabKnowledgeEngine`) et la ventilation des
 *     contaminations par axe — n'existent dans aucune fonction SQL. Ils
 *     sont donc définis ICI, une fois, et importés par
 *     `protocoles.ts` et `contaminations.ts`. Ces deux fichiers ne
 *     divisent jamais rien eux-mêmes.
 *
 * `statistiques.test.ts` relit `0087_biolab_pro.sql` et échoue si la
 * définition SQL et celle d'ici cessent de dire la même chose. C'est la
 * seule façon d'empêcher la dérive, puisque le TypeScript ne peut pas
 * lire une fonction Postgres.
 *
 * LE JOUR OÙ UNE FONCTION SQL COUVRIRA LA PERFORMANCE PAR VERSION, la
 * moitié TypeScript devra être SUPPRIMÉE, pas doublée.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { observer, severiteAtteinte, type TauxObserve } from "./referentiel.ts";

// ==================================================================
// 0. Ce qu'on lit en base
// ==================================================================

/** Le sous-ensemble de `culture_batches` dont les taux ont besoin. */
export type LigneLot = {
  id: string;
  batch_code: string;
  species_name: string;
  cultivar: string | null;
  status: string;
  culture_stage: string;
  initial_explant_count: number | null;
  current_count: number | null;
  medium_recipe_version_id: string | null;
  started_at: string | null;
};

/** Le sous-ensemble de `bioreactor_inspections`. */
export type LigneInspection = {
  id: string;
  culture_batch_id: string | null;
  bioreactor_id: string | null;
  date: string;
  culture_appearance: string;
  contamination_status: string;
  hyperhydricity_status: string;
  necrosis_status: string;
  browning_status: string;
  growth_status: string;
  estimated_count: number | null;
  notes: string;
};

/** Le sous-ensemble d'`acclimatization_batches`. */
export type LigneAcclimatation = {
  id: string;
  culture_batch_id: string | null;
  initial_plantlet_count: number | null;
  current_survivor_count: number | null;
};

export const COLONNES_LOT =
  "id, batch_code, species_name, cultivar, status, culture_stage, initial_explant_count, current_count, medium_recipe_version_id, started_at";

export const COLONNES_INSPECTION =
  "id, culture_batch_id, bioreactor_id, date, culture_appearance, contamination_status, hyperhydricity_status, necrosis_status, browning_status, growth_status, estimated_count, notes";

export const COLONNES_ACCLIMATATION =
  "id, culture_batch_id, initial_plantlet_count, current_survivor_count";

/**
 * Une lecture, réussie ou non.
 *
 * LE CONTRAT EST DÉSORMAIS AU SOCLE (`cultures.ts`) et réexporté ici.
 * Il n'y était pas au départ, et c'est ce qui a créé l'écart : la
 * moitié des fichiers du module portait un canal d'erreur, l'autre
 * moitié — celle du socle, donc les écrans les plus regardés —
 * transformait chaque échec en liste vide, et chaque liste vide en
 * affirmation. Un seul contrat, un seul endroit.
 *
 * 0087 n'est pas encore appliquée à la production : un appel à
 * `biolab_tableau_de_bord` y répond aujourd'hui HTTP 404, « la fonction
 * n'existe pas ». Une page qui laisserait remonter l'exception
 * afficherait une page d'erreur Next à quelqu'un dont le laboratoire va
 * très bien. Elle doit au contraire dire ce qui manque, à l'endroit où
 * le chiffre aurait dû être.
 */
export type { Lecture } from "./cultures.ts";
import type { Lecture } from "./cultures.ts";
import { echecDeLecture as echec } from "./cultures.ts";

// ==================================================================
// 1. Les définitions — le seul endroit où l'on divise
// ==================================================================

/**
 * Les stades qui valent « enraciné ou plus loin ».
 *
 * Recopié de `BioLabAnalyticsService` et de 0087 §4.2, qui écrivent la
 * même liste. Le module n'a aucun signal « enracinement tenté et
 * échoué » : ce taux dit donc « combien de lots ont ATTEINT
 * l'enracinement », pas « combien ont réussi à s'enraciner ». La nuance
 * est portée par le libellé des écrans.
 */
export const STADES_ENRACINES = ["rooting", "preAcclimatization", "acclimatization", "completed"] as const;

/**
 * CONTAMINÉ = AU MOINS UNE INSPECTION CONFIRMÉE.
 *
 * `suspected` ne compte pas, et c'est la décision la plus importante de
 * ce fichier. `ContaminationStatus` du téléphone porte la même règle en
 * commentaire (« ne jamais demander à l'IA de déclarer automatiquement
 * une contamination comme certitude ») : une suspicion est une
 * inquiétude, pas un fait. La compter gonflerait le taux d'une
 * certitude que le produit n'a pas — et c'est ce taux qui décide de
 * jeter un lot.
 */
export function estContaminationConfirmee(inspection: LigneInspection): boolean {
  return inspection.contamination_status === "confirmed";
}

export function lotContamine(lotId: string, inspections: readonly LigneInspection[]): boolean {
  return inspections.some((i) => i.culture_batch_id === lotId && estContaminationConfirmee(i));
}

/** Hyperhydrique = au moins une inspection à une sévérité constatée. */
export function lotHyperhydrique(lotId: string, inspections: readonly LigneInspection[]): boolean {
  return inspections.some((i) => i.culture_batch_id === lotId && severiteAtteinte(i.hyperhydricity_status));
}

/**
 * Le rendement de multiplication moyen d'un groupe de lots.
 *
 * Moyenne des rapports `compte actuel / explants de départ`, sur les
 * seuls lots qui ont un compte de départ. `null` — jamais 0 — quand
 * aucun ne l'a : « je ne sais pas multiplier » et « ça ne multiplie
 * pas » sont deux affirmations différentes, et l'une des deux est
 * fausse.
 */
export function multiplicationMoyenne(lots: readonly LigneLot[]): number | null {
  const rapports = lots
    .filter((l) => (l.initial_explant_count ?? 0) > 0)
    .map((l) => (l.current_count ?? 0) / (l.initial_explant_count as number));
  if (rapports.length === 0) return null;
  return rapports.reduce((somme, r) => somme + r, 0) / rapports.length;
}

/**
 * La survie moyenne en acclimatation des lots donnés.
 *
 * Même forme que 0087 §4.2 : moyenne des `survivants / plantules de
 * départ` des acclimatations rattachées à ces lots.
 */
export function survieMoyenne(
  lots: readonly LigneLot[],
  acclimatations: readonly LigneAcclimatation[],
): number | null {
  const identifiants = new Set(lots.map((l) => l.id));
  const taux = acclimatations
    .filter((a) => a.culture_batch_id !== null && identifiants.has(a.culture_batch_id))
    .filter((a) => (a.initial_plantlet_count ?? 0) > 0)
    .map((a) => (a.current_survivor_count ?? 0) / (a.initial_plantlet_count as number));
  if (taux.length === 0) return null;
  return taux.reduce((somme, t) => somme + t, 0) / taux.length;
}

/**
 * Les cinq indicateurs observés d'un groupe de lots.
 *
 * C'est la brique unique : `protocoles.ts` l'appelle par version de
 * recette, `contaminations.ts` par espèce, par milieu, par bioréacteur
 * ou par rack. Aucun des deux ne refait l'arithmétique.
 *
 * Les dénominateurs suivent EXACTEMENT 0087 §4.2, y compris là où ils
 * diffèrent entre eux : contamination et hyperhydricité se comptent sur
 * TOUS les lots du groupe, l'enracinement sur les seuls lots encore en
 * jeu (un lot écarté n'avait plus à s'enraciner, l'inclure ferait
 * baisser le taux pour une raison étrangère à l'enracinement).
 */
export type IndicateursGroupe = {
  lots: number;
  contamination: TauxObserve;
  hyperhydricite: TauxObserve;
  enracinement: TauxObserve;
  multiplication: number | null;
  survie: number | null;
};

export function indicateursDuGroupe(
  lots: readonly LigneLot[],
  inspections: readonly LigneInspection[],
  acclimatations: readonly LigneAcclimatation[],
): IndicateursGroupe {
  const contamines = lots.filter((l) => lotContamine(l.id, inspections)).length;
  const hyperhydriques = lots.filter((l) => lotHyperhydrique(l.id, inspections)).length;

  const enJeu = lots.filter((l) => l.status !== "discarded");
  const enracines = enJeu.filter((l) =>
    (STADES_ENRACINES as readonly string[]).includes(l.culture_stage),
  ).length;

  return {
    lots: lots.length,
    contamination: observer(contamines, lots.length),
    hyperhydricite: observer(hyperhydriques, lots.length),
    enracinement: observer(enracines, enJeu.length),
    multiplication: multiplicationMoyenne(lots),
    survie: survieMoyenne(lots, acclimatations),
  };
}

// ==================================================================
// 2. Les lectures brutes, pour les groupements
// ==================================================================

export async function lireMatiere(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<
  Lecture<{
    lots: LigneLot[];
    inspections: LigneInspection[];
    acclimatations: LigneAcclimatation[];
  }>
> {
  const vide = { lots: [], inspections: [], acclimatations: [] };

  // Le filtre par espace est une CEINTURE, pas la serrure : la RLS a
  // déjà tranché sous le jeton de l'utilisateur. Il évite simplement de
  // rapatrier les lignes d'un autre espace dont on serait aussi membre
  // — le dirigeant l'est de son espace personnel ET de celui de son
  // entreprise, et mélanger les deux ferait un taux faux.
  const [reponseLots, reponseInspections, reponseAcclimatations] = await Promise.all([
    supabase.from("culture_batches").select(COLONNES_LOT).eq("workspace_id", workspaceId),
    supabase.from("bioreactor_inspections").select(COLONNES_INSPECTION).eq("workspace_id", workspaceId),
    supabase.from("acclimatization_batches").select(COLONNES_ACCLIMATATION).eq("workspace_id", workspaceId),
  ]);

  const erreur =
    reponseLots.error?.message ??
    reponseInspections.error?.message ??
    reponseAcclimatations.error?.message ??
    null;
  if (erreur) return echec(vide, erreur);

  return {
    donnees: {
      lots: (reponseLots.data ?? []) as unknown as LigneLot[],
      inspections: (reponseInspections.data ?? []) as unknown as LigneInspection[],
      acclimatations: (reponseAcclimatations.data ?? []) as unknown as LigneAcclimatation[],
    },
    erreur: null,
  };
}

// ==================================================================
// 3. Les lectures SQL de 0087
// ==================================================================

/**
 * LE TABLEAU DE BORD N'EST PAS LU ICI.
 *
 * `biolab_tableau_de_bord` a déjà son unique lecteur dans le socle du
 * module (`cultures.lireTableauDeBord`). Deux lecteurs pour une même
 * fonction SQL, ce sont deux formes de résultat et, tôt ou tard, deux
 * façons d'arrondir : l'écran des statistiques importe donc celui du
 * socle plutôt que d'en poser un second.
 *
 * Les deux lectures ci-dessous, elles, n'existent nulle part ailleurs.
 */

/** Ce que rend `biolab_statistiques_especes` (0087 §4.2). */
export type StatistiqueEspece = {
  espece: string;
  lots: number;
  /**
   * Combien de ces lots ont au moins une inspection. Le dénominateur
   * des taux reste `lots` — un lot jamais regardé compte comme non
   * contaminé, c'est la seule définition possible — mais l'écart entre
   * les deux doit être visible : un laboratoire qui n'inspecte qu'un
   * lot sur dix voit son taux divisé par dix.
   */
  lots_inspectes: number;
  taux_multiplication_moyen: number | null;
  taux_contamination: number | null;
  taux_hyperhydricite: number | null;
  taux_enracinement: number | null;
  taux_survie_acclimatation: number | null;
};

export async function lireStatistiquesEspeces(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Lecture<StatistiqueEspece[]>> {
  const { data, error } = await supabase.rpc("biolab_statistiques_especes", {
    p_workspace_id: workspaceId,
  });
  if (error) return echec<StatistiqueEspece[]>([], error.message);
  return { donnees: (data ?? []) as StatistiqueEspece[], erreur: null };
}

/** Ce que rend `biolab_statistiques_bioreacteurs` (0087 §4.3). */
export type StatistiqueBioreacteur = {
  bioreacteur_id: string;
  code: string;
  nom: string;
  cycles_termines: number;
  cycles_echoues: number;
  /**
   * Un taux de RÉUSSITE des cycles, pas une disponibilité calendaire :
   * le produit n'enregistre aucune durée d'immobilisation dont on
   * pourrait déduire une disponibilité. Le mobile pose déjà la même
   * réserve dans `BioLabAnalyticsService.BioreactorStats`.
   */
  taux_reussite: number | null;
  lots_termines: number;
};

export async function lireStatistiquesBioreacteurs(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Lecture<StatistiqueBioreacteur[]>> {
  const { data, error } = await supabase.rpc("biolab_statistiques_bioreacteurs", {
    p_workspace_id: workspaceId,
  });
  if (error) return echec<StatistiqueBioreacteur[]>([], error.message);
  return { donnees: (data ?? []) as StatistiqueBioreacteur[], erreur: null };
}
