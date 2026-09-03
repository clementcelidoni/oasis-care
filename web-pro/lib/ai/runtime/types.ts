import type { CleAgentModele, NiveauModele, NiveauRisque } from "../model/types.ts";
import type { Permission } from "../../auth/permissions.ts";

/**
 * §11V — LE VOCABULAIRE DE LA PLOMBERIE DES AGENTS
 * (spec « Architecture IA des Agents », p. 7, 17-23).
 *
 * Ce fichier ne contient AUCUN identifiant de modèle et AUCUN nom de
 * fonction SQL. Il ne parle que de niveaux (`economy`, `standard`,
 * `advanced`) et de motifs. Les trois identifiants vivent dans
 * `lib/ai/model/router.ts` ; les noms de fonctions vivent dans
 * `tools.ts`, où chacun a été vérifié contre la base.
 *
 * ─── POURQUOI CE DOSSIER N'IMPORTE JAMAIS « @/… » ───
 *
 * Les tests tournent avec `node --test --experimental-strip-types`, qui
 * ne connaît pas l'alias `@/` de Next. Tout ce qui doit être éprouvé
 * s'importe donc en chemin relatif, et tout ce qui touche Supabase est
 * derrière un PORT injectable (voir `run.ts`). Ce n'est pas une
 * contorsion de test : c'est ce qui permet d'éprouver l'escalade, le
 * repli, la décision de cache et le respect des plafonds sans réseau,
 * sans base, et donc sans dépenser un jeton.
 */

// ------------------------------------------------------------------
// La confiance rendue par un agent
// ------------------------------------------------------------------
//
// CETTE LISTE RECOPIE `CONFIDENCES` DE `lib/ai/types.ts`, et
// `coherence.test.ts` de ce dossier échoue si les deux divergent. On ne
// peut pas importer l'original : il tire `@/components/ui` pour une
// histoire de couleurs, ce qui ferait entrer React dans un test de
// plomberie.

export const CONFIANCES = ["high", "medium", "low", "insufficient_data"] as const;
export type Confiance = (typeof CONFIANCES)[number];

/**
 * « Données insuffisantes » N'EST PAS une confiance faible, et toute la
 * politique d'escalade tient sur cette distinction (voir
 * `escalation.ts`). `lib/ai/types.ts` l'écrit déjà pour les écrans ;
 * ici elle a une conséquence financière directe.
 */
export function estDonneesInsuffisantes(confiance: Confiance): boolean {
  return confiance === "insufficient_data";
}

// ------------------------------------------------------------------
// Les motifs de panne — VOCABULAIRE FERMÉ, RECOPIÉ DE 0076
// ------------------------------------------------------------------
//
// `ai_usage_events.failure_reason` porte un `check (… in (…))` avec
// exactement ces six valeurs. Une septième inventée ici ferait échouer
// l'insertion du journal — c'est-à-dire ferait disparaître la dépense
// du tableau de bord au moment précis où quelque chose va mal.

export const MOTIFS_PANNE = [
  "model_unavailable",
  "rate_limit",
  "timeout",
  "provider_error",
  "budget_exceeded",
  "other",
] as const;
export type MotifPanne = (typeof MOTIFS_PANNE)[number];

/** Les quatre pannes de la page 23. `budget_exceeded` est un refus, pas une panne. */
export const PANNES_FOURNISSEUR: readonly MotifPanne[] = [
  "model_unavailable",
  "rate_limit",
  "timeout",
  "provider_error",
];

export const LIBELLES_PANNE: Record<MotifPanne, string> = {
  model_unavailable: "Modèle indisponible",
  rate_limit: "Limite de débit atteinte chez le fournisseur",
  timeout: "Délai dépassé",
  provider_error: "Erreur du fournisseur",
  budget_exceeded: "Plafond de dépense IA atteint",
  other: "Erreur non identifiée",
};

/**
 * La phrase de la page 23, mot pour mot.
 *
 * Elle est ici, en constante, parce qu'elle ne doit PAS être reformulée
 * au fil des appelants : « Service temporairement indisponible » est ce
 * que l'utilisateur doit lire quand une décision critique n'a pas pu
 * être prise. Une variante du genre « Oasis n'a rien trouvé » serait
 * une dégradation silencieuse déguisée en réponse.
 */
export const MESSAGE_INDISPONIBLE = "Service temporairement indisponible.";

// ------------------------------------------------------------------
// La criticité d'une tâche
// ------------------------------------------------------------------

/**
 * Ce que coûte une réponse dégradée.
 *
 * `critique` INTERDIT le repli vers un niveau inférieur (p. 23 : « Ne
 * pas dégrader silencieusement une décision critique »). Ce n'est pas
 * le même axe que `NiveauRisque`, qui décrit ce que coûte l'ACTION
 * proposée : une question de direction sur la trésorerie du trimestre
 * ne propose aucune action — risque nul — et mérite pourtant qu'on
 * refuse de répondre plutôt que de répondre avec le petit modèle.
 */
export type Criticite = "ordinaire" | "critique";

// ------------------------------------------------------------------
// L'identité d'un appel — spec p. 21-22, MULTI-TENANT
// ------------------------------------------------------------------

/**
 * « Chaque appel agent possède : organizationId, workspaceId, userId,
 * permissions. » (p. 21-22)
 *
 * Les quatre champs sont OBLIGATOIRES et non nullables. Un
 * `organizationId` optionnel serait un `organizationId` oublié, et la
 * phrase suivante de la spec — « Organisation A ne peut jamais
 * interroger Organisation B » — cesserait d'être vraie par
 * construction pour ne plus l'être que par vigilance.
 */
export type IdentiteAppel = {
  organizationId: string;
  workspaceId: string;
  userId: string;
  permissions: readonly Permission[];
};

// ------------------------------------------------------------------
// Ce qu'un modèle rend, vu par la plomberie
// ------------------------------------------------------------------

/**
 * La sortie d'UNE tentative.
 *
 * Les jetons sont des entiers et ne sont PAS optionnels : un appel dont
 * on ne compte pas les jetons est un appel qui ne coûte rien au tableau
 * de bord, donc un tableau de bord faux. Quand le fournisseur ne les
 * donne pas, l'appelant passe 0 explicitement — et il le sait.
 */
export type SortieModele = {
  /** Le texte final, s'il y en a un. */
  texte: string | null;
  /** La sortie structurée (Zod / structured outputs, p. 13). */
  donnees: unknown;
  /** Ce que l'agent dit de sa propre confiance. */
  confiance: Confiance;
  /**
   * Vrai quand l'agent déclare que la situation reste ambiguë. C'est
   * le second déclencheur d'escalade de la p. 7 (« still ambiguous »),
   * et il est DÉCLARÉ par l'agent, jamais deviné par la plomberie.
   */
  ambigu: boolean;
  jetonsEntree: number;
  jetonsSortie: number;
  appelsOutils: number;
};

/** Ce qui a été demandé au modèle, une fois le niveau tranché. */
export type TentativeModele = {
  niveau: NiveauModele;
  modele: string;
};

/** La trace d'un repli (p. 23). Jamais optionnelle : voir `run.ts`. */
export type InfoRepli = {
  deNiveau: NiveauModele;
  deModele: string;
  versNiveau: NiveauModele;
  versModele: string;
  motif: MotifPanne;
  /** En français, pour l'écran ET pour le journal. */
  explication: string;
};

/** La trace d'une escalade (p. 7). */
export type EtapeEscalade = {
  deNiveau: NiveauModele;
  versNiveau: NiveauModele;
  /** Le déclencheur : confiance insuffisante, ambiguïté, fort impact. */
  declencheur: DeclencheurEscalade;
  explication: string;
};

export const DECLENCHEURS_ESCALADE = [
  "confiance_insuffisante",
  "ambiguite_declaree",
  "impact_financier",
  "risque_eleve",
] as const;
export type DeclencheurEscalade = (typeof DECLENCHEURS_ESCALADE)[number];

// ------------------------------------------------------------------
// D'où vient une réponse
// ------------------------------------------------------------------

/**
 * `deterministe` = calculée par le SQL, sans modèle. `cache` = déjà
 * calculée, données inchangées. `modele` = payée.
 *
 * Cette énumération est exposée jusqu'à l'écran parce que c'est la
 * seule façon honnête de dire à quelqu'un qu'Oasis n'a pas « réfléchi »
 * à sa question : il a ressorti la réponse d'il y a huit minutes.
 */
export type OrigineReponse = "deterministe" | "cache" | "modele";

// ------------------------------------------------------------------
// Le résultat d'un appel d'agent, tel que le reste du produit le voit
// ------------------------------------------------------------------

export type ResultatAgent =
  | {
      ok: true;
      origine: OrigineReponse;
      sortie: SortieModele;
      /** `null` quand la réponse n'a coûté aucun appel (déterministe, cache). */
      tentative: TentativeModele | null;
      /**
       * NON OPTIONNEL. Un appelant ne peut pas « oublier » de regarder
       * s'il y a eu repli : le champ existe toujours, et vaut `null`
       * quand le modèle demandé est celui qui a répondu.
       */
      repli: InfoRepli | null;
      /** Vide quand rien n'a été escaladé. Une entrée par montée. */
      escalades: readonly EtapeEscalade[];
      /**
       * Le coût estimé de l'ENSEMBLE des tentatives, en centimes
       * entiers, ou `null` si un seul niveau employé n'a pas de tarif
       * renseigné. Jamais 0 pour « inconnu » — c'est la règle 2 de la
       * migration 0076, et elle vaut aussi côté serveur.
       */
      coutEstimeCents: number | null;
      /** Spec p. 21 : sur quelles données la réponse est fondée. */
      dateArreteDonnees: string;
      /** Ce que l'utilisateur doit savoir : repli, cache tiède, plafond proche. */
      avertissements: readonly string[];
    }
  | {
      ok: false;
      motif: MotifPanne | "droits_manquants";
      /** En français, destiné à l'écran. */
      message: string;
      /** Ce qui a été tenté avant d'abandonner. */
      tentatives: readonly TentativeModele[];
      coutEstimeCents: number | null;
      avertissements: readonly string[];
    };

// ------------------------------------------------------------------
// Petites lectures partagées
// ------------------------------------------------------------------

/**
 * Un entier de centimes, ou `null`.
 *
 * PAS DE `|| 0`. C'est la faute que ce dépôt a payée quatre fois ; ici
 * elle transformerait « je ne sais pas ce que coûte ce modèle » en
 * « il est gratuit », et le plafond de dépense ne se déclencherait
 * jamais.
 */
export function centimes(valeur: unknown): number | null {
  const n = nombreLisible(valeur);
  return n === null ? null : Math.trunc(n);
}

/**
 * Un nombre, ou `null` — SANS passer par les conversions muettes de
 * JavaScript.
 *
 * ══════════════════════════════════════════════════════════════════
 * `Number()` REND ZÉRO POUR QUATRE VALEURS QUI NE SONT PAS ZÉRO
 * ══════════════════════════════════════════════════════════════════
 *
 *   Number(null) === 0     Number("") === 0
 *   Number(false) === 0    Number([]) === 0
 *
 * C'est la même faute que `|| 0`, prise par l'autre bout : au lieu de
 * remplacer un zéro par un défaut, elle fabrique un zéro à partir d'un
 * vide. Les conséquences se lisent une par une dans ce dossier :
 *
 *   • un montant d'action à `""` deviendrait 0 €, et une action qui
 *     engage de l'argent SANS montant connu — que `ai_may_autoexecute`
 *     refuse d'auto-exécuter (0072) — passerait pour une action à zéro
 *     euro, que le plafond d'autopilote laisse partir ;
 *
 *   • une priorité absente deviendrait 0, et la décision tomberait au
 *     fond du brief au lieu de prendre le défaut de la colonne ;
 *
 *   • un coût estimé à `""` deviendrait « gratuit » dans le grand
 *     livre, et le plafond de dépense ne se déclencherait jamais.
 *
 * On n'accepte donc QUE ce qui est déjà un nombre, ou une chaîne non
 * vide qui en décrit un. PostgREST rend les `bigint` en texte : c'est
 * précisément pour ce cas que la chaîne est acceptée, et pour aucun
 * autre.
 */
export function nombreLisible(valeur: unknown): number | null {
  if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
  if (typeof valeur !== "string") return null;
  const propre = valeur.trim();
  if (propre.length === 0) return null;
  const n = Number(propre);
  return Number.isFinite(n) ? n : null;
}

/** Un entier positif, ou 0. Pour les compteurs de jetons, jamais pour l'argent. */
export function compteur(valeur: unknown): number {
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

// ==================================================================
// LES JETONS D'UN APPEL QUI A ÉCHOUÉ
// ==================================================================

/** Ce qu'un appel a consommé. Trois compteurs, jamais négatifs. */
export type UsageAppel = {
  jetonsEntree: number;
  jetonsSortie: number;
  appelsOutils: number;
};

/**
 * UN ÉCHEC QUI SAIT CE QU'IL A COÛTÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE « || 0 » PRIS PAR L'AUTRE BOUT
 * ══════════════════════════════════════════════════════════════════
 *
 * La branche d'erreur du runner inscrivait l'échec au grand livre avec
 * zéro jeton. Or la plupart des exceptions qui l'atteignent viennent
 * d'exécutions ENTIÈREMENT PAYÉES : « le modèle n'a rendu aucune sortie
 * structurée » est levé APRÈS un run complet, à deux lignes des vrais
 * compteurs ; l'abandon après trois reprises d'approbation vient après
 * quatre runs ; un `MaxTurnsExceededError` après huit tours.
 *
 * Un zéro fabriqué là où le chiffre est connu et non nul est exactement
 * ce que `nombreLisible` existe pour éradiquer — ici pris à l'envers.
 * Et la conséquence n'est pas cosmétique : `ai_cost_budget_remaining`
 * somme `ai_usage_events`, donc un modèle qui échoue systématiquement
 * son schéma brûlerait du budget indéfiniment sans qu'aucun plafond ne
 * bouge, puisque chaque échec s'inscrirait à zéro.
 *
 * ─── POURQUOI UNE CLASSE ET PAS UN CHAMP SUR L'ERREUR ───
 *
 * Parce que `classerPanne` lit `name`, `status` et `cause` pour ranger
 * la panne : envelopper une erreur du SDK dans celle-ci lui ferait
 * perdre son diagnostic. Elle ne sert donc QU'À NOS PROPRES échecs, et
 * `usageDeLErreur` sait lire l'autre cas — le `state.usage` que les
 * erreurs du SDK portent — sans qu'on ait à les toucher.
 */
export class EchecAvecUsage extends Error {
  readonly usage: UsageAppel;

  constructor(message: string, usage: Partial<UsageAppel>, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EchecAvecUsage";
    this.usage = {
      jetonsEntree: compteur(usage.jetonsEntree),
      jetonsSortie: compteur(usage.jetonsSortie),
      appelsOutils: compteur(usage.appelsOutils),
    };
  }
}

/**
 * L'erreur d'origine, quand elle a été enveloppée pour porter ses jetons.
 *
 * `classerPanne` lit `name`, `status` et `code` : une erreur du SDK
 * enveloppée telle quelle serait rangée en « other » alors qu'elle
 * disait « rate limit ». L'enveloppe garde donc la cause, et tout ce qui
 * DIAGNOSTIQUE commence par la retirer. Tout ce qui COMPTE, à l'inverse,
 * lit l'enveloppe.
 */
export function causeProfonde(erreur: unknown): unknown {
  return erreur instanceof EchecAvecUsage && erreur.cause !== undefined ? erreur.cause : erreur;
}

/**
 * Les jetons qu'une exception a déjà coûtés, ou `null` si personne ne
 * les connaît.
 *
 * `null` et non un triplet de zéros : « on ne sait pas » et « ça n'a
 * rien coûté » ne se rangent pas de la même façon au grand livre. Le
 * second est un fait, le premier un aveu.
 *
 * Deux sources, dans cet ordre : notre propre `EchecAvecUsage`, puis le
 * `state.usage` que `AgentsError` du SDK porte quand l'échec survient
 * après au moins un tour. La lecture du second est délibérément
 * structurelle et non typée : elle ne dépend d'aucun import du SDK,
 * donc ce fichier reste éprouvable sans lui.
 */
export function usageDeLErreur(erreur: unknown): UsageAppel | null {
  if (erreur instanceof EchecAvecUsage) return erreur.usage;

  if (typeof erreur !== "object" || erreur === null) return null;
  const etat = (erreur as { state?: unknown }).state;
  if (typeof etat !== "object" || etat === null) return null;

  let usage: unknown;
  try {
    // `usage` est un accesseur sur `RunState` ; un état à moitié
    // reconstruit peut lever, et une exception ici transformerait un
    // échec journalisable en échec non journalisé.
    usage = (etat as { usage?: unknown }).usage;
  } catch {
    return null;
  }
  if (typeof usage !== "object" || usage === null) return null;

  const entree = (usage as { inputTokens?: unknown }).inputTokens;
  const sortie = (usage as { outputTokens?: unknown }).outputTokens;
  if (!Number.isFinite(Number(entree)) && !Number.isFinite(Number(sortie))) return null;

  return {
    jetonsEntree: compteur(entree),
    jetonsSortie: compteur(sortie),
    appelsOutils: 0,
  };
}

export function estConfiance(valeur: unknown): valeur is Confiance {
  return typeof valeur === "string" && (CONFIANCES as readonly string[]).includes(valeur);
}

/** Le doute descend, il ne monte pas — même règle que `readConfidence`. */
export function lireConfiance(valeur: unknown): Confiance {
  return estConfiance(valeur) ? valeur : "insufficient_data";
}

export type { CleAgentModele, NiveauModele, NiveauRisque, Permission };
