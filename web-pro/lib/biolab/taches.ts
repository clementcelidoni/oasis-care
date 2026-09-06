/**
 * §7 « tâches » — CE QUI EST DÛ, MESURÉ SUR LES DATES QUI EXISTENT
 * VRAIMENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL N'Y A NI TABLE DE TÂCHES, NI AFFECTATION. ON NE LES INVENTE PAS.
 * ══════════════════════════════════════════════════════════════════
 *
 * Mesuré sur les vingt et une tables BioLab : aucune ne porte de tâche,
 * aucune ne porte d'assigné. `biolab_alerts` a un type, une priorité, un
 * message et une date de résolution — pas de destinataire.
 * `bioreactor_maintenance` est un journal d'événements PASSÉS, en ajout
 * seul (le modèle mobile le dit : « un enregistrement d'entretien est un
 * fait historique »), et ne porte aucune périodicité : rien dans ce
 * produit ne dit qu'un filtre se change tous les trente jours.
 *
 * DEUX CONSÉQUENCES QUE CET ÉCRAN DOIT ASSUMER, ET DIRE :
 *
 *   1. PAS DE « À QUI ». Afficher une colonne « assigné à » vide, ou pire
 *      la remplir avec le responsable de l'entreprise, ferait croire à
 *      une répartition du travail qui n'existe nulle part. La question
 *      « qui s'en occupe ? » n'a pas de réponse dans ce modèle, et un
 *      écran qui fait semblant d'en avoir une est plus nuisible qu'un
 *      écran qui l'avoue.
 *
 *   2. PAS DE TÂCHE RÉCURRENTE. On ne déduit pas « nettoyage dû » de
 *      « dernier nettoyage il y a 40 jours » : il faudrait une
 *      périodicité, et la choisir ici reviendrait à écrire une règle de
 *      métier que le produit n'a jamais énoncée — sur un sujet où se
 *      tromper coûte une contamination.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON PEUT DIRE, ALORS : LES ÉCHÉANCES QUE LA BASE PORTE DÉJÀ
 * ══════════════════════════════════════════════════════════════════
 *
 * Une tâche, ici, n'est pas un objet qu'on crée : c'est une DATE
 * DÉPASSÉE OU PROCHE, lue sur une colonne réelle. Il y en a de deux
 * familles :
 *
 *   • CÔTÉ CULTURE — les lots au-delà de leur terme, ceux qui y
 *     arrivent, ceux jamais inspectés, et les alertes non résolues
 *     écrites par le téléphone. Ces quatre-là sont DÉJÀ définies dans
 *     `cultures.ts` (`lireMatiereAttention`), et ce fichier les REPREND
 *     telles quelles au lieu de les redéfinir. Deux seuils de quatorze
 *     jours qui dériveraient l'un de l'autre finiraient par afficher
 *     deux listes différentes du même laboratoire.
 *
 *   • CÔTÉ PAILLASSE — les péremptions et les seuils de stock, que le
 *     tableau de bord ne fait que COMPTER (`articles_stock_faible`) sans
 *     jamais dire lesquels. C'est le seul apport propre de ce fichier.
 *
 * LA DIFFÉRENCE AVEC LE TABLEAU DE BORD, pour qu'on ne la confonde pas :
 * `/biolab` répond à « qu'est-ce que je décide ce matin » et s'arrête à
 * cinq lignes ; cette page-ci est la LISTE COMPLÈTE, triée par
 * échéance, celle qu'on garde ouverte pendant qu'on travaille.
 */

import {
  joursDepuis,
  libelle,
  ALERTE_LABELS,
  SEUIL_INSPECTION_JOURS,
  type MatiereAttention,
  type Ton,
} from "./cultures.ts";

// ==================================================================
// 1. L'HORIZON — À PARTIR DE QUAND UNE PÉREMPTION EST UNE TÂCHE
// ==================================================================

/**
 * TRENTE JOURS, et c'est un choix de produit, pas une règle de
 * laboratoire.
 *
 * Le raisonnement : une péremption ne devient une tâche que tant qu'on
 * peut encore AGIR — commander, reformuler une solution mère, planifier
 * la préparation autrement. Un mois est l'ordre de grandeur d'un délai
 * de réapprovisionnement de consommable de laboratoire. Plus court, on
 * apprend la rupture trop tard ; plus long, la liste se remplit de
 * choses sur lesquelles on ne fera rien aujourd'hui, et une liste qu'on
 * ne peut pas vider cesse d'être lue.
 *
 * Ce qui est DÉJÀ périmé apparaît toujours, quelle que soit
 * l'ancienneté : un flacon périmé sur une étagère reste un risque tant
 * que personne ne l'a sorti.
 */
export const HORIZON_PEREMPTION_JOURS = 30;

// ==================================================================
// 2. CE QUE LA PAILLASSE REND
// ==================================================================

export type ArticleStock = {
  id: string;
  name: string | null;
  category: string | null;
  current_quantity: number | null;
  minimum_threshold: number | null;
  unit: string | null;
  expiry_date: string | null;
};

export type SolutionMere = {
  id: string;
  name: string | null;
  expires_at: string | null;
  remaining_volume_liters: number | null;
  storage_location: string | null;
};

export type LotApprovisionnement = {
  id: string;
  lot_number: string | null;
  expires_at: string | null;
  quantity_remaining: number | null;
  unit: string | null;
  compose: string | null;
};

export type MatierePaillasse = {
  articles: ArticleStock[];
  solutions: SolutionMere[];
  approvisionnements: LotApprovisionnement[];
};

// ==================================================================
// 3. UNE ÉCHÉANCE
// ==================================================================

/**
 * Les quatre paliers, dans l'ordre où on s'en occupe.
 *
 * `retard` et `aujourdhui` sont séparés délibérément : « c'était pour
 * hier » et « c'est pour aujourd'hui » ne demandent pas la même chose —
 * le premier appelle une explication, le second une organisation de
 * journée.
 */
export const URGENCES = ["retard", "aujourdhui", "semaine", "plus-tard"] as const;
export type Urgence = (typeof URGENCES)[number];

export const URGENCE_LABELS: Record<Urgence, string> = {
  retard: "En retard",
  aujourdhui: "Aujourd'hui",
  semaine: "Cette semaine",
  "plus-tard": "À venir",
};

export const URGENCE_TON: Record<Urgence, Ton> = {
  retard: "critical",
  aujourdhui: "warning",
  semaine: "accent",
  "plus-tard": "neutral",
};

/** Les familles, pour que la liste puisse se filtrer. */
export const FAMILLES = ["alerte", "culture", "inspection", "stock", "peremption"] as const;
export type Famille = (typeof FAMILLES)[number];

export const FAMILLE_LABELS: Record<Famille, string> = {
  alerte: "Alerte de l'appareil",
  culture: "Conduite de culture",
  inspection: "Inspection",
  stock: "Réapprovisionnement",
  peremption: "Péremption",
};

export type Echeance = {
  id: string;
  famille: Famille;
  /** Ce qu'il y a à faire, à l'infinitif ou au constat. */
  quoi: string;
  /** L'objet concerné : un code de lot, un nom de produit. */
  objet: string | null;
  /** Le détail qui permet de décider sans ouvrir la fiche. */
  detail: string;
  urgence: Urgence;
  /**
   * Les jours d'écart avec l'échéance : négatif si en retard, positif
   * si à venir, 0 pour aujourd'hui. null quand l'échéance n'a pas de
   * date — une alerte de pompe est due « maintenant », pas à une date.
   */
  jours: number | null;
  lien?: { label: string; href: string };
};

/**
 * Le palier d'une date d'échéance.
 *
 * FONCTION PURE, l'instant est reçu — même raison que partout ailleurs
 * dans ce module : une page rendue au serveur doit dater toutes ses
 * lignes du même instant, sans quoi deux échéances identiques peuvent
 * tomber de part et d'autre de minuit.
 *
 * LE JOUR SE COMPTE EN JOURS CALENDAIRES, pas en tranches de vingt-
 * quatre heures : quelque chose qui expire ce soir à 23 h est « pour
 * aujourd'hui », pas « dans 0,9 jour ». C'est ainsi qu'un chef de
 * culture lit son planning.
 */
export function urgenceDe(
  echeance: string | null | undefined,
  maintenant: Date,
): { urgence: Urgence; jours: number | null } {
  if (!echeance) return { urgence: "aujourdhui", jours: null };
  const instant = new Date(echeance);
  if (!Number.isFinite(instant.getTime())) return { urgence: "aujourdhui", jours: null };

  const jourEcheance = Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
  );
  const jourCourant = Date.UTC(
    maintenant.getUTCFullYear(),
    maintenant.getUTCMonth(),
    maintenant.getUTCDate(),
  );
  const jours = Math.round((jourEcheance - jourCourant) / 86_400_000);

  if (jours < 0) return { urgence: "retard", jours };
  if (jours === 0) return { urgence: "aujourdhui", jours };
  if (jours <= 7) return { urgence: "semaine", jours };
  return { urgence: "plus-tard", jours };
}

/** « il y a 3 jours », « dans 12 jours », « aujourd'hui ». */
export function direEcheance(jours: number | null): string {
  if (jours === null) return "sans date";
  if (jours === 0) return "aujourd'hui";
  if (jours < 0) {
    const retard = Math.abs(jours);
    return `il y a ${retard} jour${retard > 1 ? "s" : ""}`;
  }
  return `dans ${jours} jour${jours > 1 ? "s" : ""}`;
}

// ==================================================================
// 4. LA COMPOSITION DE LA LISTE
// ==================================================================

const GRAVITE_ALERTE: Record<string, number> = {
  critical: 3,
  important: 2,
  warning: 1,
  info: 0,
};

const RANG_URGENCE: Record<Urgence, number> = {
  retard: 0,
  aujourdhui: 1,
  semaine: 2,
  "plus-tard": 3,
};

/**
 * Toutes les échéances du laboratoire, dans l'ordre où on les traite.
 *
 * FONCTION PURE — elle ne compte rien qu'on ne lui ait donné, n'appelle
 * ni base ni horloge. C'est ce qui la rend éprouvable ligne à ligne, et
 * c'est nécessaire : tout ce que l'écran des tâches affirme sort d'ici.
 *
 * ELLE NE CRÉE AUCUNE ÉCHÉANCE À PARTIR DE RIEN. Chaque ligne rendue
 * s'adosse à une colonne réelle — `expected_end_at`, `expiry_date`,
 * `expires_at`, `minimum_threshold`, `created_at` d'une alerte, ou la
 * règle des quatorze jours du mobile. Aucune périodicité inventée,
 * aucune tâche d'entretien déduite.
 */
export function echeances(
  attention: MatiereAttention,
  paillasse: MatierePaillasse,
  maintenant: Date,
): Echeance[] {
  const sortie: Echeance[] = [];

  // ---------------------------------------------------------------
  // 1. Les alertes écrites par le téléphone.
  //
  // Elles n'ont pas de date d'échéance : une pompe qui ne répond pas
  // est due maintenant. On les range donc en « aujourd'hui » quelle que
  // soit leur ancienneté — sauf à les avoir laissées passer, auquel cas
  // c'est l'ancienneté qui parle, et elle est dans le détail.
  // ---------------------------------------------------------------
  for (const alerte of attention.alertes) {
    const age = joursDepuis(alerte.created_at, maintenant);
    sortie.push({
      id: `alerte-${alerte.id}`,
      famille: "alerte",
      quoi: libelle(ALERTE_LABELS, alerte.alert_type),
      objet: null,
      // Le message a été composé par le téléphone avec le code du lot ou
      // du bioréacteur concerné ; le réécrire ici le ferait diverger.
      detail: alerte.message,
      urgence:
        alerte.priority === "critical" || alerte.priority === "important"
          ? "retard"
          : "aujourdhui",
      jours: age > 0 ? -age : 0,
    });
  }

  // ---------------------------------------------------------------
  // 2. Les lots au-delà de leur terme, puis ceux qui y arrivent.
  // ---------------------------------------------------------------
  for (const lot of attention.finDeCycleDepassee) {
    const { urgence, jours } = urgenceDe(lot.expected_end_at, maintenant);
    sortie.push({
      id: `terme-${lot.id}`,
      famille: "culture",
      quoi: "Fin de cycle dépassée",
      objet: lot.batch_code,
      detail:
        "À repiquer, à passer au stade suivant, ou à clore. Un lot laissé au-delà de son terme s'épuise dans son milieu.",
      urgence,
      jours,
      lien: { label: "Ouvrir le lot", href: `/biolab/lots/${lot.id}` },
    });
  }

  for (const lot of attention.finDeCycleProche) {
    const { urgence, jours } = urgenceDe(lot.expected_end_at, maintenant);
    sortie.push({
      id: `terme-proche-${lot.id}`,
      famille: "culture",
      quoi: "Fin de cycle prévue",
      objet: lot.batch_code,
      detail: "Prévoyez le milieu, les bocaux et la paillasse.",
      urgence,
      jours,
      lien: { label: "Ouvrir le lot", href: `/biolab/lots/${lot.id}` },
    });
  }

  // ---------------------------------------------------------------
  // 3. Les lots jamais inspectés.
  //
  // Même définition que `BioLabAlertService.scanInspectionRecency` :
  // actifs depuis au moins quatorze jours, AUCUNE inspection du tout.
  // Le seuil vient de `cultures.ts`, il n'est pas réécrit ici.
  // ---------------------------------------------------------------
  for (const lot of attention.jamaisInspectes) {
    const age = joursDepuis(lot.started_at, maintenant);
    sortie.push({
      id: `inspection-${lot.id}`,
      famille: "inspection",
      quoi: "Jamais inspecté",
      objet: lot.batch_code,
      detail: `Actif depuis ${age} jours, aucun relevé enregistré. Une contamination qui démarre ne se voit que là.`,
      urgence: "retard",
      // Le retard se compte depuis le jour où le seuil a été franchi,
      // pas depuis le début du lot : c'est à partir de là que le relevé
      // manque.
      jours: -(age - SEUIL_INSPECTION_JOURS),
      lien: { label: "Ouvrir le lot", href: `/biolab/lots/${lot.id}` },
    });
  }

  // ---------------------------------------------------------------
  // 4. Les consommables sous leur seuil.
  //
  // Le seuil est celui que l'utilisateur a fixé lui-même
  // (`minimum_threshold`) : on ne le devine pas. Un article sans seuil
  // n'est pas « à zéro », il est hors du dispositif — on le laisse donc
  // tranquille plutôt que de le signaler à tort.
  // ---------------------------------------------------------------
  for (const article of paillasse.articles) {
    const seuil = article.minimum_threshold;
    const quantite = article.current_quantity;
    if (seuil === null || seuil === undefined) continue;
    if (quantite === null || quantite === undefined) continue;
    if (quantite > seuil) continue;

    const unite = article.unit ? ` ${article.unit}` : "";
    sortie.push({
      id: `stock-${article.id}`,
      famille: "stock",
      quoi: quantite <= 0 ? "Épuisé" : "Sous le seuil",
      objet: article.name,
      detail:
        quantite <= 0
          ? `Il n'en reste rien. Seuil fixé à ${seuil}${unite}.`
          : `Il reste ${quantite}${unite}, pour un seuil fixé à ${seuil}${unite}.`,
      // Une rupture est en retard, un seuil franchi est pour
      // aujourd'hui : le premier arrête la paillasse, le second la
      // prévient.
      urgence: quantite <= 0 ? "retard" : "aujourdhui",
      jours: null,
    });
  }

  // ---------------------------------------------------------------
  // 5. Les péremptions — consommables, solutions mères, lots reçus.
  // ---------------------------------------------------------------
  for (const article of paillasse.articles) {
    const echeance = perimeSiConcerne(article.expiry_date, maintenant);
    if (!echeance) continue;
    sortie.push({
      id: `peremption-article-${article.id}`,
      famille: "peremption",
      quoi: echeance.urgence === "retard" ? "Périmé" : "Bientôt périmé",
      objet: article.name,
      detail:
        echeance.urgence === "retard"
          ? "À sortir de la paillasse : un consommable périmé fausse une préparation sans prévenir."
          : "À utiliser en premier, ou à remplacer.",
      urgence: echeance.urgence,
      jours: echeance.jours,
    });
  }

  for (const solution of paillasse.solutions) {
    const echeance = perimeSiConcerne(solution.expires_at, maintenant);
    if (!echeance) continue;
    const reste = solution.remaining_volume_liters;
    sortie.push({
      id: `peremption-solution-${solution.id}`,
      famille: "peremption",
      quoi: echeance.urgence === "retard" ? "Solution mère périmée" : "Solution mère bientôt périmée",
      objet: solution.name,
      detail: [
        reste !== null && reste !== undefined ? `Il reste ${reste} L.` : null,
        solution.storage_location ? `Rangée : ${solution.storage_location}.` : null,
        echeance.urgence === "retard" ? "À refaire avant la prochaine préparation." : null,
      ]
        .filter(Boolean)
        .join(" "),
      urgence: echeance.urgence,
      jours: echeance.jours,
    });
  }

  for (const lot of paillasse.approvisionnements) {
    const echeance = perimeSiConcerne(lot.expires_at, maintenant);
    if (!echeance) continue;
    const reste = lot.quantity_remaining;
    const unite = lot.unit ? ` ${lot.unit}` : "";
    sortie.push({
      id: `peremption-appro-${lot.id}`,
      famille: "peremption",
      quoi: echeance.urgence === "retard" ? "Lot de produit périmé" : "Lot de produit bientôt périmé",
      objet: lot.compose ?? lot.lot_number,
      detail: [
        lot.lot_number ? `Lot ${lot.lot_number}.` : null,
        reste !== null && reste !== undefined ? `Reste ${reste}${unite}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      urgence: echeance.urgence,
      jours: echeance.jours,
    });
  }

  // ---------------------------------------------------------------
  // L'ordre : l'urgence d'abord, puis le retard le plus grand, puis
  // la gravité pour les alertes qui n'ont pas de date. Un ordre stable,
  // pour que deux affichages successifs ne se réarrangent pas sous
  // les yeux de celui qui coche sa liste.
  // ---------------------------------------------------------------
  return sortie.sort((a, b) => {
    const rang = RANG_URGENCE[a.urgence] - RANG_URGENCE[b.urgence];
    if (rang !== 0) return rang;
    const joursA = a.jours ?? 0;
    const joursB = b.jours ?? 0;
    if (joursA !== joursB) return joursA - joursB;
    return a.quoi.localeCompare(b.quoi, "fr");
  });
}

/**
 * Une date de péremption mérite-t-elle une ligne ?
 *
 * Oui si elle est passée — un flacon périmé reste un risque tant qu'il
 * est sur l'étagère — ou si elle tombe dans l'horizon. Non au-delà :
 * voir `HORIZON_PEREMPTION_JOURS`.
 */
function perimeSiConcerne(
  date: string | null | undefined,
  maintenant: Date,
): { urgence: Urgence; jours: number } | null {
  if (!date) return null;
  const { urgence, jours } = urgenceDe(date, maintenant);
  if (jours === null) return null;
  if (jours > HORIZON_PEREMPTION_JOURS) return null;
  return { urgence, jours };
}

/** Le décompte par palier, pour l'en-tête de la page. */
export function compterParUrgence(liste: Echeance[]): Record<Urgence, number> {
  const compte: Record<Urgence, number> = {
    retard: 0,
    aujourdhui: 0,
    semaine: 0,
    "plus-tard": 0,
  };
  for (const echeance of liste) compte[echeance.urgence] += 1;
  return compte;
}

/** Le regroupement par palier, dans l'ordre des paliers. */
export function grouperParUrgence(liste: Echeance[]): { urgence: Urgence; lignes: Echeance[] }[] {
  return URGENCES.map((urgence) => ({
    urgence,
    lignes: liste.filter((echeance) => echeance.urgence === urgence),
  })).filter((groupe) => groupe.lignes.length > 0);
}

/**
 * La gravité d'une alerte, pour le tri secondaire de l'écran.
 *
 * Exportée parce que l'écran des tâches en a besoin pour classer les
 * alertes entre elles ; la définition reste unique.
 */
export function graviteAlerte(priorite: string | null | undefined): number {
  if (!priorite) return 0;
  return GRAVITE_ALERTE[priorite] ?? 0;
}

// ==================================================================
// 5. LA LECTURE
// ==================================================================

/**
 * Va chercher la matière de la paillasse.
 *
 * Trois requêtes bornées, portées par la RLS du client serveur. On ne
 * filtre PAS les péremptions dans la requête : `expiry_date` peut être
 * nul, et un `lte` sur une colonne nulle écarterait silencieusement les
 * articles sans date — qui sont précisément ceux qu'on veut voir dans
 * la liste des seuils. Le tri se fait dans `echeances`, où il se lit.
 */
export async function lireMatierePaillasse(
  workspaceId: string,
): Promise<{ matiere: MatierePaillasse; erreur: string | null }> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const [articles, solutions, approvisionnements] = await Promise.all([
    supabase
      .from("lab_inventory_items")
      .select("id, name, category, current_quantity, minimum_threshold, unit, expiry_date")
      .eq("workspace_id", workspaceId)
      .order("name")
      .limit(500),

    supabase
      .from("stock_solutions")
      .select("id, name, expires_at, remaining_volume_liters, storage_location")
      .eq("workspace_id", workspaceId)
      .not("expires_at", "is", null)
      .order("expires_at")
      .limit(500),

    supabase
      .from("inventory_lots")
      .select("id, lot_number, expires_at, quantity_remaining, unit, lab_compounds ( name )")
      .eq("workspace_id", workspaceId)
      .not("expires_at", "is", null)
      .order("expires_at")
      .limit(500),
  ]);

  // Une liste de tâches amputée d'une de ses sources est plus
  // dangereuse qu'une page en erreur : on la croit complète, et on
  // conclut que rien n'est dû. Le premier échec disqualifie donc la
  // page entière.
  const erreur =
    articles.error?.message ??
    solutions.error?.message ??
    approvisionnements.error?.message ??
    null;

  const matiere: MatierePaillasse = {
    articles: (articles.data ?? []) as ArticleStock[],
    solutions: (solutions.data ?? []) as SolutionMere[],
    approvisionnements: ((approvisionnements.data ?? []) as unknown[]).map((ligne) => {
      const brut = ligne as {
        id: string;
        lot_number: string | null;
        expires_at: string | null;
        quantity_remaining: number | null;
        unit: string | null;
        lab_compounds: { name: string | null } | null;
      };
      return {
        id: brut.id,
        lot_number: brut.lot_number,
        expires_at: brut.expires_at,
        quantity_remaining: brut.quantity_remaining,
        unit: brut.unit,
        compose: brut.lab_compounds?.name ?? null,
      };
    }),
  };

  return { matiere, erreur };
}
