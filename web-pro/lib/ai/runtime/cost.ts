import { NIVEAUX_MODELE } from "../model/types.ts";
import type { SourceEnvironnement } from "../model/configuration.ts";
import { centimes, compteur, type MotifPanne, type NiveauModele } from "./types.ts";

/**
 * §11V — ÉTAPE 15 : `AICostControlService` (spec p. 17-19).
 *
 * ══════════════════════════════════════════════════════════════════
 * « NE JAMAIS BRÛLER DU BUDGET INUTILEMENT » (p. 17)
 * ══════════════════════════════════════════════════════════════════
 *
 * Trois gestes, dans cet ordre, et l'ordre est le service :
 *
 *   1. LE DÉTERMINISTE PASSE AVANT LE MODÈLE. Si le SQL répond, on ne
 *      paie personne. Ce n'est pas ce fichier qui le décide — c'est
 *      l'appelant qui déclare `reponseDeterministe` — mais c'est
 *      `run.ts` qui garantit l'ordre : la branche déterministe est
 *      testée avant toute autre.
 *
 *   2. LE CACHE SERT QUAND LA DONNÉE N'A PAS BOUGÉ. `ai_cache_lookup`
 *      (0076) refuse de servir une entrée dont l'empreinte des données
 *      sources diffère. On ne peut donc pas oublier d'invalider.
 *
 *   3. LES PLAFONDS SONT VÉRIFIÉS AVANT L'APPEL. Pas après. Un
 *      contrôle a posteriori constate un dépassement qu'il aurait pu
 *      empêcher, et le constate une fois par appel jusqu'à la fin du
 *      mois.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE CACHE EST CONSULTÉ AVANT LE PLAFOND. C'EST VOULU.
 * ══════════════════════════════════════════════════════════════════
 *
 * Une entreprise au plafond doit quand même obtenir une réponse déjà
 * calculée : la servir ne coûte rien. Couper le cache en même temps que
 * les appels transformerait un plafond de dépense en panne totale,
 * exactement au moment où l'utilisateur cherche à comprendre ce qui
 * consomme. L'ordre est donc : déterministe → cache → plafond → appel.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI IL N'Y A AUCUN TARIF ÉCRIT DANS CE FICHIER
 * ══════════════════════════════════════════════════════════════════
 *
 * Les trois identifiants de modèles n'ont pas pu être vérifiés (voir
 * `lib/ai/model/availability.ts`), et leurs tarifs encore moins.
 * Inventer un prix produirait un tableau de bord chiffré, donc crédible,
 * donc faux — et un plafond qui se déclencherait au mauvais moment.
 *
 * Trois conséquences assumées :
 *
 *   • les tarifs sont NULS par défaut, et se posent par variables
 *     d'environnement (`VARIABLES_TARIF`), PAR NIVEAU et jamais par nom
 *     de modèle. C'est ce qui permet de changer d'identifiant sans
 *     retoucher la grille — et de respecter la règle « aucun nom de
 *     modèle hors de `lib/ai/model/` » ;
 *
 *   • un niveau sans tarif produit un événement d'usage SANS MONTANT
 *     (`estimated_cost_cents` à `null`), jamais un montant à zéro.
 *     C'est la règle 2 de la migration 0076, appliquée côté serveur ;
 *
 *   • un plafond posé alors que des appels ne sont pas tarifés NE
 *     PROTÈGE DE RIEN, et `AICostControlService` le dit à voix haute
 *     (`avertissements`). Un plafond qu'on croit actif est pire qu'un
 *     plafond absent.
 */

// ==================================================================
// 1. LA GRILLE TARIFAIRE — par niveau, jamais par nom de modèle
// ==================================================================

export type Tarif = {
  /** Centimes entiers pour un million de jetons d'entrée. */
  entreeCentsParMillion: number;
  /** Centimes entiers pour un million de jetons de sortie. */
  sortieCentsParMillion: number;
};

export const VARIABLES_TARIF: Readonly<
  Record<NiveauModele, { entree: string; sortie: string }>
> = Object.freeze({
  economy: {
    entree: "OASIS_AI_TARIF_ECONOMY_ENTREE_CENTS_PAR_MILLION",
    sortie: "OASIS_AI_TARIF_ECONOMY_SORTIE_CENTS_PAR_MILLION",
  },
  standard: {
    entree: "OASIS_AI_TARIF_STANDARD_ENTREE_CENTS_PAR_MILLION",
    sortie: "OASIS_AI_TARIF_STANDARD_SORTIE_CENTS_PAR_MILLION",
  },
  advanced: {
    entree: "OASIS_AI_TARIF_ADVANCED_ENTREE_CENTS_PAR_MILLION",
    sortie: "OASIS_AI_TARIF_ADVANCED_SORTIE_CENTS_PAR_MILLION",
  },
});

/**
 * Le nom de la grille, écrit dans `ai_usage_events.cost_basis`.
 *
 * Sans lui, une facture du fournisseur en écart de 30 % avec le grand
 * livre serait indébrouillable : on ne saurait pas si le tarif a
 * changé, si le calcul est faux, ou si un appel a échappé au journal.
 */
export const BASE_TARIF_ENVIRONNEMENT = "grille-env";

export type GrilleTarifaire = {
  tarifs: Readonly<Record<NiveauModele, Tarif | null>>;
  /** `cost_basis` à écrire, ou `null` quand aucun tarif n'est posé. */
  base: string | null;
  /** Les variables mal renseignées. Elles ne sont PAS ignorées en silence. */
  anomalies: readonly { variable: string; valeur: string; raison: string }[];
};

/**
 * Lire la grille dans l'environnement.
 *
 * UN TARIF PARTIEL N'EST PAS UN TARIF. Poser l'entrée sans la sortie
 * donnerait un coût systématiquement sous-estimé — les jetons de sortie
 * sont les plus chers chez tous les fournisseurs. Le niveau reste donc
 * NON TARIFÉ, et l'anomalie le dit.
 */
export function lireGrilleTarifaire(env: SourceEnvironnement = process.env): GrilleTarifaire {
  const tarifs: Record<NiveauModele, Tarif | null> = {
    economy: null,
    standard: null,
    advanced: null,
  };
  const anomalies: { variable: string; valeur: string; raison: string }[] = [];
  let auMoinsUn = false;

  for (const niveau of NIVEAUX_MODELE) {
    const noms = VARIABLES_TARIF[niveau];
    const entree = lireEntier(env[noms.entree], noms.entree, anomalies);
    const sortie = lireEntier(env[noms.sortie], noms.sortie, anomalies);

    if (entree === null && sortie === null) continue;

    if (entree === null || sortie === null) {
      anomalies.push({
        variable: entree === null ? noms.entree : noms.sortie,
        valeur: "",
        raison:
          `Tarif incomplet pour le niveau « ${niveau} » : il faut les DEUX variables. ` +
          "Le niveau reste non tarifé, et ses appels seront comptés sans montant.",
      });
      continue;
    }

    tarifs[niveau] = { entreeCentsParMillion: entree, sortieCentsParMillion: sortie };
    auMoinsUn = true;
  }

  return {
    tarifs: Object.freeze(tarifs),
    base: auMoinsUn ? BASE_TARIF_ENVIRONNEMENT : null,
    anomalies: Object.freeze(anomalies),
  };
}

function lireEntier(
  brut: string | undefined,
  variable: string,
  anomalies: { variable: string; valeur: string; raison: string }[],
): number | null {
  if (brut === undefined) return null;
  const valeur = brut.trim();
  if (valeur === "") {
    anomalies.push({ variable, valeur: brut, raison: "Valeur vide : le niveau reste non tarifé." });
    return null;
  }
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 0) {
    // Surtout pas de repli sur 0 : un tarif à zéro rendrait l'IA
    // gratuite dans le tableau de bord, et le plafond ne se
    // déclencherait jamais.
    anomalies.push({
      variable,
      valeur: brut,
      raison: "Attendu un entier de centimes positif. Le niveau reste non tarifé.",
    });
    return null;
  }
  return n;
}

/**
 * L'estimation d'un appel, en centimes entiers, ou `null`.
 *
 * `null` veut dire « tarif inconnu ». Il traverse tout le système
 * jusqu'à `ai_usage_events.estimated_cost_cents`, qui est nullable
 * précisément pour l'accueillir.
 */
export function estimerCoutCents(
  tarif: Tarif | null,
  jetonsEntree: number,
  jetonsSortie: number,
): number | null {
  if (tarif === null) return null;
  const entree = compteur(jetonsEntree);
  const sortie = compteur(jetonsSortie);
  // Arrondi une seule fois, à la fin : arrondir chaque terme ferait
  // dériver le total de quelques centimes par millier d'appels.
  return Math.round(
    (entree * tarif.entreeCentsParMillion + sortie * tarif.sortieCentsParMillion) / 1_000_000,
  );
}

/**
 * La somme de plusieurs estimations.
 *
 * `null` DÈS QU'UN TERME EST INCONNU. Additionner en ignorant les
 * inconnus rendrait un total d'apparence complète, plus bas que la
 * réalité — la faute que `lib/ai/proposals.ts` a déjà corrigée sur les
 * totaux de devis.
 */
export function sommerCouts(couts: readonly (number | null)[]): number | null {
  let total = 0;
  for (const cout of couts) {
    if (cout === null) return null;
    total += cout;
  }
  return total;
}

// ==================================================================
// 2. LE BUDGET, TEL QUE 0076 LE REND
// ==================================================================

/**
 * La ligne rendue par `ai_cost_budget_remaining` (0076).
 *
 * TOUS LES CHAMPS SONT NULLABLES, et `null` sur un `remaining` veut dire
 * « aucune limite posée », JAMAIS « zéro ». La confusion des deux
 * couperait l'IA de toutes les entreprises qui n'ont rien configuré.
 */
export type BudgetIA = {
  limiteJourCents: number | null;
  depenseJourCents: number | null;
  resteJourCents: number | null;
  limiteMoisCents: number | null;
  depenseMoisCents: number | null;
  resteMoisCents: number | null;
  limiteAgentCents: number | null;
  depenseAgentCents: number | null;
  resteAgentCents: number | null;
  /** Le nombre d'appels du jour comptés SANS montant. Rend le total minorant. */
  appelsNonTarifesJour: number;
  appelsNonTarifesMois: number;
};

/** Le budget d'une organisation qui n'a posé aucune limite. */
export const BUDGET_SANS_LIMITE: BudgetIA = Object.freeze({
  limiteJourCents: null,
  depenseJourCents: null,
  resteJourCents: null,
  limiteMoisCents: null,
  depenseMoisCents: null,
  resteMoisCents: null,
  limiteAgentCents: null,
  depenseAgentCents: null,
  resteAgentCents: null,
  appelsNonTarifesJour: 0,
  appelsNonTarifesMois: 0,
});

/** Traduire la ligne SQL (snake_case) en `BudgetIA`. */
export function lireBudget(ligne: unknown): BudgetIA {
  if (typeof ligne !== "object" || ligne === null) return BUDGET_SANS_LIMITE;
  const r = ligne as Record<string, unknown>;
  return {
    limiteJourCents: centimes(r.daily_limit_cents),
    depenseJourCents: centimes(r.daily_spent_cents),
    resteJourCents: centimes(r.daily_remaining_cents),
    limiteMoisCents: centimes(r.monthly_limit_cents),
    depenseMoisCents: centimes(r.monthly_spent_cents),
    resteMoisCents: centimes(r.monthly_remaining_cents),
    limiteAgentCents: centimes(r.agent_limit_cents),
    depenseAgentCents: centimes(r.agent_spent_cents),
    resteAgentCents: centimes(r.agent_remaining_cents),
    appelsNonTarifesJour: compteur(r.unpriced_events_today),
    appelsNonTarifesMois: compteur(r.unpriced_events_month),
  };
}

export type VerdictBudget = {
  autorise: boolean;
  /** `budget_exceeded` quand refusé. Le vocabulaire de 0076. */
  motif: MotifPanne | null;
  /** Destiné à l'écran, en français. */
  message: string | null;
  /** Ce que l'exploitant doit savoir même quand l'appel est autorisé. */
  avertissements: readonly string[];
};

const NOMS_PLAFOND: Record<"jour" | "mois" | "agent", string> = {
  jour: "journalier",
  mois: "mensuel",
  agent: "de cet agent",
};

/**
 * Les plafonds sont-ils respectés, AVANT l'appel ?
 *
 * `coutPrevuCents` permet de refuser un appel qui ferait franchir la
 * limite plutôt que de constater le franchissement après coup. Il vaut
 * `null` quand le niveau n'est pas tarifé — et dans ce cas, seul un
 * reste DÉJÀ négatif ou nul refuse.
 */
export function verifierPlafonds(
  budget: BudgetIA,
  coutPrevuCents: number | null,
): VerdictBudget {
  const avertissements: string[] = [];

  const plafonds: { cle: "jour" | "mois" | "agent"; limite: number | null; reste: number | null }[] = [
    { cle: "jour", limite: budget.limiteJourCents, reste: budget.resteJourCents },
    { cle: "mois", limite: budget.limiteMoisCents, reste: budget.resteMoisCents },
    { cle: "agent", limite: budget.limiteAgentCents, reste: budget.resteAgentCents },
  ];

  const poses = plafonds.filter((p) => p.limite !== null);

  // L'AVERTISSEMENT QUI COMPTE LE PLUS : un plafond posé et des appels
  // non tarifés. La dépense affichée est alors un MINORANT, et le
  // plafond ne protège de rien.
  if (poses.length > 0 && budget.appelsNonTarifesMois > 0) {
    avertissements.push(
      `Un plafond est posé, mais ${budget.appelsNonTarifesMois} appel(s) du mois n'ont pas de tarif : ` +
        "la dépense affichée est un minorant et le plafond ne peut pas jouer. " +
        "Renseignez les variables OASIS_AI_TARIF_… pour le rendre effectif.",
    );
  }

  for (const plafond of poses) {
    const reste = plafond.reste;
    if (reste === null) continue; // limite posée sans reste calculable : rien à conclure

    if (reste <= 0) {
      return {
        autorise: false,
        motif: "budget_exceeded",
        message:
          `Le plafond de dépense IA ${NOMS_PLAFOND[plafond.cle]} est atteint. ` +
          "Un administrateur peut le relever dans les réglages.",
        avertissements,
      };
    }

    if (coutPrevuCents !== null && coutPrevuCents > reste) {
      return {
        autorise: false,
        motif: "budget_exceeded",
        message:
          `Cet appel dépasserait le plafond de dépense IA ${NOMS_PLAFOND[plafond.cle]} ` +
          `(il reste ${(reste / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}).`,
        avertissements,
      };
    }

    // Prévenir avant de couper : à 10 % du plafond, il reste le temps
    // de décider. Une coupure sans préavis se lit comme une panne.
    if (plafond.limite !== null && plafond.limite > 0 && reste * 10 <= plafond.limite) {
      avertissements.push(
        `Il reste moins de 10 % du plafond IA ${NOMS_PLAFOND[plafond.cle]}.`,
      );
    }
  }

  return { autorise: true, motif: null, message: null, avertissements };
}

// ==================================================================
// 3. LE RATIO — « mesuré et ajusté » (p. 17)
// ==================================================================

/**
 * L'approche indicative de la page 17 : ~15 % Luna, ~80 % Terra, ~5 % Sol.
 *
 * C'EST UNE CIBLE, PAS UNE RÈGLE. Rien dans le code ne force cette
 * répartition — la forcer voudrait dire refuser le bon modèle à une
 * demande légitime pour tenir une statistique. Ce qui est codé, c'est
 * la MESURE : sans elle, la page 17 resterait un vœu.
 */
export const RATIO_CIBLE: Readonly<Record<NiveauModele, number>> = Object.freeze({
  economy: 15,
  standard: 80,
  advanced: 5,
});

export type LigneRepartition = {
  /** L'identifiant de modèle tel qu'il figure dans `ai_usage_events`. */
  modele: string;
  appels: number;
  coutCents: number | null;
};

export type Repartition = {
  /** Part en pourcentage, un chiffre après la virgule. */
  parNiveau: Readonly<Record<NiveauModele, number>>;
  /** L'écart à la cible, en points. Positif = plus employé que prévu. */
  ecartCible: Readonly<Record<NiveauModele, number>>;
  appelsParNiveau: Readonly<Record<NiveauModele, number>>;
  /**
   * Les appels dont le modèle n'est plus dans la configuration.
   *
   * Ils ne sont PAS répartis d'office sur `standard` : un modèle
   * inconnu est le plus souvent un identifiant changé récemment, et le
   * ranger d'office fausserait justement la mesure qu'on regarde pour
   * arbitrer ce changement.
   */
  appelsNiveauInconnu: number;
  modelesInconnus: readonly string[];
  total: number;
  coutTotalCents: number | null;
  /**
   * Faux quand la lecture a été tronquée.
   *
   * Un ratio calculé sur un échantillon présenté comme un ratio complet
   * ferait arbitrer une répartition de modèles sur une moitié de mois
   * sans que personne ne le sache.
   */
  complet: boolean;
};

/**
 * Répartir les appels par niveau.
 *
 * La correspondance modèle → niveau vient de la configuration en
 * vigueur (`routeurModeles().modelesConfigures()`), passée en argument
 * pour que ce fichier n'ait, comme tous les autres, aucun nom de modèle.
 */
export function repartirParNiveau(
  lignes: readonly LigneRepartition[],
  modelesParNiveau: Readonly<Record<NiveauModele, string>>,
  complet = true,
): Repartition {
  const niveauDuModele = new Map<string, NiveauModele>();
  for (const niveau of NIVEAUX_MODELE) niveauDuModele.set(modelesParNiveau[niveau], niveau);

  const appels: Record<NiveauModele, number> = { economy: 0, standard: 0, advanced: 0 };
  const inconnus = new Set<string>();
  let appelsInconnus = 0;
  let total = 0;
  const couts: (number | null)[] = [];

  for (const ligne of lignes) {
    const n = compteur(ligne.appels);
    total += n;
    couts.push(ligne.coutCents);
    const niveau = niveauDuModele.get(ligne.modele);
    if (niveau === undefined) {
      appelsInconnus += n;
      inconnus.add(ligne.modele);
      continue;
    }
    appels[niveau] += n;
  }

  // Le dénominateur EXCLUT les modèles inconnus : une part calculée sur
  // un total qui contient des appels non classés serait mécaniquement
  // sous-estimée pour les trois niveaux, et la somme ne ferait pas 100.
  const base = total - appelsInconnus;
  const part = (n: number): number => (base <= 0 ? 0 : Math.round((n / base) * 1000) / 10);

  const parNiveau = {
    economy: part(appels.economy),
    standard: part(appels.standard),
    advanced: part(appels.advanced),
  };

  return {
    parNiveau: Object.freeze(parNiveau),
    ecartCible: Object.freeze({
      economy: Math.round((parNiveau.economy - RATIO_CIBLE.economy) * 10) / 10,
      standard: Math.round((parNiveau.standard - RATIO_CIBLE.standard) * 10) / 10,
      advanced: Math.round((parNiveau.advanced - RATIO_CIBLE.advanced) * 10) / 10,
    }),
    appelsParNiveau: Object.freeze(appels),
    appelsNiveauInconnu: appelsInconnus,
    modelesInconnus: [...inconnus],
    total,
    coutTotalCents: sommerCouts(couts),
    complet,
  };
}

// ==================================================================
// 4. LE MOIS, TEL QUE LA BASE LE COMPTE
// ==================================================================

/**
 * Le premier instant du mois EN HEURE DE PARIS, rendu en UTC.
 *
 * `ai_cost_budget_remaining` (0076) borne son mois sur
 * `date_trunc('month', now() at time zone 'Europe/Paris')`. Prendre ici
 * le 1ᵉʳ à 00:00 UTC amputerait le ratio des une ou deux premières
 * heures du mois. L'écart est petit, mais il fait que le tableau de
 * bord des coûts et le calcul du plafond ne parlent pas tout à fait de
 * la même période — et deux chiffres proches et différents sont plus
 * coûteux à démêler qu'un seul chiffre franchement faux.
 *
 * Cette fonction est ICI, dans un fichier pur, et pas dans
 * l'adaptateur Supabase : c'est précisément le genre de calcul de
 * fuseau qu'il faut pouvoir éprouver, y compris au passage à l'heure
 * d'été.
 */
export function debutDuMoisParis(maintenant: Date = new Date()): Date {
  const parties = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(maintenant);
  const annee = Number(parties.find((p) => p.type === "year")?.value);
  const mois = Number(parties.find((p) => p.type === "month")?.value);

  // Minuit du 1ᵉʳ LU COMME S'IL ÉTAIT UTC, puis corrigé du décalage
  // parisien en vigueur ce jour-là — heure d'été comprise.
  const minuitNaif = Date.UTC(annee, mois - 1, 1, 0, 0, 0, 0);
  return new Date(minuitNaif - decalageParisMs(new Date(minuitNaif)));
}

/** Le décalage de Paris par rapport à UTC, en millisecondes, à cet instant. */
export function decalageParisMs(instant: Date): number {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(format.formatToParts(instant).map((x) => [x.type, x.value]));
  const commeUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    // `en-CA` rend « 24 » pour minuit ; `% 24` le ramène à zéro.
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second),
  );
  return commeUtc - instant.getTime();
}

// ==================================================================
// 5. LE CACHE
// ==================================================================

/**
 * Une clé de cache lisible et stable.
 *
 * Les morceaux sont joints par « : » après avoir été normalisés ; un
 * morceau vide fait échouer plutôt que produire « quote::v1 », deux
 * clés différentes qui se confondraient un jour.
 *
 * LA CLÉ NE PORTE NI L'ORGANISATION NI LE MODÈLE : `ai_cache_lookup`
 * les prend en colonnes séparées, et les mettre aussi dans la clé
 * donnerait deux vérités à tenir d'accord.
 */
export function construireCleCache(morceaux: readonly string[]): string {
  if (morceaux.length === 0) throw new Error("Clé de cache vide.");
  const propres = morceaux.map((m) => m.trim().replace(/\s+/g, "-"));
  if (propres.some((m) => m.length === 0)) {
    throw new Error(`Clé de cache incomplète : ${JSON.stringify(morceaux)}.`);
  }
  return propres.join(":").slice(0, 200);
}

/**
 * Le port du contrôle de coût. Trois lectures, une écriture.
 *
 * L'adaptateur réel est dans `supabase.ts`. Les tests en fournissent un
 * faux : c'est ce qui permet d'éprouver « le plafond refuse avant
 * l'appel » sans base et sans jeton.
 */
export type PortCout = {
  /** `ai_cost_budget_remaining(org, agent)`. */
  budget(organizationId: string, agent: string | null): Promise<BudgetIA>;
  /** `ai_cache_lookup(...)`. Rend `null` en cas de défaut de cache. */
  lireCache(appel: {
    organizationId: string;
    agent: string;
    cle: string;
    modele: string;
    empreinte: string;
  }): Promise<unknown | null>;
  /** `ai_cache_store(...)`. Un échec d'écriture ne doit rien casser. */
  ecrireCache(appel: {
    organizationId: string;
    agent: string;
    cle: string;
    modele: string;
    empreinte: string;
    resultat: unknown;
    ttlSecondes: number;
    sources: readonly string[];
    dateArreteDonnees: string;
  }): Promise<void>;
  /**
   * Les appels du mois, groupés par identifiant de modèle.
   *
   * `complet` dit si la lecture a tout vu. Un adaptateur qui borne sa
   * requête doit rendre `false` : voir `Repartition.complet`.
   */
  repartition(
    organizationId: string,
  ): Promise<{ lignes: readonly LigneRepartition[]; complet: boolean }>;
};

export type OptionsCout = {
  grille?: GrilleTarifaire;
  /** Durée de vie par défaut d'une entrée de cache. Dix minutes, comme 0076. */
  ttlSecondesParDefaut?: number;
};

export class AICostControlService {
  readonly #port: PortCout;
  readonly #grille: GrilleTarifaire;
  readonly #ttl: number;

  constructor(port: PortCout, options: OptionsCout = {}) {
    this.#port = port;
    this.#grille = options.grille ?? lireGrilleTarifaire();
    this.#ttl = options.ttlSecondesParDefaut ?? 600;
  }

  grille(): GrilleTarifaire {
    return this.#grille;
  }

  tarif(niveau: NiveauModele): Tarif | null {
    return this.#grille.tarifs[niveau];
  }

  /** `cost_basis` à écrire au journal, ou `null` si rien n'est tarifé. */
  baseTarifaire(): string | null {
    return this.#grille.base;
  }

  estimer(niveau: NiveauModele, jetonsEntree: number, jetonsSortie: number): number | null {
    return estimerCoutCents(this.tarif(niveau), jetonsEntree, jetonsSortie);
  }

  /**
   * Une estimation AVANT l'appel, à partir d'une taille de contexte.
   *
   * Grossière et assumée : on ne connaît pas le nombre de jetons de
   * sortie avant de les avoir reçus. Elle sert uniquement à refuser un
   * appel qui franchirait manifestement le plafond, jamais à facturer.
   * Quatre caractères par jeton est l'ordre de grandeur usuel pour du
   * français ; la sortie est supposée égale au quart de l'entrée.
   */
  estimerAvantAppel(niveau: NiveauModele, tailleContexteCaracteres: number): number | null {
    const jetonsEntree = Math.ceil(compteur(tailleContexteCaracteres) / 4);
    return this.estimer(niveau, jetonsEntree, Math.ceil(jetonsEntree / 4));
  }

  async budget(organizationId: string, agent: string | null): Promise<BudgetIA> {
    return this.#port.budget(organizationId, agent);
  }

  /** Le contrôle complet avant l'appel. */
  async autoriserAppel(demande: {
    organizationId: string;
    agent: string;
    niveau: NiveauModele;
    tailleContexteCaracteres: number;
  }): Promise<VerdictBudget> {
    const budget = await this.#port.budget(demande.organizationId, demande.agent);
    const prevu = this.estimerAvantAppel(demande.niveau, demande.tailleContexteCaracteres);
    return verifierPlafonds(budget, prevu);
  }

  async lireCache(appel: {
    organizationId: string;
    agent: string;
    cle: string;
    modele: string;
    empreinte: string;
  }): Promise<unknown | null> {
    return this.#port.lireCache(appel);
  }

  async ecrireCache(appel: {
    organizationId: string;
    agent: string;
    cle: string;
    modele: string;
    empreinte: string;
    resultat: unknown;
    ttlSecondes?: number;
    sources: readonly string[];
    dateArreteDonnees: string;
  }): Promise<void> {
    await this.#port.ecrireCache({ ...appel, ttlSecondes: appel.ttlSecondes ?? this.#ttl });
  }

  /** Le ratio réellement observé, comparé à la cible de la page 17. */
  async ratio(
    organizationId: string,
    modelesParNiveau: Readonly<Record<NiveauModele, string>>,
  ): Promise<Repartition> {
    const { lignes, complet } = await this.#port.repartition(organizationId);
    return repartirParNiveau(lignes, modelesParNiveau, complet);
  }
}
