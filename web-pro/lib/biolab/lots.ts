import {
  echecDeLecture,
  PLAFOND_ANTI_JOINTURE,
  type Lecture,
  SEUIL_INSPECTION_JOURS,
  STADES,
  STATUTS_LOT,
  type Stade,
  type StatutLot,
} from "./cultures.ts";

/**
 * §7 « lots », « sous-lots », « plantes mères » — LA LISTE ET LA FICHE.
 *
 * UN SEUL ÉCRAN POUR « CULTURES » ET POUR « LOTS », ET C'EST MESURÉ.
 * Le §7 énumère les deux mots l'un après l'autre, mais la base n'a
 * qu'une table : `culture_batches`. Le mobile n'a lui aussi qu'une
 * liste (`CultureBatchListView`). Construire deux écrans qui lisent la
 * même table avec les mêmes colonnes serait le « second système » que
 * le §6 interdit, avec la certitude qu'ils divergeraient au premier
 * filtre ajouté d'un seul côté.
 *
 * Les SOUS-LOTS ne sont pas non plus une table : c'est
 * `culture_batches.parent_batch_id`, une auto-référence, le résultat du
 * geste « Diviser le lot » du téléphone. Ils sont donc un FILTRE de
 * cette liste et une SECTION de la fiche, pas un troisième écran.
 *
 * Les PLANTES MÈRES ne sont pas une table non plus :
 * `culture_batches.mother_plant_id` pointe vers `plants`, c'est-à-dire
 * vers le monde du jardin. Une plante mère est une plante ordinaire
 * utilisée comme donneuse d'explants — c'est le commentaire du modèle
 * Swift, mot pour mot. Elle est donc une ligne de la fiche du lot et
 * un filtre de la liste, jamais un écran de plus.
 */

// ==================================================================
// 1. CE QUE L'URL PORTE
// ==================================================================

/** §37 — assez de lignes pour balayer, assez peu pour que la page reste légère. */
export const PAR_PAGE = 25;

export const TRIS = {
  recents: { label: "Récents", colonne: "started_at", croissant: false },
  code: { label: "Code", colonne: "batch_code", croissant: true },
  espece: { label: "Espèce", colonne: "species_name", croissant: true },
  explants: { label: "Explants", colonne: "current_count", croissant: false },
  echeance: { label: "Échéance", colonne: "expected_end_at", croissant: true },
} as const;
export type Tri = keyof typeof TRIS;
export const TRI_PAR_DEFAUT: Tri = "recents";

/** Les vues de lignée : une lignée entière, ou seulement ses branches. */
export const LIGNEES = {
  "": "Tous les lots",
  origines: "Lots d'origine",
  "sous-lots": "Sous-lots",
} as const;
export type Lignee = keyof typeof LIGNEES;

/** Les échéances, telles que le tableau de bord y renvoie. */
export const ECHEANCES = {
  "": "Toutes les échéances",
  depassee: "Terme dépassé",
  semaine: "Cette semaine",
} as const;
export type Echeance = keyof typeof ECHEANCES;

export type ParametresListe = {
  q: string;
  stade: Stade | "";
  statut: StatutLot | "";
  lignee: Lignee;
  echeance: Echeance;
  /** Un lot contaminé : c'est une INSPECTION qui le dit, pas une colonne du lot. */
  contamination: "" | "confirmee";
  /** Les lots jamais inspectés — le lien du tableau de bord. */
  inspection: "" | "jamais";
  tri: Tri;
  page: number;
};

/** Un paramètre d'URL répété arrive en tableau : on ne garde que le premier. */
function lire(valeur: string | string[] | undefined): string {
  if (Array.isArray(valeur)) return valeur[0] ?? "";
  return valeur ?? "";
}

/**
 * Les paramètres de la liste, validés contre les vocabulaires réels.
 *
 * Tout ce qui n'est pas reconnu retombe sur « aucun filtre » plutôt que
 * de descendre tel quel dans une requête : une valeur inventée dans
 * l'URL doit donner la liste entière, pas une erreur ni un filtre que
 * personne n'a demandé.
 */
export function lireParametres(
  params: Record<string, string | string[] | undefined>,
): ParametresListe {
  const stadeBrut = lire(params.stade);
  const statutBrut = lire(params.statut);
  const ligneeBrute = lire(params.lignee);
  const echeanceBrute = lire(params.echeance);
  const contaminationBrute = lire(params.contamination);
  const inspectionBrute = lire(params.inspection);
  const triBrut = lire(params.tri);

  return {
    q: lire(params.q).trim(),
    stade: (STADES as readonly string[]).includes(stadeBrut) ? (stadeBrut as Stade) : "",
    statut: (STATUTS_LOT as readonly string[]).includes(statutBrut)
      ? (statutBrut as StatutLot)
      : "",
    lignee: ligneeBrute in LIGNEES && ligneeBrute !== "" ? (ligneeBrute as Lignee) : "",
    echeance: echeanceBrute in ECHEANCES && echeanceBrute !== "" ? (echeanceBrute as Echeance) : "",
    contamination: contaminationBrute === "confirmee" ? "confirmee" : "",
    inspection: inspectionBrute === "jamais" ? "jamais" : "",
    tri: triBrut in TRIS ? (triBrut as Tri) : TRI_PAR_DEFAUT,
    page: Math.max(1, Number.parseInt(lire(params.page), 10) || 1),
  };
}

/**
 * L'URL de la liste, filtres compris.
 *
 * Les clés vides disparaissent et l'ordre est fixe : deux appels qui
 * décrivent le même état produisent la même chaîne, ce dont dépend
 * `FilterBar` pour savoir quelle pastille est allumée. `page` n'est
 * jamais reporté — changer de filtre remet au début, sinon on atterrit
 * sur la page 4 d'une liste qui n'en a plus que deux.
 */
export function construireLien(
  base: ParametresListe,
  modifs: Partial<Record<keyof ParametresListe, string>> = {},
): string {
  const valeurs: Record<string, string> = {
    q: base.q,
    stade: base.stade,
    statut: base.statut,
    lignee: base.lignee,
    echeance: base.echeance,
    contamination: base.contamination,
    inspection: base.inspection,
    tri: base.tri === TRI_PAR_DEFAUT ? "" : base.tri,
    ...modifs,
  };
  const recherche = new URLSearchParams();
  for (const clef of [
    "q",
    "stade",
    "statut",
    "lignee",
    "echeance",
    "contamination",
    "inspection",
    "tri",
    "page",
  ]) {
    const valeur = valeurs[clef];
    if (valeur) recherche.set(clef, valeur);
  }
  const chaine = recherche.toString();
  return chaine ? `/biolab/lots?${chaine}` : "/biolab/lots";
}

export function filtreActif(p: ParametresListe): boolean {
  return Boolean(
    p.q || p.stade || p.statut || p.lignee || p.echeance || p.contamination || p.inspection,
  );
}

// ==================================================================
// 2. LA LISTE
// ==================================================================

export type LigneLot = {
  id: string;
  batch_code: string;
  species_name: string;
  cultivar: string | null;
  culture_stage: string;
  status: string;
  started_at: string;
  expected_end_at: string | null;
  initial_explant_count: number;
  current_count: number;
  parent_batch_id: string | null;
  mother_plant_id: string | null;
};

export const COLONNES_LOT =
  "id, batch_code, species_name, cultivar, culture_stage, status, started_at, expected_end_at, initial_explant_count, current_count, parent_batch_id, mother_plant_id";

export type PageDeLots = {
  lignes: LigneLot[];
  total: number;
  pages: number;
  /**
   * Le message de la base quand la lecture a échoué.
   *
   * Sans lui, un échec rendait `lignes: []` et l'écran annonçait
   * « aucun lot ne correspond ». Une panne et un laboratoire vide se
   * ressemblent à l'écran et n'ont rien à voir.
   */
  erreur: string | null;
  /**
   * Vrai quand un filtre a dû être appliqué en deux temps — donc quand
   * `total` compte les lots RETENUS et non ceux de la requête de base.
   * L'écran s'en sert pour ne pas promettre une pagination exacte
   * qu'il ne peut pas tenir.
   */
  filtreEnDeuxTemps: boolean;
};

/**
 * Le plafond des filtres en deux temps.
 *
 * « Contaminé » et « jamais inspecté » ne sont pas des colonnes du lot :
 * ce sont des faits portés par `bioreactor_inspections`. PostgREST ne
 * sait pas exprimer l'anti-jointure qu'il faudrait, donc on lit la
 * liste des identifiants concernés, puis on la pose sur la requête.
 * Au-delà de ce nombre on préfère s'arrêter plutôt que d'envoyer une
 * clause `in` de plusieurs milliers d'identifiants.
 */
export const PLAFOND_DEUX_TEMPS = PLAFOND_ANTI_JOINTURE;

export async function lireLots(
  workspaceId: string,
  p: ParametresListe,
  maintenant: Date = new Date(),
): Promise<PageDeLots> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  // ------------------------------------------------------------
  // Les deux filtres qui passent par les inspections.
  // ------------------------------------------------------------
  let identifiantsRetenus: string[] | null = null;
  let filtreEnDeuxTemps = false;

  if (p.contamination === "confirmee") {
    filtreEnDeuxTemps = true;
    const { data, error } = await supabase
      .from("bioreactor_inspections")
      .select("culture_batch_id")
      .eq("workspace_id", workspaceId)
      .eq("contamination_status", "confirmed")
      .not("culture_batch_id", "is", null)
      .limit(PLAFOND_DEUX_TEMPS);
    if (error) return { lignes: [], total: 0, pages: 1, filtreEnDeuxTemps: true, erreur: error.message };
    identifiantsRetenus = [
      ...new Set(
        ((data ?? []) as { culture_batch_id: string }[]).map((i) => i.culture_batch_id),
      ),
    ];
  }

  if (p.inspection === "jamais") {
    filtreEnDeuxTemps = true;

    /**
     * LA MÊME DÉFINITION QUE LE TABLEAU DE BORD, MOT POUR MOT.
     *
     * Le tableau de bord annonce « N lots sans aucune inspection » en
     * ne retenant que les lots ACTIFS commencés il y a au moins
     * quatorze jours — c'est la règle de
     * `BioLabAlertService.scanInspectionRecency`. Si cette liste-ci
     * retenait tous les lots jamais inspectés, quel que soit leur âge,
     * on cliquerait sur « 3 lots » pour en trouver onze. Un écart entre
     * un compteur et la liste qu'il ouvre se lit comme un bogue, et
     * c'en serait un.
     */
    const seuil = new Date(
      maintenant.getTime() - SEUIL_INSPECTION_JOURS * 86_400_000,
    ).toISOString();

    /**
     * L'ANTI-JOINTURE EST BORNÉE PAR LES CANDIDATS, PAS PAR ELLE-MÊME.
     *
     * La version précédente lisait les MILLE PREMIÈRES inspections de
     * l'espace, sans tri, et en déduisait la liste des lots déjà
     * regardés. Au-delà de mille inspections — ce qu'un laboratoire
     * atteint en quelques mois — l'ensemble était tronqué
     * arbitrairement, et tout lot dont l'inspection tombait hors de ces
     * mille lignes était classé « jamais inspecté ». La liste
     * désignait alors comme négligés des lots qui ne l'étaient pas.
     *
     * En filtrant les inspections SUR les candidats, la borne devient
     * celle des candidats : la réponse ne peut plus être tronquée d'un
     * côté sans l'être de l'autre. C'est le motif que le tableau de
     * bord emploie déjà, et les deux partagent désormais la même
     * constante — sans quoi le compteur et la liste qu'il ouvre
     * comptaient sur des bornes différentes.
     */
    const candidats = await supabase
      .from("culture_batches")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .lte("started_at", seuil)
      .order("started_at")
      .limit(PLAFOND_DEUX_TEMPS);

    if (candidats.error) {
      return {
        lignes: [], total: 0, pages: 1, filtreEnDeuxTemps: true,
        erreur: candidats.error.message,
      };
    }

    const idsCandidats = ((candidats.data ?? []) as { id: string }[]).map((l) => l.id);
    let inspectes = new Set<string>();
    if (idsCandidats.length > 0) {
      const inspectionsFaites = await supabase
        .from("bioreactor_inspections")
        .select("culture_batch_id")
        .eq("workspace_id", workspaceId)
        .in("culture_batch_id", idsCandidats);
      if (inspectionsFaites.error) {
        return {
          lignes: [], total: 0, pages: 1, filtreEnDeuxTemps: true,
          erreur: inspectionsFaites.error.message,
        };
      }
      inspectes = new Set(
        ((inspectionsFaites.data ?? []) as { culture_batch_id: string }[]).map(
          (i) => i.culture_batch_id,
        ),
      );
    }
    const restants = idsCandidats.filter((id) => !inspectes.has(id));

    if (identifiantsRetenus === null) {
      identifiantsRetenus = restants;
    } else {
      const garde = new Set(restants);
      identifiantsRetenus = identifiantsRetenus.filter((id) => garde.has(id));
    }
  }

  // Un filtre en deux temps qui ne retient aucun identifiant est une
  // réponse VIDE, pas une absence de filtre. Sans ce retour, la liste
  // afficherait tous les lots alors qu'aucun n'est contaminé.
  if (identifiantsRetenus !== null && identifiantsRetenus.length === 0) {
    return { lignes: [], total: 0, pages: 1, filtreEnDeuxTemps, erreur: null };
  }

  // ------------------------------------------------------------
  // La requête, décrite UNE fois.
  // ------------------------------------------------------------
  const requete = () => {
    let r = supabase
      .from("culture_batches")
      .select(COLONNES_LOT, { count: "exact" })
      .eq("workspace_id", workspaceId);

    if (p.stade) r = r.eq("culture_stage", p.stade);
    if (p.statut) r = r.eq("status", p.statut);
    if (p.lignee === "origines") r = r.is("parent_batch_id", null);
    if (p.lignee === "sous-lots") r = r.not("parent_batch_id", "is", null);

    if (p.echeance === "depassee") {
      r = r
        .eq("status", "active")
        .not("expected_end_at", "is", null)
        .lt("expected_end_at", maintenant.toISOString());
    } else if (p.echeance === "semaine") {
      r = r
        .eq("status", "active")
        .gte("expected_end_at", maintenant.toISOString())
        .lte("expected_end_at", new Date(maintenant.getTime() + 7 * 86_400_000).toISOString());
    }

    if (identifiantsRetenus !== null) r = r.in("id", identifiantsRetenus);

    if (p.q) {
      // Les caractères que PostgREST lirait comme de la syntaxe de filtre.
      const sur = p.q.replace(/[%,()]/g, " ");
      r = r.or(
        `batch_code.ilike.%${sur}%,species_name.ilike.%${sur}%,cultivar.ilike.%${sur}%,explant_type.ilike.%${sur}%`,
      );
    }
    return r;
  };

  const ordre = TRIS[p.tri];
  const debut = (p.page - 1) * PAR_PAGE;

  const { data, count, error } = await requete()
    .order(ordre.colonne, { ascending: ordre.croissant, nullsFirst: false })
    // Départage les ex æquo : sans second critère, deux lots de même
    // date peuvent échanger leur place d'une page à l'autre, et l'un des
    // deux ne s'afficherait jamais.
    .order("batch_code", { ascending: true })
    .range(debut, debut + PAR_PAGE - 1);

  if (error) {
    return { lignes: [], total: 0, pages: 1, filtreEnDeuxTemps, erreur: error.message };
  }

  const total = count ?? 0;
  return {
    lignes: (data ?? []) as unknown as LigneLot[],
    total,
    pages: Math.max(1, Math.ceil(total / PAR_PAGE)),
    filtreEnDeuxTemps,
    erreur: null,
  };
}

// ==================================================================
// 3. LA FICHE
// ==================================================================

export type PlanteMere = {
  id: string;
  custom_name: string | null;
  common_name: string | null;
  scientific_name: string | null;
  garden_id: string | null;
  is_archived: boolean | null;
};

export type FicheLot = LigneLot & {
  explant_type: string | null;
  culture_system: string | null;
  notes: string | null;
  medium_recipe_version_id: string | null;
  plants: PlanteMere | null;
  medium_recipe_versions: {
    id: string;
    version_number: number;
    medium_recipes: { id: string; name: string } | null;
  } | null;
};

export async function lireFicheLot(
  workspaceId: string,
  id: string,
): Promise<Lecture<FicheLot | null>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("culture_batches")
    .select(
      `${COLONNES_LOT}, explant_type, culture_system, notes, medium_recipe_version_id,
       plants ( id, custom_name, common_name, scientific_name, garden_id, is_archived ),
       medium_recipe_versions ( id, version_number, medium_recipes ( id, name ) )`,
    )
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();

  // Un lot introuvable et une lecture refusée ne se disent pas de la
  // même façon : le premier est un 404 honnête, le second une panne.
  if (error) return echecDeLecture<FicheLot | null>(null, error.message);
  return { donnees: (data ?? null) as unknown as FicheLot | null, erreur: null };
}

/** Le nom d'une plante mère, dans l'ordre où un producteur la reconnaît. */
export function nomDePlante(plante: PlanteMere): string {
  return (
    plante.custom_name?.trim() ||
    plante.common_name?.trim() ||
    plante.scientific_name?.trim() ||
    "Plante sans nom"
  );
}

// ------------------------------------------------------------------
// 3 bis. LA FILIATION
// ------------------------------------------------------------------

/** Une ligne de `biolab_genealogie_lot` (0087, §4.5). */
export type LigneGenealogie = {
  lot_id: string;
  code: string;
  espece: string;
  stade: string;
  statut: string;
  explants: number;
  parent_id: string | null;
  profondeur: number;
  est_racine: boolean;
};

export type NoeudLignee = {
  id: string;
  code: string;
  espece: string;
  stade: string;
  statut: string;
  explants: number;
  profondeur: number;
  enfants: NoeudLignee[];
};

/**
 * La lignée d'un lot, telle que la base la rend.
 *
 * Elle remonte d'abord à la RACINE puis redescend — c'est exactement ce
 * que fait `CultureLineageService.tree` sur le téléphone, et pour la
 * même raison qu'il écrit lui-même : « l'arbre montré doit partir de la
 * vraie origine, pas de l'endroit où l'utilisateur a ouvert un lot ».
 * On ne le recalcule donc pas ici ; on l'appelle.
 */
export async function lireGenealogie(lotId: string): Promise<Lecture<LigneGenealogie[]>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("biolab_genealogie_lot", { p_lot_id: lotId });
  // « Ce lot n'a ni parent ni sous-lot » est une AFFIRMATION. Tant que
  // la migration 0087 n'est pas appliquée, cet appel répond HTTP 404 :
  // l'affirmation était donc fausse pour tout le monde, et la fiche se
  // contredisait à l'écran — la ligne « Lot parent », qui lit une
  // colonne locale, affichait un lien juste au-dessus.
  if (error) return echecDeLecture<LigneGenealogie[]>([], error.message);
  return { donnees: (data ?? []) as LigneGenealogie[], erreur: null };
}

/**
 * Les lignes plates de la base, remises en arbre pour l'affichage.
 *
 * FONCTION PURE — c'est de la mise en forme, pas du calcul : aucun
 * chiffre n'est produit ici, seul l'emboîtement l'est.
 *
 * TROIS PRÉCAUTIONS, et chacune répond à un cas qui arrive vraiment :
 *
 *   • un lot dont le parent n'est PAS dans la liste devient une racine
 *     de l'affichage. La récursion de 0087 est bornée à 64 niveaux et le
 *     parent peut vivre dans un autre espace de travail : sans cette
 *     règle, une branche entière disparaîtrait sans que rien ne le dise ;
 *   • un identifiant vu deux fois n'est ajouté qu'une fois ;
 *   • le tri est fait sur le code, comme sur le téléphone
 *     (`childBatches.sorted { $0.batchCode < $1.batchCode }`), pour que
 *     les deux montrent le même arbre dans le même ordre.
 */
export function arbreDeLignee(lignes: LigneGenealogie[]): NoeudLignee[] {
  // On dédoublonne AVANT de rattacher, et pas seulement en construisant
  // les nœuds : rattacher deux fois la même ligne ferait apparaître le
  // même lot deux fois sous son parent. La fonction de base rend un
  // `distinct on (b.id)`, mais s'appuyer là-dessus rendrait l'affichage
  // dépendant d'un détail de la requête.
  const uniques = new Map<string, LigneGenealogie>();
  for (const l of lignes) {
    if (!uniques.has(l.lot_id)) uniques.set(l.lot_id, l);
  }

  const parId = new Map<string, NoeudLignee>();
  for (const l of uniques.values()) {
    parId.set(l.lot_id, {
      id: l.lot_id,
      code: l.code,
      espece: l.espece,
      stade: l.stade,
      statut: l.statut,
      explants: l.explants,
      profondeur: l.profondeur,
      enfants: [],
    });
  }

  const racines: NoeudLignee[] = [];
  for (const l of uniques.values()) {
    const noeud = parId.get(l.lot_id);
    if (!noeud) continue;
    const parent = l.parent_id ? parId.get(l.parent_id) : undefined;
    // `parent !== noeud` ferme le cas du lot qui serait son propre
    // parent : `parent_batch_id` n'interdit pas un cycle, et c'est
    // exactement pour cela que la récursion de la base est bornée.
    if (parent && parent !== noeud) parent.enfants.push(noeud);
    else racines.push(noeud);
  }

  const trier = (noeuds: NoeudLignee[]) => {
    noeuds.sort((a, b) => a.code.localeCompare(b.code, "fr"));
    for (const n of noeuds) trier(n.enfants);
  };
  trier(racines);

  return racines;
}

/** Le nombre de lots d'une lignée, le lot d'origine compris. */
export function tailleDeLignee(racines: NoeudLignee[]): number {
  let n = 0;
  const parcourir = (noeuds: NoeudLignee[]) => {
    for (const noeud of noeuds) {
      n += 1;
      parcourir(noeud.enfants);
    }
  };
  parcourir(racines);
  return n;
}

// ------------------------------------------------------------------
// 3 ter. CE QUI PEND À UN LOT
// ------------------------------------------------------------------

export type Inspection = {
  id: string;
  date: string;
  culture_appearance: string | null;
  contamination_status: string;
  hyperhydricity_status: string;
  necrosis_status: string;
  browning_status: string;
  growth_status: string | null;
  estimated_count: number | null;
  notes: string | null;
};

export type Acclimatation = {
  id: string;
  culture_batch_id: string | null;
  started_at: string;
  initial_plantlet_count: number;
  current_survivor_count: number;
  substrate: string | null;
  humidity_program: string | null;
  temperature: number | null;
  location: string | null;
  status: string;
  plants_created: boolean;
  notes: string | null;
};

export const COLONNES_ACCLIMATATION =
  "id, culture_batch_id, started_at, initial_plantlet_count, current_survivor_count, substrate, humidity_program, temperature, location, status, plants_created, notes";

export type Etiquette = {
  id: string;
  type: string;
  public_token: string;
  active: boolean;
  rack_label: string | null;
  last_scanned_at: string | null;
};

export type LigneHistorique = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  detail: string | null;
  performed_by: string | null;
  occurred_at: string;
};

export async function lireInspections(
  workspaceId: string,
  lotId: string,
  limite = 30,
): Promise<Lecture<Inspection[]>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bioreactor_inspections")
    .select(
      "id, date, culture_appearance, contamination_status, hyperhydricity_status, necrosis_status, browning_status, growth_status, estimated_count, notes",
    )
    .eq("workspace_id", workspaceId)
    .eq("culture_batch_id", lotId)
    .order("date", { ascending: false })
    .limit(limite);
  if (error) return echecDeLecture<Inspection[]>([], error.message);
  return { donnees: (data ?? []) as Inspection[], erreur: null };
}

export async function lireAcclimatations(
  workspaceId: string,
  lotId?: string,
): Promise<Lecture<Acclimatation[]>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  let r = supabase
    .from("acclimatization_batches")
    .select(COLONNES_ACCLIMATATION)
    .eq("workspace_id", workspaceId);
  if (lotId) r = r.eq("culture_batch_id", lotId);
  const { data, error } = await r.order("started_at", { ascending: false }).limit(200);
  if (error) return echecDeLecture<Acclimatation[]>([], error.message);
  return { donnees: (data ?? []) as Acclimatation[], erreur: null };
}

export async function lireEtiquettes(
  workspaceId: string,
  lotId: string,
): Promise<Lecture<Etiquette[]>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("smart_tags")
    .select("id, type, public_token, active, rack_label, last_scanned_at")
    .eq("workspace_id", workspaceId)
    .eq("culture_batch_id", lotId)
    .order("created_at", { ascending: false });
  if (error) return echecDeLecture<Etiquette[]>([], error.message);
  return { donnees: (data ?? []) as Etiquette[], erreur: null };
}

/**
 * L'historique d'un objet.
 *
 * `biolab_audit_entries` n'a pas de clé étrangère vers le lot : elle
 * porte `entity_type` (un nom de TABLE) et `entity_id`. C'est la
 * convention du modèle Swift, choisie pour que le journal survive au
 * renommage d'un type — on la respecte plutôt que d'en inventer une
 * autre côté web.
 */
export async function lireHistorique(
  workspaceId: string,
  entiteId: string,
  limite = 50,
): Promise<Lecture<LigneHistorique[]>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("biolab_audit_entries")
    .select("id, entity_type, entity_id, action, detail, performed_by, occurred_at")
    .eq("workspace_id", workspaceId)
    .eq("entity_id", entiteId)
    .order("occurred_at", { ascending: false })
    .limit(limite);
  // « Rien d'horodaté pour l'instant » est une affirmation, et le
  // journal est justement l'endroit où l'on vient chercher la preuve
  // qu'il s'est passé quelque chose.
  if (error) return echecDeLecture<LigneHistorique[]>([], error.message);
  return { donnees: (data ?? []) as LigneHistorique[], erreur: null };
}

/**
 * LES DEUX SEULS RAPPORTS CALCULÉS HORS DE POSTGRES, ET POURQUOI ILS
 * SONT ACCEPTABLES.
 *
 * La règle du chantier est nette : tout calcul vient du serveur, deux
 * arrondis valent deux chiffres. Elle vise les AGRÉGATS — moyennes,
 * taux d'ensemble, totaux — parce qu'un agrégat recalculé ailleurs
 * finit toujours par diverger de sa définition d'origine. Ces
 * agrégats-là viennent tous des six lectures de la migration 0087,
 * sans exception.
 *
 * Les deux fonctions ci-dessous ne sont pas des agrégats : elles
 * divisent DEUX COLONNES D'UNE MÊME LIGNE déjà lue. Il n'y a pas
 * d'ensemble sur lequel deux définitions pourraient diverger, et la
 * définition est celle du modèle Swift, recopiée avec sa précaution :
 * NULL quand le dénominateur est nul, jamais zéro. « 0 % de survie » et
 * « aucune plantule n'est entrée » sont deux affirmations différentes.
 */

/** `AcclimatizationBatch.survivalRate` — survivantes sur entrées. */
export function tauxDeSurvie(acclimatation: Acclimatation): number | null {
  if (acclimatation.initial_plantlet_count <= 0) return null;
  return acclimatation.current_survivor_count / acclimatation.initial_plantlet_count;
}

/**
 * Le rendement d'un lot : explants d'aujourd'hui sur explants de
 * départ. Même définition que celle que `biolab_tableau_de_bord`
 * moyenne — mais sur un seul lot, où il n'y a rien à moyenner.
 */
export function facteurDeMultiplication(lot: {
  initial_explant_count: number;
  current_count: number;
}): number | null {
  if (lot.initial_explant_count <= 0) return null;
  return lot.current_count / lot.initial_explant_count;
}
