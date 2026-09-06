/**
 * §7 « contaminations » — QU'EST-CE QUI CONTAMINE, OÙ, ET DEPUIS QUAND.
 *
 * La contamination est ce qui coûte de l'argent dans ce métier : un lot
 * contaminé est un lot perdu, et six semaines de multiplication avec
 * lui. L'écran doit donc répondre à trois questions, et à rien d'autre.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES AXES QUE J'AI MESURÉS AVANT DE LES PROMETTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * La demande citait « par salle, par rack, par milieu, par opérateur ».
 * Trois de ces quatre n'existent pas, et il vaut mieux le dire que
 * fabriquer une colonne vide :
 *
 *   • PAR MILIEU : RÉEL. `culture_batches.medium_recipe_version_id`
 *     (0029) pointe la version de recette exacte qu'un lot a reçue.
 *     C'est l'axe le plus utile des quatre — un milieu mal stérilisé
 *     contamine tout ce qu'on y met.
 *
 *   • PAR SALLE : INEXISTANT. Aucune table, aucune colonne, aucun écran
 *     mobile. `bioreactors.location` est un texte libre attaché à
 *     l'équipement, pas au lot, et la production n'en compte qu'un.
 *
 *   • PAR RACK : INEXISTANT, ET LA MESURE EST NETTE. Le seul support
 *     d'un rack est `smart_tags.rack_label`, et `SmartTag` n'admet
 *     qu'un seul rattachement à la fois — son propre commentaire le
 *     dit (« any one of several, never more than one meaningfully
 *     set »), et `SmartTagService.clearLink` annule tous les autres
 *     liens avant d'en poser un. Une étiquette de rack porte donc son
 *     libellé ET RIEN D'AUTRE : elle ne connaît aucun lot. Les cinq
 *     étiquettes de la production le confirment — les deux qui portent
 *     un `rack_label` (« Bio », « BIO1 ») n'ont pas de
 *     `culture_batch_id`, et celle qui pointe un lot n'a pas de rack.
 *     Il n'existe aucun chemin de la donnée d'un lot vers un rack.
 *     Ventiler par rack rendrait donc une seule ligne, « Sans rack »,
 *     avec la totalité des lots dedans.
 *
 *   • PAR OPÉRATEUR : INEXISTANT POUR UNE INSPECTION.
 *     `bioreactor_inspections` (0034) ne porte aucune colonne d'auteur.
 *     `medium_batches.prepared_by` existe bien, mais c'est le
 *     préparateur d'un MILIEU, et un lot ne pointe pas une préparation
 *     — il pointe une VERSION DE RECETTE. Remonter du lot au
 *     préparateur demanderait de deviner laquelle des préparations de
 *     cette version a servi. Ce serait une invention, et elle
 *     accuserait quelqu'un.
 *
 * CE QUI EXISTE EN PLUS, ET QUE J'AJOUTE : le STADE DE CULTURE. Il est
 * mesurable (`culture_batches.culture_stage`) et il répond à une vraie
 * question du métier — l'initiation contamine par l'explant, la
 * multiplication par la manipulation ; ce ne sont pas les mêmes causes
 * ni les mêmes remèdes.
 *
 * AUCUN TAUX N'EST CALCULÉ ICI : `observer()` et les prédicats viennent
 * de `referentiel.ts` et de `statistiques.ts`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  observer,
  severiteAtteinte,
  type TauxObserve,
} from "./referentiel.ts";
import { STADES, STADE_LABELS, libelle } from "./cultures.ts";
import {
  estContaminationConfirmee,
  type Lecture,
  type LigneInspection,
  type LigneLot,
} from "./statistiques.ts";
import type { LigneRecette, LigneVersion } from "./recettes.ts";

// ==================================================================
// 1. Les axes réellement disponibles
// ==================================================================

export const AXES = ["espece", "milieu", "bioreacteur", "stade"] as const;
export type Axe = (typeof AXES)[number];

export const LIBELLE_AXE: Record<Axe, string> = {
  espece: "Par espèce",
  milieu: "Par milieu de culture",
  bioreacteur: "Par bioréacteur",
  stade: "Par stade",
};

export function axeValide(valeur: string | undefined): Axe {
  return (AXES as readonly string[]).includes(valeur ?? "") ? (valeur as Axe) : "espece";
}

/**
 * L'ordre du cycle de culture, DÉDUIT de la liste du socle plutôt que
 * recopié.
 *
 * `STADES` de `cultures.ts` est déjà écrit dans l'ordre biologique —
 * initiation, multiplication, élongation, enracinement, acclimatation.
 * Réécrire ici une seconde liste avec ses propres numéros serait deux
 * vérités pour une seule question, et c'est toujours la seconde qui
 * finit par mentir : ajouter un stade au socle sans y penser ici
 * enverrait silencieusement le nouveau venu en fin de tableau.
 */
const ORDRE_STADE = new Map<string, number>(STADES.map((stade, rang) => [stade, rang]));

// ==================================================================
// 2. Le foyer : un lot touché, et depuis quand
// ==================================================================

export type Foyer = {
  lot: LigneLot;
  /** La PREMIÈRE inspection qui a confirmé. C'est le « depuis quand ». */
  confirmeeLe: string;
  /** La dernière, quand il y en a eu plusieurs. */
  derniereConfirmationLe: string;
  /** Combien d'inspections l'ont confirmée : une récidive n'est pas un accident. */
  confirmations: number;
  /** Les bioréacteurs où la confirmation a été relevée. */
  bioreacteurIds: string[];
  versionId: string | null;
};

/**
 * Les lots dont au moins une inspection a CONFIRMÉ une contamination.
 *
 * `suspected` n'entre pas ici, et c'est délibéré (voir
 * `statistiques.estContaminationConfirmee`). Les suspicions sont
 * comptées à part, par `suspicions()`, parce qu'elles méritent d'être
 * vues — mais séparément, et jamais additionnées aux confirmations.
 */
export function foyers(
  lots: readonly LigneLot[],
  inspections: readonly LigneInspection[],
): Foyer[] {
  const parLot = new Map<string, LigneInspection[]>();
  for (const inspection of inspections) {
    if (inspection.culture_batch_id === null || !estContaminationConfirmee(inspection)) continue;
    const liste = parLot.get(inspection.culture_batch_id) ?? [];
    liste.push(inspection);
    parLot.set(inspection.culture_batch_id, liste);
  }

  const resultat: Foyer[] = [];
  for (const lot of lots) {
    const confirmations = parLot.get(lot.id);
    if (!confirmations || confirmations.length === 0) continue;
    const dates = confirmations.map((i) => i.date).sort();
    resultat.push({
      lot,
      confirmeeLe: dates[0],
      derniereConfirmationLe: dates[dates.length - 1],
      confirmations: confirmations.length,
      bioreacteurIds: [
        ...new Set(confirmations.map((i) => i.bioreactor_id).filter((v): v is string => v !== null)),
      ],
      versionId: lot.medium_recipe_version_id,
    });
  }

  // Le plus récent en tête : c'est ce qui appelle une action aujourd'hui.
  return resultat.sort((a, b) => b.confirmeeLe.localeCompare(a.confirmeeLe));
}

/** Les lots seulement SUSPECTÉS, et jamais confirmés. À regarder, pas à compter. */
export function suspicions(
  lots: readonly LigneLot[],
  inspections: readonly LigneInspection[],
): { lot: LigneLot; suspecteeLe: string }[] {
  const confirmes = new Set(foyers(lots, inspections).map((f) => f.lot.id));
  const resultat: { lot: LigneLot; suspecteeLe: string }[] = [];
  for (const lot of lots) {
    if (confirmes.has(lot.id)) continue;
    const dates = inspections
      .filter((i) => i.culture_batch_id === lot.id && i.contamination_status === "suspected")
      .map((i) => i.date)
      .sort();
    if (dates.length > 0) resultat.push({ lot, suspecteeLe: dates[0] });
  }
  return resultat.sort((a, b) => b.suspecteeLe.localeCompare(a.suspecteeLe));
}

// ==================================================================
// 3. La ventilation par axe
// ==================================================================

export type LigneVentilation = {
  cle: string;
  libelle: string;
  taux: TauxObserve;
  /** La contamination confirmée la plus ancienne encore dans ce groupe. */
  premiereConfirmation: string | null;
  /** La plus récente : « ça continue » ou « c'était en mars ». */
  derniereConfirmation: string | null;
};

/**
 * Ventile la contamination sur un axe.
 *
 * TROIS DES QUATRE AXES SE VENTILENT PAR LOT — espèce, milieu, stade
 * sont des propriétés du lot lui-même. LE QUATRIÈME NON : un lot n'a
 * pas « un » bioréacteur. Le seul lien lot↔bioréacteur que le produit
 * ENREGISTRE est l'inspection (`bioreactors.current_batch_id` est un
 * instantané vivant, pas un historique — 0087 §4.3 pose déjà la même
 * réserve). L'axe « par bioréacteur » compte donc les inspections
 * confirmées relevées DANS chaque cuve, sur les lots qui y ont été
 * inspectés : c'est « où l'a-t-on vue », pas « où est-elle née ». Le
 * libellé de l'écran doit le dire.
 */
export function ventiler(
  axe: Axe,
  lots: readonly LigneLot[],
  inspections: readonly LigneInspection[],
  nommer: { version: (id: string) => string; bioreacteur: (id: string) => string },
): LigneVentilation[] {
  if (axe === "bioreacteur") return ventilerParBioreacteur(lots, inspections, nommer.bioreacteur);

  const cleDuLot = (lot: LigneLot): { cle: string; libelle: string } => {
    if (axe === "espece") {
      const nom = lot.species_name.trim();
      return { cle: nom || "—", libelle: nom || "Espèce non renseignée" };
    }
    if (axe === "milieu") {
      const id = lot.medium_recipe_version_id;
      return id === null
        ? { cle: "—", libelle: "Aucun milieu renseigné" }
        : { cle: id, libelle: nommer.version(id) };
    }
    return { cle: lot.culture_stage, libelle: libelle(STADE_LABELS, lot.culture_stage) };
  };

  const touches = new Map(foyers(lots, inspections).map((f) => [f.lot.id, f]));
  const groupes = new Map<string, { libelle: string; lots: LigneLot[]; dates: string[] }>();

  for (const lot of lots) {
    const { cle, libelle } = cleDuLot(lot);
    const groupe = groupes.get(cle) ?? { libelle, lots: [], dates: [] };
    groupe.lots.push(lot);
    const foyer = touches.get(lot.id);
    if (foyer) groupe.dates.push(foyer.confirmeeLe, foyer.derniereConfirmationLe);
    groupes.set(cle, groupe);
  }

  const lignes: LigneVentilation[] = [];
  for (const [cle, groupe] of groupes) {
    const atteints = groupe.lots.filter((l) => touches.has(l.id)).length;
    const dates = [...groupe.dates].sort();
    lignes.push({
      cle,
      libelle: groupe.libelle,
      taux: observer(atteints, groupe.lots.length),
      premiereConfirmation: dates[0] ?? null,
      derniereConfirmation: dates[dates.length - 1] ?? null,
    });
  }

  return trier(lignes, axe);
}

function ventilerParBioreacteur(
  lots: readonly LigneLot[],
  inspections: readonly LigneInspection[],
  nommer: (id: string) => string,
): LigneVentilation[] {
  const lotsConnus = new Set(lots.map((l) => l.id));
  const groupes = new Map<string, { inspectes: Set<string>; touches: Set<string>; dates: string[] }>();

  for (const inspection of inspections) {
    if (inspection.culture_batch_id === null || !lotsConnus.has(inspection.culture_batch_id)) continue;
    const cle = inspection.bioreactor_id ?? "—";
    const groupe = groupes.get(cle) ?? { inspectes: new Set<string>(), touches: new Set<string>(), dates: [] };
    groupe.inspectes.add(inspection.culture_batch_id);
    if (estContaminationConfirmee(inspection)) {
      groupe.touches.add(inspection.culture_batch_id);
      groupe.dates.push(inspection.date);
    }
    groupes.set(cle, groupe);
  }

  const lignes: LigneVentilation[] = [];
  for (const [cle, groupe] of groupes) {
    const dates = [...groupe.dates].sort();
    lignes.push({
      cle,
      libelle: cle === "—" ? "Hors bioréacteur" : nommer(cle),
      taux: observer(groupe.touches.size, groupe.inspectes.size),
      premiereConfirmation: dates[0] ?? null,
      derniereConfirmation: dates[dates.length - 1] ?? null,
    });
  }
  return trier(lignes, "bioreacteur");
}

/**
 * Le pire d'abord — mais l'ordre suit le TAUX, pas son affichage.
 *
 * Un groupe sous le seuil montre « 2 sur 3 » plutôt qu'un pourcentage,
 * et se classe pourtant à sa place réelle : ce qui est caché, c'est la
 * prétention du chiffre, pas le chiffre.
 */
function trier(lignes: LigneVentilation[], axe: Axe): LigneVentilation[] {
  if (axe === "stade") {
    return lignes.sort((a, b) => (ORDRE_STADE.get(a.cle) ?? 99) - (ORDRE_STADE.get(b.cle) ?? 99));
  }
  return lignes.sort(
    (a, b) =>
      (b.taux.taux ?? -1) - (a.taux.taux ?? -1) ||
      b.taux.effectif - a.taux.effectif ||
      a.libelle.localeCompare(b.libelle, "fr"),
  );
}

// ==================================================================
// 4. Les autres troubles
// ==================================================================

/**
 * Les quatre troubles que l'inspection relève, la contamination
 * comprise.
 *
 * Ils ne se remplacent pas : l'hyperhydricité (une plantule gorgée
 * d'eau) vient du milieu ou du confinement, le brunissement d'une
 * oxydation phénolique, la nécrose d'autre chose encore. Les fondre en
 * un seul « incident » ferait perdre exactement l'information qui dit
 * quoi corriger.
 */
export const TROUBLES = ["contamination", "hyperhydricite", "necrose", "brunissement"] as const;
export type Trouble = (typeof TROUBLES)[number];

export const LIBELLE_TROUBLE: Record<Trouble, string> = {
  contamination: "Contamination confirmée",
  hyperhydricite: "Hyperhydricité",
  necrose: "Nécrose",
  brunissement: "Brunissement",
};

export function troublesObserves(
  lots: readonly LigneLot[],
  inspections: readonly LigneInspection[],
): Record<Trouble, TauxObserve> {
  const atteint = (lotId: string, predicat: (i: LigneInspection) => boolean) =>
    inspections.some((i) => i.culture_batch_id === lotId && predicat(i));

  const compter = (predicat: (i: LigneInspection) => boolean) =>
    observer(lots.filter((l) => atteint(l.id, predicat)).length, lots.length);

  return {
    contamination: compter(estContaminationConfirmee),
    hyperhydricite: compter((i) => severiteAtteinte(i.hyperhydricity_status)),
    necrose: compter((i) => severiteAtteinte(i.necrosis_status)),
    brunissement: compter((i) => severiteAtteinte(i.browning_status)),
  };
}

// ==================================================================
// 5. Les photos d'une inspection
// ==================================================================

export type LignePhoto = {
  id: string;
  inspection_id: string;
  storage_path: string;
  thumbnail_storage_path: string;
  category: string;
  date: string;
};

export const COLONNES_PHOTO = "id, inspection_id, storage_path, thumbnail_storage_path, category, date";

/**
 * LE SEAU EST CELUI DES PHOTOS DE PLANTES, ET C'EST VOULU.
 *
 * Le téléphone dépose les photos d'inspection dans `plant-photos`, au
 * chemin `{espace}/biolab/{inspection}/{photo}.jpg` — mesuré dans
 * `SyncEngine.pushBioLabInspectionPhotos`. Créer un second seau côté
 * web rendrait invisibles toutes les photos déjà prises, et §6 interdit
 * précisément ce genre de doublon.
 *
 * Le seau est PRIVÉ (0002) : sa politique de lecture exige d'être
 * membre de l'espace nommé par le premier segment du chemin. On signe
 * donc une URL courte plutôt que d'exposer un lien permanent.
 */
export const SEAU_PHOTOS = "plant-photos";
const DUREE_URL_SIGNEE_SECONDES = 3600;

export type PhotoAffichable = LignePhoto & { url: string | null; urlVignette: string | null };

/**
 * Une URL signée par photo, plutôt qu'un appel groupé.
 *
 * `createSignedUrls` échoue en bloc dès qu'UN chemin manque à l'appel —
 * et un objet peut manquer, la ligne et le fichier étant écrits par
 * deux chemins différents (une table, un seau). Une galerie où une
 * photo effacée à la main ferait disparaître les onze autres serait
 * pire que la photo manquante. Chaque photo répond donc pour elle-même,
 * et celles dont l'URL est nulle s'affichent comme indisponibles.
 */
export async function signerPhotos(
  supabase: SupabaseClient,
  photos: readonly LignePhoto[],
): Promise<PhotoAffichable[]> {
  return Promise.all(
    photos.map(async (photo) => {
      const [pleine, vignette] = await Promise.all([
        supabase.storage.from(SEAU_PHOTOS).createSignedUrl(photo.storage_path, DUREE_URL_SIGNEE_SECONDES),
        supabase.storage
          .from(SEAU_PHOTOS)
          .createSignedUrl(photo.thumbnail_storage_path, DUREE_URL_SIGNEE_SECONDES),
      ]);
      return {
        ...photo,
        url: pleine.data?.signedUrl ?? null,
        urlVignette: vignette.data?.signedUrl ?? pleine.data?.signedUrl ?? null,
      };
    }),
  );
}

// ==================================================================
// 6. Les lectures
// ==================================================================

function echec<T>(vide: T, message: string | undefined): Lecture<T> {
  return { donnees: vide, erreur: message ?? "Lecture impossible" };
}

export type LigneBioreacteur = { id: string; code: string; name: string };

export async function lireBioreacteurs(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Lecture<LigneBioreacteur[]>> {
  const { data, error } = await supabase
    .from("bioreactors")
    .select("id, code, name")
    .eq("workspace_id", workspaceId)
    .order("code");
  if (error) return echec<LigneBioreacteur[]>([], error.message);
  return { donnees: (data ?? []) as unknown as LigneBioreacteur[], erreur: null };
}

export async function lireInspection(
  supabase: SupabaseClient,
  workspaceId: string,
  inspectionId: string,
): Promise<Lecture<LigneInspection | null>> {
  const { data, error } = await supabase
    .from("bioreactor_inspections")
    .select(
      "id, culture_batch_id, bioreactor_id, date, culture_appearance, contamination_status, hyperhydricity_status, necrosis_status, browning_status, growth_status, estimated_count, notes",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", inspectionId)
    .maybeSingle();
  if (error) return echec<LigneInspection | null>(null, error.message);
  return { donnees: (data as unknown as LigneInspection) ?? null, erreur: null };
}

/**
 * Les photos d'une inspection.
 *
 * `biolab_inspection_photos` est la seule table BioLab SANS
 * `workspace_id` : sa politique remonte à l'inspection parente (0034).
 * On ne peut donc pas filtrer par espace ici — c'est la RLS qui s'en
 * charge, et le filtre sur `inspection_id` suffit, l'inspection ayant
 * déjà été lue sous le même jeton.
 */
export async function lirePhotos(
  supabase: SupabaseClient,
  inspectionId: string,
): Promise<Lecture<LignePhoto[]>> {
  const { data, error } = await supabase
    .from("biolab_inspection_photos")
    .select(COLONNES_PHOTO)
    .eq("inspection_id", inspectionId)
    .order("date");
  if (error) return echec<LignePhoto[]>([], error.message);
  return { donnees: (data ?? []) as unknown as LignePhoto[], erreur: null };
}

/** Le nom lisible d'une version de recette : « MS Alocasia · V3 ». */
export function nommeurDeVersion(
  versions: readonly LigneVersion[],
  recettes: readonly LigneRecette[],
): (id: string) => string {
  const parRecette = new Map(recettes.map((r) => [r.id, r.name]));
  const noms = new Map(
    versions.map((v) => [v.id, `${parRecette.get(v.recipe_id) ?? "Recette inconnue"} · V${v.version_number}`]),
  );
  return (id: string) => noms.get(id) ?? "Milieu inconnu";
}

export function nommeurDeBioreacteur(bioreacteurs: readonly LigneBioreacteur[]): (id: string) => string {
  const noms = new Map(bioreacteurs.map((b) => [b.id, b.code ? `${b.code} — ${b.name}` : b.name]));
  return (id: string) => noms.get(id) ?? "Bioréacteur inconnu";
}
