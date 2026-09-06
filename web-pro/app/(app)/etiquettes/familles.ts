/**
 * CE QU'ON PEUT ÉTIQUETER, ET AVEC QUEL MODÈLE — § 13, § 16 et § 18.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX NOTIONS QU'IL NE FAUT PAS CONFONDRE
 * ══════════════════════════════════════════════════════════════════
 *
 *   • LE GISEMENT — d'où viennent les objets à étiqueter : « les lots
 *     de pépinière », « les plantes d'un jardin », « les lots de
 *     culture ». Il y en a QUINZE, exactement les quinze `entity_kind`
 *     que la migration 0090 accepte, ni un de plus.
 *   • LA FAMILLE DE MODÈLE — « BioLab, Nursery et Jardins » du § 18.
 *     Il y en a TROIS. C'est ce qui décide des champs utiles : un lot
 *     de culture n'a pas de cultivar de jardin, une plante de jardin
 *     n'a pas de numéro de lot.
 *
 * Chaque gisement propose une famille par défaut, et rien de plus
 * qu'une proposition : l'écran d'impression laisse choisir un autre
 * modèle. Figer le couple ferait exactement l'inverse de ce que veut
 * le § 18 — une entreprise qui compose SON modèle doit pouvoir s'en
 * servir là où elle veut.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE MUR DU § 13, ET POURQUOI CHAQUE GISEMENT DÉCLARE SON AXE
 * ══════════════════════════════════════════════════════════════════
 *
 * La base est cloisonnée sur DEUX axes qui ne se recouvrent pas :
 * `gardens`, `plants`, `culture_batches`… portent `workspace_id` ;
 * `equipment`, `nursery_lots`, `nursery_locations` portent
 * `organization_id`. Une requête qui filtrerait tout le monde sur le
 * même identifiant rendrait zéro ligne sur la moitié des écrans, sans
 * la moindre erreur — juste un « aucun élément » qui ment.
 *
 * D'où `axe` sur chaque gisement, et une seule fonction de lecture qui
 * s'en sert. La RLS reste la barrière ; ce filtre-ci sert à ne pas
 * mélanger deux entreprises d'un même compte (§13 MULTI-ENTREPRISES).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE PARLE À RIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * Pas de Supabase, pas de React, pas de `process.env`. Une ligne
 * quelconque entre, un jeu de valeurs de champs sort. C'est ce qui
 * rend `familles.test.ts` possible sans réseau — et ce test est le
 * seul endroit où l'on vérifie qu'un lot de pépinière imprime bien son
 * numéro de lot plutôt que son identifiant technique.
 */

// IMPORT RELATIF, ET C'EST VOULU : `node --test` ne résout pas
// l'alias `@/` (il n'y a pas de chargeur), et ce module doit être
// testable sans réseau ni bundler. Next.js, lui, résout les deux.
import type { ChampEtiquette, FamilleEtiquette } from "../../../lib/etiquettes/index.ts";

/**
 * Les quinze familles d'éléments que `etiquette_creer()` accepte.
 *
 * RECOPIÉES DE 0090 § 7, MOT POUR MOT. Le test relit la migration et
 * échoue si l'une manque ou si l'une est de trop : un gisement que la
 * base refuserait donnerait un écran qui liste des objets, propose de
 * les étiqueter, et lève une exception au clic.
 *
 * `rack` n'y figure pas, et c'est exact : la seizième valeur de
 * `entity_kind` existe bien en base, mais elle vient d'un `rack_label`
 * — un libellé libre écrit sur l'iPhone, sans enregistrement derrière.
 * Il n'y a donc rien à lister, rien à cocher, rien à imprimer en lot.
 */
export const SOURCES = [
  "garden",
  "gardenZone",
  "gardenArea",
  "plant",
  "irrigationZone",
  "pond",
  "sensor",
  "connectedDevice",
  "equipment",
  "nurseryLot",
  "nurseryLocation",
  "cultureBatch",
  "bioreactor",
  "mediumRecipeVersion",
  "acclimatizationBatch",
] as const;

export type SourceEtiquette = (typeof SOURCES)[number];

export type AxeCloisonnement = "workspace" | "organisation";

export type Gisement = {
  readonly cle: SourceEtiquette;
  /** La famille de modèle proposée par défaut. Modifiable à l'écran. */
  readonly famille: FamilleEtiquette;
  /** Au pluriel, pour un titre de section. */
  readonly libelle: string;
  /** Au singulier, sans article, pour une phrase. */
  readonly singulier: string;
  readonly axe: AxeCloisonnement;
  /** La table PostgREST, et la liste de colonnes qu'il faut en tirer. */
  readonly table: string;
  readonly colonnes: string;
  /**
   * La colonne de suppression douce, s'il y en a une.
   *
   * MESURÉ TABLE PAR TABLE, PAS SUPPOSÉ. Les quatre tables BioLab
   * (`culture_batches`, `bioreactors`, `medium_recipe_versions`,
   * `acclimatization_batches`) n'en ont AUCUNE — l'absence de filtre
   * dans ces quatre gisements est donc exacte, pas un oubli. Les onze
   * autres en ont une, et toutes sont filtrées.
   */
  readonly suppressionDouce: "deleted_at" | "archived_at" | null;
  /** Colonne booléenne d'archivage en plus, pour `plants`. */
  readonly archiveBooleen: string | null;
  /** La colonne sur laquelle trier par défaut. */
  readonly tri: string;
};

/**
 * LE CATALOGUE.
 *
 * L'ORDRE COMPTE : c'est celui des écrans, et il va du contenant au
 * contenu — un jardin, puis ses zones, puis ses plantes. Quelqu'un qui
 * cherche « où sont mes plantes » descend la liste ; quelqu'un qui
 * cherche « le jardin » la trouve en premier.
 */
const CATALOGUE: readonly Gisement[] = [
  // ---- JARDINS -------------------------------------------------
  {
    cle: "garden",
    famille: "jardins",
    libelle: "Jardins",
    singulier: "jardin",
    axe: "workspace",
    table: "gardens",
    colonnes: "id, name, address",
    suppressionDouce: "deleted_at",
    archiveBooleen: null,
    tri: "name",
  },
  {
    cle: "gardenZone",
    famille: "jardins",
    libelle: "Zones de jardin",
    singulier: "zone de jardin",
    axe: "workspace",
    // `garden_zones` NE PORTE PAS `workspace_id` — vérifié sur
    // information_schema. Le cloisonnement passe par son jardin, d'où
    // la jointure `!inner` : sans elle, un compte membre de deux
    // espaces verrait les zones des deux mélangées.
    table: "garden_zones",
    colonnes: "id, name, garden_id, gardens!inner ( name, workspace_id, deleted_at )",
    suppressionDouce: "deleted_at",
    archiveBooleen: null,
    tri: "name",
  },
  {
    cle: "gardenArea",
    famille: "jardins",
    libelle: "Massifs et surfaces",
    singulier: "massif",
    axe: "workspace",
    table: "garden_areas",
    colonnes: "id, name, area_type, garden_id, gardens ( name )",
    suppressionDouce: "deleted_at",
    archiveBooleen: null,
    tri: "name",
  },
  {
    cle: "plant",
    famille: "jardins",
    libelle: "Plantes",
    singulier: "plante",
    axe: "workspace",
    table: "plants",
    colonnes:
      "id, custom_name, common_name, scientific_name, type, date_added, garden_id, gardens ( name )",
    suppressionDouce: "deleted_at",
    archiveBooleen: "is_archived",
    tri: "common_name",
  },
  {
    cle: "irrigationZone",
    famille: "jardins",
    libelle: "Zones d'arrosage",
    singulier: "zone d'arrosage",
    axe: "workspace",
    table: "irrigation_zones",
    colonnes: "id, name, type, garden_id, gardens ( name )",
    suppressionDouce: "deleted_at",
    archiveBooleen: null,
    tri: "name",
  },
  {
    cle: "pond",
    famille: "jardins",
    libelle: "Bassins",
    singulier: "bassin",
    axe: "workspace",
    table: "ponds",
    colonnes: "id, name, volume_liters, garden_id, gardens ( name )",
    suppressionDouce: "deleted_at",
    archiveBooleen: null,
    tri: "name",
  },
  {
    cle: "sensor",
    famille: "jardins",
    libelle: "Capteurs",
    singulier: "capteur",
    axe: "workspace",
    table: "sensors",
    colonnes: "id, name, type, unit, garden_id, gardens ( name )",
    suppressionDouce: "deleted_at",
    archiveBooleen: null,
    tri: "name",
  },
  {
    cle: "connectedDevice",
    famille: "jardins",
    libelle: "Équipements connectés",
    singulier: "équipement connecté",
    axe: "workspace",
    table: "connected_devices",
    colonnes: "id, name, category, manufacturer, garden_id, gardens ( name )",
    suppressionDouce: "deleted_at",
    archiveBooleen: null,
    tri: "name",
  },
  {
    cle: "equipment",
    // LE MATÉRIEL EST LE SEUL GISEMENT SANS MONDE ÉVIDENT : le § 13 le
    // cite dans les trois. On le range dans « Jardins » parce que c'est
    // là que le résolveur l'ouvre (/materiel/[id]) et parce que le
    // matériel d'une entreprise de paysage est majoritairement du
    // matériel de chantier. Ce n'est qu'un DÉFAUT — l'écran
    // d'impression laisse choisir n'importe quel modèle.
    famille: "jardins",
    libelle: "Matériel",
    singulier: "matériel",
    axe: "organisation",
    table: "equipment",
    colonnes: "id, name, category, brand, model, internal_number, serial_number",
    suppressionDouce: "archived_at",
    archiveBooleen: null,
    tri: "name",
  },

  // ---- PÉPINIÈRE -----------------------------------------------
  {
    cle: "nurseryLot",
    famille: "pepiniere",
    libelle: "Lots de pépinière",
    singulier: "lot de pépinière",
    axe: "organisation",
    table: "nursery_lots",
    colonnes:
      "id, lot_code, species_name, cultivar, current_quantity, status, created_at, " +
      "location_id, nursery_locations ( code, name )",
    suppressionDouce: "archived_at",
    archiveBooleen: null,
    tri: "lot_code",
  },
  {
    cle: "nurseryLocation",
    famille: "pepiniere",
    libelle: "Emplacements de pépinière",
    singulier: "emplacement",
    axe: "organisation",
    table: "nursery_locations",
    colonnes: "id, code, name, kind, capacity",
    suppressionDouce: "archived_at",
    archiveBooleen: null,
    tri: "code",
  },

  // ---- BIOLAB --------------------------------------------------
  {
    cle: "cultureBatch",
    famille: "biolab",
    libelle: "Lots de culture",
    singulier: "lot de culture",
    axe: "workspace",
    table: "culture_batches",
    colonnes:
      "id, batch_code, species_name, cultivar, culture_stage, current_count, started_at, status",
    suppressionDouce: null,
    archiveBooleen: null,
    tri: "batch_code",
  },
  {
    cle: "bioreactor",
    famille: "biolab",
    libelle: "Bioréacteurs",
    singulier: "bioréacteur",
    axe: "workspace",
    table: "bioreactors",
    colonnes: "id, name, code, bioreactor_type, status, location",
    suppressionDouce: null,
    archiveBooleen: null,
    tri: "name",
  },
  {
    cle: "mediumRecipeVersion",
    famille: "biolab",
    libelle: "Versions de recette",
    singulier: "version de recette",
    axe: "workspace",
    table: "medium_recipe_versions",
    colonnes: "id, version_number, created_at, recipe_id, medium_recipes ( name, species_name )",
    suppressionDouce: null,
    archiveBooleen: null,
    tri: "version_number",
  },
  {
    cle: "acclimatizationBatch",
    famille: "biolab",
    libelle: "Lots d'acclimatation",
    singulier: "lot d'acclimatation",
    axe: "workspace",
    table: "acclimatization_batches",
    colonnes:
      "id, started_at, status, substrate, location, current_survivor_count, " +
      "culture_batch_id, culture_batches ( batch_code, species_name )",
    suppressionDouce: null,
    archiveBooleen: null,
    tri: "started_at",
  },
];

export const GISEMENTS: Readonly<Record<SourceEtiquette, Gisement>> = Object.freeze(
  Object.fromEntries(CATALOGUE.map((g) => [g.cle, g])) as Record<SourceEtiquette, Gisement>,
);

export function gisement(cle: SourceEtiquette): Gisement {
  const trouve = GISEMENTS[cle];
  if (!trouve) throw new Error(`Gisement d'étiquettes inconnu : ${cle}.`);
  return trouve;
}

/** Vrai si la chaîne est l'une des quinze clés. Pour valider une URL. */
export function estSource(valeur: string | null | undefined): valeur is SourceEtiquette {
  return typeof valeur === "string" && (SOURCES as readonly string[]).includes(valeur);
}

export const FAMILLES: readonly FamilleEtiquette[] = ["jardins", "pepiniere", "biolab"];

export const LIBELLE_FAMILLE: Readonly<Record<FamilleEtiquette, string>> = {
  jardins: "Jardins",
  pepiniere: "Pépinière",
  biolab: "BioLab",
};

/** Les gisements d'une famille, dans l'ordre du catalogue. */
export function gisementsDeFamille(famille: FamilleEtiquette): readonly Gisement[] {
  return CATALOGUE.filter((g) => g.famille === famille);
}

// ══════════════════════════════════════════════════════════════════
// D'UNE LIGNE DE BASE AUX VALEURS IMPRIMÉES
// ══════════════════════════════════════════════════════════════════

/** Une ligne telle que PostgREST la rend : rien n'est garanti. */
export type LigneGisement = Record<string, unknown>;

function chaine(valeur: unknown): string | null {
  if (typeof valeur === "string") {
    const propre = valeur.trim();
    return propre === "" ? null : propre;
  }
  if (typeof valeur === "number" && Number.isFinite(valeur)) return String(valeur);
  return null;
}

/** La première valeur non vide. Le « ?? » ne suffit pas : "" n'est pas nul. */
function premier(...valeurs: unknown[]): string | null {
  for (const valeur of valeurs) {
    const texte = chaine(valeur);
    if (texte) return texte;
  }
  return null;
}

function embarque(ligne: LigneGisement, cle: string): LigneGisement | null {
  const valeur = ligne[cle];
  // PostgREST rend un OBJET pour une relation « vers un », mais un
  // TABLEAU quand il n'arrive pas à prouver l'unicité. Lire les deux
  // coûte trois lignes ; ne lire qu'une forme laisse un champ vide sans
  // rien dire.
  if (Array.isArray(valeur)) return (valeur[0] as LigneGisement | undefined) ?? null;
  if (valeur && typeof valeur === "object") return valeur as LigneGisement;
  return null;
}

/**
 * Une date ISO en `jj/mm/aaaa`, SANS PASSER PAR UN FUSEAU HORAIRE.
 *
 * `toLocaleDateString` lit le fuseau de la machine : un serveur en UTC
 * et un navigateur à Paris n'écriraient pas la même date sur la même
 * étiquette, et le 1er janvier à 00 h 30 ils écriraient deux ANNÉES
 * différentes. On découpe la chaîne, ce qui donne la date telle que la
 * base l'a écrite, partout pareil.
 */
export function dateCourte(valeur: unknown): string | null {
  const texte = chaine(valeur);
  if (!texte) return null;
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})/.exec(texte);
  if (!correspondance) return null;
  return `${correspondance[3]}/${correspondance[2]}/${correspondance[1]}`;
}

/**
 * Une référence courte pour un objet qui n'a pas de code lisible.
 *
 * DEUX GISEMENTS SONT DANS CE CAS : les lots d'acclimatation et les
 * versions de recette n'ont aucune colonne « code ». Plutôt que de
 * laisser un blanc sur l'étiquette — donc deux autocollants
 * indiscernables sur deux bacs voisins — on imprime les huit premiers
 * caractères de l'identifiant, en majuscules. Ce n'est pas beau, mais
 * c'est UNIQUE et ça se recopie au téléphone.
 */
export function referenceCourte(id: unknown, prefixe: string): string | null {
  const texte = chaine(id);
  if (!texte) return null;
  return `${prefixe}-${texte.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

const STADE_CULTURE: Record<string, string> = {
  initiation: "Initiation",
  multiplication: "Multiplication",
  elongation: "Élongation",
  rooting: "Enracinement",
  acclimatization: "Acclimatation",
};

const KIND_EMPLACEMENT: Record<string, string> = {
  greenhouse: "Serre",
  tunnel: "Tunnel",
  row: "Rangée",
  bench: "Tablette",
  outdoorBlock: "Plein air",
};

/**
 * Ce qu'un objet imprime sur son étiquette.
 *
 * TOUT CE QUI SORT D'ICI EST DESTINÉ À UN AUTOCOLLANT COLLÉ SUR UN POT,
 * DONC VISIBLE PAR N'IMPORTE QUI. Aucun prix, aucune marge, aucun coût
 * d'achat, aucun nom de client : ces colonnes ne sont même pas
 * demandées à la base (voir `colonnes` plus haut, gisement par
 * gisement). C'est la règle du § 15 appliquée à l'encre — une étiquette
 * n'a pas de session, elle ne peut pas cacher ce qu'elle porte.
 *
 * `date` reçoit la date PROPRE À L'OBJET quand elle existe (semis,
 * démarrage de lot) ; sinon l'appelant y met la date d'impression. Une
 * étiquette de pépinière sans date ne vaut rien : on ne sait plus si le
 * lot a trois semaines ou trois ans.
 */
export function valeursDe(
  source: SourceEtiquette,
  ligne: LigneGisement,
): Partial<Record<ChampEtiquette, string>> {
  const valeurs: Partial<Record<ChampEtiquette, string>> = {};
  const poser = (champ: ChampEtiquette, valeur: string | null | undefined) => {
    if (valeur) valeurs[champ] = valeur;
  };

  switch (source) {
    case "garden":
      poser("nom", premier(ligne.name) ?? "Jardin");
      poser("emplacement", premier(ligne.address));
      break;

    case "gardenZone":
      poser("nom", premier(ligne.name) ?? "Zone");
      poser("emplacement", premier(embarque(ligne, "gardens")?.name));
      break;

    case "gardenArea":
      poser("nom", premier(ligne.name) ?? "Massif");
      poser("stade", premier(ligne.area_type));
      poser("emplacement", premier(embarque(ligne, "gardens")?.name));
      break;

    case "plant":
      // `custom_name` est le nom que le jardinier a donné ; il prime sur
      // le nom commun du référentiel, qui n'est qu'un défaut.
      poser("nom", premier(ligne.custom_name, ligne.common_name) ?? "Plante");
      poser("nomScientifique", premier(ligne.scientific_name));
      poser("emplacement", premier(embarque(ligne, "gardens")?.name));
      poser("date", dateCourte(ligne.date_added));
      break;

    case "irrigationZone":
      poser("nom", premier(ligne.name) ?? "Zone d'arrosage");
      poser("stade", premier(ligne.type));
      poser("emplacement", premier(embarque(ligne, "gardens")?.name));
      break;

    case "pond":
      poser("nom", premier(ligne.name) ?? "Bassin");
      poser("quantite", ligne.volume_liters ? `${chaine(ligne.volume_liters)} L` : null);
      poser("emplacement", premier(embarque(ligne, "gardens")?.name));
      break;

    case "sensor":
      poser("nom", premier(ligne.name) ?? "Capteur");
      poser("stade", premier(ligne.type));
      poser("emplacement", premier(embarque(ligne, "gardens")?.name));
      break;

    case "connectedDevice":
      poser("nom", premier(ligne.name) ?? "Équipement");
      poser("stade", premier(ligne.category));
      poser("emplacement", premier(embarque(ligne, "gardens")?.name));
      break;

    case "equipment":
      poser("nom", premier(ligne.name) ?? "Matériel");
      // Le numéro interne AVANT le numéro de série : c'est celui que
      // l'entreprise cite dans ses propres papiers.
      poser("numeroLot", premier(ligne.internal_number, ligne.serial_number));
      poser("cultivar", premier(ligne.brand, ligne.model));
      poser("stade", premier(ligne.category));
      break;

    case "nurseryLot": {
      poser("nom", premier(ligne.species_name) ?? "Lot");
      poser("cultivar", premier(ligne.cultivar));
      poser("numeroLot", premier(ligne.lot_code));
      const quantite = ligne.current_quantity;
      if (typeof quantite === "number" && Number.isFinite(quantite)) {
        // « u » pour unités : sur 12 mm de large, « plants » ne tient
        // pas, et le producteur compte en pieds de toute façon.
        poser("quantite", `${Math.round(quantite)} u`);
      }
      const lieu = embarque(ligne, "nursery_locations");
      poser("emplacement", premier(lieu?.name, lieu?.code));
      poser("date", dateCourte(ligne.created_at));
      poser("stade", premier(ligne.status));
      break;
    }

    case "nurseryLocation": {
      poser("nom", premier(ligne.name, ligne.code) ?? "Emplacement");
      poser("numeroLot", premier(ligne.code));
      const kind = chaine(ligne.kind);
      poser("stade", kind ? (KIND_EMPLACEMENT[kind] ?? kind) : null);
      break;
    }

    case "cultureBatch": {
      poser("nom", premier(ligne.species_name) ?? "Lot de culture");
      poser("cultivar", premier(ligne.cultivar));
      poser("numeroLot", premier(ligne.batch_code));
      const stade = chaine(ligne.culture_stage);
      poser("stade", stade ? (STADE_CULTURE[stade] ?? stade) : null);
      const compte = ligne.current_count;
      if (typeof compte === "number" && Number.isFinite(compte)) {
        poser("quantite", `${Math.round(compte)} u`);
      }
      poser("date", dateCourte(ligne.started_at));
      break;
    }

    case "bioreactor":
      poser("nom", premier(ligne.name) ?? "Bioréacteur");
      poser("numeroLot", premier(ligne.code));
      poser("cultivar", premier(ligne.bioreactor_type));
      poser("emplacement", premier(ligne.location));
      poser("stade", premier(ligne.status));
      break;

    case "mediumRecipeVersion": {
      const recette = embarque(ligne, "medium_recipes");
      poser("nom", premier(recette?.name) ?? "Recette");
      poser("nomScientifique", premier(recette?.species_name));
      const version = chaine(ligne.version_number);
      poser("numeroLot", version ? `v${version}` : referenceCourte(ligne.id, "REC"));
      poser("date", dateCourte(ligne.created_at));
      break;
    }

    case "acclimatizationBatch": {
      const lot = embarque(ligne, "culture_batches");
      poser("nom", premier(lot?.species_name) ?? "Acclimatation");
      // Un lot d'acclimatation n'a aucune colonne « code » : on cite
      // celui du lot de culture dont il sort, et à défaut on fabrique
      // une référence courte depuis son identifiant.
      poser("numeroLot", premier(lot?.batch_code) ?? referenceCourte(ligne.id, "ACC"));
      poser("stade", "Acclimatation");
      poser("emplacement", premier(ligne.location, ligne.substrate));
      const survivants = ligne.current_survivor_count;
      if (typeof survivants === "number" && Number.isFinite(survivants)) {
        poser("quantite", `${Math.round(survivants)} u`);
      }
      poser("date", dateCourte(ligne.started_at));
      break;
    }
  }

  return valeurs;
}

/**
 * Le libellé d'un objet dans la LISTE DE SÉLECTION — pas sur
 * l'étiquette.
 *
 * Il est plus bavard que le nom imprimé : à l'écran on a la place, et
 * cocher la bonne ligne parmi vingt-cinq plantes demande de distinguer
 * deux « Palmier » par leur nom scientifique.
 */
export function libelleObjet(source: SourceEtiquette, ligne: LigneGisement): string {
  const valeurs = valeursDe(source, ligne);
  const morceaux = [valeurs.numeroLot, valeurs.nom, valeurs.cultivar, valeurs.nomScientifique]
    .filter((m): m is string => Boolean(m))
    .filter((m, index, tous) => tous.indexOf(m) === index);
  return morceaux.length > 0 ? morceaux.join(" — ") : "Sans nom";
}
