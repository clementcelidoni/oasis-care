/**
 * §7 « recettes » et « milieux » — LA RECETTE DE MILIEU ET SES VERSIONS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER EXISTE POUR GARANTIR
 * ══════════════════════════════════════════════════════════════════
 *
 * On doit pouvoir dire, des mois plus tard, QUELLE VERSION a servi à
 * QUEL LOT. C'est la raison d'être du versionnement, et le téléphone
 * l'assure d'une façon très précise qu'il ne faut pas défaire :
 *
 *   • `MediumRecipeVersion` est IMMUABLE. Le module mobile n'offre
 *     nulle part de « modifier une version » — seulement « créer une
 *     nouvelle version ». Un lot pointe une version exacte
 *     (`culture_batches.medium_recipe_version_id`), donc tant que les
 *     champs d'une version ne bougent jamais, ce pointeur dit
 *     exactement ce que le lot a reçu, quel que soit le nombre de
 *     versions plus récentes.
 *   • LA GÉNÉALOGIE EST UN ARBRE, PAS UNE SUITE.
 *     `parent_version_id` (0039) existe précisément parce que la
 *     numérotation ne suffit pas : la spec du module donne elle-même
 *     l'exemple d'une V2 qui donne naissance à V3A et V3B. Déduire le
 *     parent de « numéro − 1 » écraserait cette bifurcation.
 *
 * LE WEB NE CRÉE NI NE MODIFIE AUCUNE VERSION. Il lit, il compare, il
 * montre la filiation. Le §7 demande une supervision ; la saisie d'une
 * recette se fait sur le téléphone, à la paillasse, là où on la pèse.
 *
 * AUCUN TAUX N'EST CALCULÉ ICI : ils viennent tous de
 * `statistiques.ts`, seul endroit du module où l'on divise.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ORDRE_TYPE_COMPOSANT,
  LIBELLE_TYPE_COMPOSANT,
  LIBELLE_UNITE_CONCENTRATION,
  LIBELLE_UNITE_QUANTITE,
  type TypeComposant,
} from "./referentiel.ts";
import { formatNombre, libelle } from "./cultures.ts";
import type { Lecture } from "./statistiques.ts";

// ==================================================================
// 1. Ce que la base porte
// ==================================================================

export type LigneRecette = {
  id: string;
  name: string;
  species_name: string;
  notes: string;
  created_at: string;
  updated_at: string | null;
};

/**
 * Un composant d'une version, tel que l'iPhone l'écrit dans le `jsonb`.
 *
 * Les clés sont en camelCase et non en snake_case : `components` est
 * encodé par le `Codable` synthétisé de `MediumComponentAmount`, sans
 * stratégie de conversion (mesuré dans `SyncEngine`). C'est une donnée
 * imbriquée, pas une colonne — la convention de la table ne s'y
 * applique pas.
 */
export type Composant = {
  id?: string;
  type: string;
  name: string;
  amount: number;
  unit: string;
  pgrCategory?: string | null;
  compoundId?: string | null;
  sourceType?: string | null;
};

export type LigneVersion = {
  id: string;
  recipe_id: string;
  version_number: number;
  target_ph: number;
  measured_ph: number | null;
  components: unknown;
  change_reason: string;
  parent_version_id: string | null;
  notes: string;
  created_at: string;
};

/** Une pesée réelle dans une préparation (`MediumBatchIngredient`). */
export type PeseeReelle = {
  id?: string;
  ingredientId: string;
  targetAmount: number;
  actualAmount?: number | null;
  amountUnit: string;
  inventoryLotId?: string | null;
};

export type LignePreparation = {
  id: string;
  code: string;
  recipe_version_id: string | null;
  volume_liters: number;
  target_volume_liters: number | null;
  prepared_at: string;
  prepared_by: string | null;
  measured_ph: number | null;
  compound_lots: unknown;
  notes: string;
};

/** Une entrée de `biolab_audit_entries` — les « historiques » du §7. */
export type LigneHistorique = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  detail: string;
  performed_by: string | null;
  occurred_at: string;
};

export const COLONNES_RECETTE = "id, name, species_name, notes, created_at, updated_at";
export const COLONNES_VERSION =
  "id, recipe_id, version_number, target_ph, measured_ph, components, change_reason, parent_version_id, notes, created_at";
export const COLONNES_PREPARATION =
  "id, code, recipe_version_id, volume_liters, target_volume_liters, prepared_at, prepared_by, measured_ph, compound_lots, notes";
export const COLONNES_HISTORIQUE =
  "id, entity_type, entity_id, action, detail, performed_by, occurred_at";

/**
 * Le nom de table que le téléphone écrit dans `entity_type`.
 *
 * `BioLabAuditEntry` en fixe la convention : « Postgres table name of
 * the audited record ». On ne devine donc pas, on reprend le nom exact
 * de la table.
 */
export const ENTITE_VERSION = "medium_recipe_versions";

/**
 * Les actions que `BioLabAuditAction` déclare, et leur mot français.
 *
 * ATTENTION, MESURÉ : seules DEUX d'entre elles sont réellement écrites
 * aujourd'hui. Le balayage des appels à `BioLabAuditService.log` n'en
 * trouve que deux — `versioned`, posée par `MediumRecipeService`, et
 * `split`, posée par `CultureBatchService`. `stage_changed` est déclarée
 * dans `BioLabAuditAction` mais aucun code ne l'écrit. Le libellé reste
 * ici pour le jour où elle le sera, mais AUCUN écran ne doit promettre
 * que les changements de stade sont tracés : ils ne le sont pas.
 */
export const LIBELLE_ACTION_HISTORIQUE: Record<string, string> = {
  versioned: "Nouvelle version",
  split: "Division de lot",
  stage_changed: "Changement de stade",
};

// ==================================================================
// 2. Lire un `jsonb` sans lui faire confiance
// ==================================================================

/**
 * `components` est du `jsonb` libre : la base n'impose aucune forme.
 *
 * Une ligne écrite par une version future du téléphone, ou par une
 * main humaine dans l'éditeur SQL, ne doit pas casser l'écran. On
 * garde les entrées exploitables et on jette silencieusement le reste
 * — ce qui vaut mieux qu'une page en erreur, mais mérite d'être su :
 * une recette dont un composant a disparu de l'affichage est un piège
 * pour un préparateur. D'où `composantsIllisibles`, que la fiche
 * affiche quand il est non nul.
 */
export function lireComposants(brut: unknown): { composants: Composant[]; illisibles: number } {
  if (!Array.isArray(brut)) return { composants: [], illisibles: 0 };
  const composants: Composant[] = [];
  let illisibles = 0;
  for (const entree of brut) {
    if (entree === null || typeof entree !== "object") {
      illisibles += 1;
      continue;
    }
    const objet = entree as Record<string, unknown>;
    const nom = typeof objet.name === "string" ? objet.name : null;
    const quantite = typeof objet.amount === "number" ? objet.amount : null;
    if (nom === null || quantite === null) {
      illisibles += 1;
      continue;
    }
    composants.push({
      id: typeof objet.id === "string" ? objet.id : undefined,
      type: typeof objet.type === "string" ? objet.type : "other",
      name: nom,
      amount: quantite,
      unit: typeof objet.unit === "string" ? objet.unit : "",
      pgrCategory: typeof objet.pgrCategory === "string" ? objet.pgrCategory : null,
      compoundId: typeof objet.compoundId === "string" ? objet.compoundId : null,
      sourceType: typeof objet.sourceType === "string" ? objet.sourceType : null,
    });
  }
  return { composants, illisibles };
}

export function lirePesees(brut: unknown): PeseeReelle[] {
  if (!Array.isArray(brut)) return [];
  const pesees: PeseeReelle[] = [];
  for (const entree of brut) {
    if (entree === null || typeof entree !== "object") continue;
    const objet = entree as Record<string, unknown>;
    if (typeof objet.ingredientId !== "string" || typeof objet.targetAmount !== "number") continue;
    pesees.push({
      id: typeof objet.id === "string" ? objet.id : undefined,
      ingredientId: objet.ingredientId,
      targetAmount: objet.targetAmount,
      actualAmount: typeof objet.actualAmount === "number" ? objet.actualAmount : null,
      amountUnit: typeof objet.amountUnit === "string" ? objet.amountUnit : "",
      inventoryLotId: typeof objet.inventoryLotId === "string" ? objet.inventoryLotId : null,
    });
  }
  return pesees;
}

// ==================================================================
// 3. La composition
// ==================================================================

/** L'ordre où l'on verse : milieu de base d'abord, gélifiant en dernier. */
export function trierComposants(composants: readonly Composant[]): Composant[] {
  return [...composants].sort((a, b) => {
    const rangA = ORDRE_TYPE_COMPOSANT[a.type as TypeComposant] ?? 99;
    const rangB = ORDRE_TYPE_COMPOSANT[b.type as TypeComposant] ?? 99;
    if (rangA !== rangB) return rangA - rangB;
    return a.name.localeCompare(b.name, "fr");
  });
}

export function direConcentration(composant: Composant): string {
  const unite = libelle(LIBELLE_UNITE_CONCENTRATION, composant.unit);
  // Le format vient du socle, qui garde jusqu'à trois décimales : les
  // régulateurs de croissance se dosent au centième de mg/L, et
  // arrondir plus tôt effacerait l'écart entre deux versions.
  return `${formatNombre(composant.amount) ?? "?"} ${unite}`.trim();
}

export function direQuantite(valeur: number | null | undefined, unite: string): string {
  if (valeur === null || valeur === undefined) return "—";
  return `${formatNombre(valeur) ?? "?"} ${libelle(LIBELLE_UNITE_QUANTITE, unite)}`.trim();
}

export type ResumeComposition = {
  milieuxDeBase: string[];
  regulateurs: string[];
  nombreComposants: number;
};

export function resumerComposition(composants: readonly Composant[]): ResumeComposition {
  return {
    milieuxDeBase: composants.filter((c) => c.type === "basalMedium").map((c) => c.name),
    regulateurs: composants
      .filter((c) => c.type === "plantGrowthRegulator")
      .map((c) => `${c.name} ${direConcentration(c)}`),
    nombreComposants: composants.length,
  };
}

// ==================================================================
// 4. La généalogie
// ==================================================================

export type NoeudVersion = {
  version: LigneVersion;
  profondeur: number;
  /** Vrai quand la version n'a pas de parent enregistré dans ce jeu. */
  racine: boolean;
};

/**
 * La filiation des versions d'une recette, à plat mais ordonnée.
 *
 * DEUX PRUDENCES, TOUTES DEUX NÉCESSAIRES :
 *
 *   • `parent_version_id` référence la table elle-même sans rien qui
 *     interdise un cycle (0039 : une simple clé étrangère). Un cycle
 *     ferait boucler la descente à l'infini et bloquerait le serveur.
 *     Le jeu de visites `vus` le ferme : chaque version est émise une
 *     fois et une seule.
 *   • Un parent peut être ABSENT du jeu qu'on affiche (supprimé, ou
 *     rattaché à une autre recette). Une version orpheline doit
 *     apparaître quand même, en racine, plutôt que de disparaître
 *     silencieusement de la fiche.
 */
export function genealogieDesVersions(versions: readonly LigneVersion[]): NoeudVersion[] {
  const presentes = new Set(versions.map((v) => v.id));
  const enfants = new Map<string, LigneVersion[]>();
  const racines: LigneVersion[] = [];

  for (const version of versions) {
    const parent = version.parent_version_id;
    if (parent !== null && parent !== version.id && presentes.has(parent)) {
      const fratrie = enfants.get(parent) ?? [];
      fratrie.push(version);
      enfants.set(parent, fratrie);
    } else {
      racines.push(version);
    }
  }

  const parNumero = (a: LigneVersion, b: LigneVersion) => a.version_number - b.version_number;
  racines.sort(parNumero);
  for (const fratrie of enfants.values()) fratrie.sort(parNumero);

  const resultat: NoeudVersion[] = [];
  const vus = new Set<string>();

  const descendre = (version: LigneVersion, profondeur: number, racine: boolean) => {
    if (vus.has(version.id)) return;
    vus.add(version.id);
    resultat.push({ version, profondeur, racine });
    for (const enfant of enfants.get(version.id) ?? []) descendre(enfant, profondeur + 1, false);
  };

  for (const racine of racines) descendre(racine, 0, true);

  // Un cycle pur (A → B → A, sans racine) n'est atteint par aucune
  // descente : ses membres seraient invisibles. On les rend à plat
  // plutôt que de les taire.
  for (const version of versions) {
    if (!vus.has(version.id)) descendre(version, 0, true);
  }

  return resultat;
}

// ==================================================================
// 5. Ce qui a changé d'une version à l'autre
// ==================================================================

export type EcartComposant = {
  nom: string;
  type: string;
  avant: Composant | null;
  apres: Composant | null;
  nature: "ajoute" | "retire" | "modifie";
};

export type EcartVersions = {
  phCible: { avant: number; apres: number } | null;
  composants: EcartComposant[];
};

/**
 * Ce qui distingue une version de son parent — le « changelog » §23.
 *
 * L'appariement se fait par `compoundId` quand il existe, sinon par le
 * couple type + nom. Pourquoi pas par l'`id` du composant : chaque
 * `MediumComponentAmount` reçoit un `UUID()` neuf à la création, et une
 * nouvelle version est saisie en repartant de la précédente — les
 * identifiants ne se correspondent donc pas d'une version à l'autre, et
 * s'y fier ferait lire « BAP retiré, BAP ajouté » là où la
 * concentration a simplement changé.
 *
 * Rien n'est déduit d'un écart : ce fichier dit CE QUI DIFFÈRE, jamais
 * POURQUOI, ni laquelle des deux versions est la meilleure. La raison
 * du changement est écrite par l'humain dans `change_reason`.
 */
export function ecartEntreVersions(parent: LigneVersion, enfant: LigneVersion): EcartVersions {
  const avant = lireComposants(parent.components).composants;
  const apres = lireComposants(enfant.components).composants;

  const cle = (c: Composant) => (c.compoundId ? `#${c.compoundId}` : `${c.type}//${c.name.trim().toLowerCase()}`);
  const parCleAvant = new Map(avant.map((c) => [cle(c), c]));
  const parCleApres = new Map(apres.map((c) => [cle(c), c]));

  const ecarts: EcartComposant[] = [];

  for (const composant of apres) {
    const precedent = parCleAvant.get(cle(composant));
    if (!precedent) {
      ecarts.push({ nom: composant.name, type: composant.type, avant: null, apres: composant, nature: "ajoute" });
    } else if (precedent.amount !== composant.amount || precedent.unit !== composant.unit) {
      ecarts.push({
        nom: composant.name,
        type: composant.type,
        avant: precedent,
        apres: composant,
        nature: "modifie",
      });
    }
  }

  for (const composant of avant) {
    if (!parCleApres.has(cle(composant))) {
      ecarts.push({ nom: composant.name, type: composant.type, avant: composant, apres: null, nature: "retire" });
    }
  }

  ecarts.sort((a, b) => {
    const rangA = ORDRE_TYPE_COMPOSANT[a.type as TypeComposant] ?? 99;
    const rangB = ORDRE_TYPE_COMPOSANT[b.type as TypeComposant] ?? 99;
    if (rangA !== rangB) return rangA - rangB;
    return a.nom.localeCompare(b.nom, "fr");
  });

  return {
    phCible: parent.target_ph === enfant.target_ph ? null : { avant: parent.target_ph, apres: enfant.target_ph },
    composants: ecarts,
  };
}

export function direEcart(ecart: EcartComposant): string {
  if (ecart.nature === "ajoute" && ecart.apres) return `ajouté à ${direConcentration(ecart.apres)}`;
  if (ecart.nature === "retire" && ecart.avant) return `retiré (était à ${direConcentration(ecart.avant)})`;
  if (ecart.avant && ecart.apres) return `${direConcentration(ecart.avant)} → ${direConcentration(ecart.apres)}`;
  return "—";
}

export function direTypeComposant(type: string): string {
  return libelle(LIBELLE_TYPE_COMPOSANT, type);
}

// ==================================================================
// 6. Les préparations réelles
// ==================================================================

export type EcartPesee = {
  pesee: PeseeReelle;
  composant: Composant | null;
  /** null quand la pesée réelle n'a pas été saisie. */
  ecartRelatif: number | null;
};

/**
 * Cible contre réel, pesée par pesée.
 *
 * `MediumBatchIngredient.ingredientId` pointe l'`id` d'un
 * `MediumComponentAmount` de la version employée : c'est le seul lien
 * fiable entre une pesée et la ligne de recette dont elle vient, et il
 * est stable ici (contrairement à la comparaison entre DEUX versions,
 * où les identifiants ne se correspondent pas).
 *
 * `actualAmount` reste facultatif dans le modèle : une préparation où
 * personne n'a noté la pesée réelle rend `null`, jamais un écart de
 * zéro — « conforme » et « non relevé » ne se confondent pas.
 */
export function ecartsDePreparation(
  preparation: LignePreparation,
  composantsDeLaVersion: readonly Composant[],
): EcartPesee[] {
  const parId = new Map(composantsDeLaVersion.filter((c) => c.id).map((c) => [c.id as string, c]));
  return lirePesees(preparation.compound_lots).map((pesee) => {
    const reel = pesee.actualAmount;
    const ecartRelatif =
      reel === null || reel === undefined || pesee.targetAmount === 0
        ? null
        : (reel - pesee.targetAmount) / pesee.targetAmount;
    return { pesee, composant: parId.get(pesee.ingredientId) ?? null, ecartRelatif };
  });
}

/**
 * Le volume à afficher pour une préparation.
 *
 * `volume_liters` a TOUJOURS voulu dire le volume réellement préparé —
 * l'amélioration §10 a ajouté `target_volume_liters` à côté sans le
 * redéfinir. Les confondre ferait passer une préparation ratée pour une
 * préparation conforme.
 */
export function direVolume(preparation: LignePreparation): string {
  const reel = `${formatNombre(preparation.volume_liters) ?? "?"} L`;
  if (preparation.target_volume_liters === null) return reel;
  if (preparation.target_volume_liters === preparation.volume_liters) return reel;
  return `${reel} (visé ${formatNombre(preparation.target_volume_liters) ?? "?"} L)`;
}

// ==================================================================
// 7. Les lectures
// ==================================================================

function echec<T>(vide: T, message: string | undefined): Lecture<T> {
  return { donnees: vide, erreur: message ?? "Lecture impossible" };
}

export async function lireRecettes(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<Lecture<LigneRecette[]>> {
  const { data, error } = await supabase
    .from("medium_recipes")
    .select(COLONNES_RECETTE)
    .eq("workspace_id", workspaceId)
    .order("name");
  if (error) return echec<LigneRecette[]>([], error.message);
  return { donnees: (data ?? []) as unknown as LigneRecette[], erreur: null };
}

export async function lireVersions(
  supabase: SupabaseClient,
  workspaceId: string,
  recetteId?: string,
): Promise<Lecture<LigneVersion[]>> {
  let requete = supabase
    .from("medium_recipe_versions")
    .select(COLONNES_VERSION)
    .eq("workspace_id", workspaceId);
  if (recetteId) requete = requete.eq("recipe_id", recetteId);
  const { data, error } = await requete.order("version_number");
  if (error) return echec<LigneVersion[]>([], error.message);
  return { donnees: (data ?? []) as unknown as LigneVersion[], erreur: null };
}

export async function lirePreparations(
  supabase: SupabaseClient,
  workspaceId: string,
  versionIds?: readonly string[],
): Promise<Lecture<LignePreparation[]>> {
  // Un tableau d'identifiants VIDE ne veut pas dire « toutes les
  // préparations » : il veut dire « aucune version, donc aucune
  // préparation ». Sans ce test, une recette sans version afficherait
  // les préparations de tout le laboratoire.
  if (versionIds && versionIds.length === 0) return { donnees: [], erreur: null };

  let requete = supabase
    .from("medium_batches")
    .select(COLONNES_PREPARATION)
    .eq("workspace_id", workspaceId);
  if (versionIds) requete = requete.in("recipe_version_id", versionIds as string[]);
  const { data, error } = await requete.order("prepared_at", { ascending: false });
  if (error) return echec<LignePreparation[]>([], error.message);
  return { donnees: (data ?? []) as unknown as LignePreparation[], erreur: null };
}

/**
 * L'historique attaché à des versions de recette.
 *
 * `biolab_audit_entries` est l'append-only du §7 « historiques ». Le
 * téléphone n'y écrit aujourd'hui que trois actions (`versioned`,
 * `split`, `stage_changed`) : ce n'est pas un journal de toutes les
 * modifications, et l'écran ne doit pas le présenter comme tel.
 */
export async function lireHistorique(
  supabase: SupabaseClient,
  workspaceId: string,
  entiteIds: readonly string[],
): Promise<Lecture<LigneHistorique[]>> {
  if (entiteIds.length === 0) return { donnees: [], erreur: null };
  const { data, error } = await supabase
    .from("biolab_audit_entries")
    .select(COLONNES_HISTORIQUE)
    .eq("workspace_id", workspaceId)
    .in("entity_id", entiteIds as string[])
    .order("occurred_at", { ascending: false });
  if (error) return echec<LigneHistorique[]>([], error.message);
  return { donnees: (data ?? []) as unknown as LigneHistorique[], erreur: null };
}

export async function lireRecette(
  supabase: SupabaseClient,
  workspaceId: string,
  recetteId: string,
): Promise<Lecture<LigneRecette | null>> {
  const { data, error } = await supabase
    .from("medium_recipes")
    .select(COLONNES_RECETTE)
    .eq("workspace_id", workspaceId)
    .eq("id", recetteId)
    .maybeSingle();
  if (error) return echec<LigneRecette | null>(null, error.message);
  return { donnees: (data as unknown as LigneRecette) ?? null, erreur: null };
}
