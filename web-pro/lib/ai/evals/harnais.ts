import { register } from "node:module";
import type { ModelProvider } from "@openai/agents";
import { AIModelRouter } from "../model/router.ts";
import { NIVEAUX_MODELE } from "../model/types.ts";
import { AgentContextBuilder, type PortLectureSource } from "../runtime/context.ts";
import {
  AICostControlService,
  BUDGET_SANS_LIMITE,
  type BudgetIA,
  type GrilleTarifaire,
  type PortCout,
  type Tarif,
} from "../runtime/cost.ts";
import { JournalUsage, type EvenementUsage } from "../runtime/usage.ts";
import { OasisAgentRunner, type PortRoutage } from "../runtime/run.ts";
import {
  OasisActionEngine,
  type EntreeCatalogue,
  type PortActionEngine,
  type PortServicesMetier,
} from "../runtime/actionEngine.ts";
import { AGENTS_PREMIERE_ITERATION } from "../runtime/definitions.ts";
import type { ReglageAgent } from "../runtime/autonomy.ts";
import type { IdentiteAppel, NiveauModele, Permission } from "../runtime/types.ts";
import { FournisseurObserve, ModeleSimule, fournisseurDe, type Scripts } from "./modeleSimule.ts";

/**
 * §11V — LE DÉCOR DES ÉVALUATIONS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI EST VRAI ICI, ET CE QUI NE L'EST PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * VRAI, et c'est le sujet : le routeur (`AIModelRouter`, sa
 * configuration réelle, ses seuils réels), le registre d'outils, le
 * constructeur de contexte, l'orchestrateur, le moteur d'actions, le
 * journal d'usage, le runtime des agents, et l'Agents SDK lui-même —
 * vrai `Agent`, vrai `Runner`, vraie boucle d'interruption, vraie
 * relecture Zod.
 *
 * FAUX, et il le faut : la BASE (les fixtures passent par le port de
 * lecture) et, en mode simulé, le MODÈLE. Rien d'autre.
 *
 * Le point qui fait la valeur du mode réel : les fixtures étant
 * injectées par le port de lecture, un vrai modèle voit EXACTEMENT le
 * devis sous-tarifé qu'on a écrit. Son jugement est donc comparable
 * d'un passage à l'autre et d'un modèle à l'autre — c'est le
 * « MODEL BENCHMARK » de la page 25, obtenu sans base de test.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LE DÉCOR OBSERVE, ET POURQUOI CHAQUE OBSERVATION EXISTE
 * ══════════════════════════════════════════════════════════════════
 *
 *   `demandesModele`   — l'identifiant réellement demandé (MODEL ROUTER).
 *   `lectures`         — chaque appel de fonction SQL avec ses
 *                        arguments : c'est là que se lit l'injection de
 *                        l'organisation (SECURITY).
 *   `evenements`       — le grand livre (COST). Un appel qui n'y figure
 *                        pas est un défaut, pas une approximation.
 *   `actionsEcrites` / `approbations` — ce que le moteur enregistre
 *                        (APPROVAL).
 *   `executionsMetier` — LES ÉCRITURES RÉELLES. Ce tableau doit rester
 *                        VIDE dans tous les cas d'évaluation : c'est le
 *                        critère ACTION de la page 32, et il se mesure
 *                        par une absence.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN `register()` EN TÊTE DE FICHIER
 * ══════════════════════════════════════════════════════════════════
 *
 * `agents.ts` importe `@/lib/ai/proposals`, un alias de `tsconfig` que
 * Node ne connaît pas. Le crochet de résolution vit déjà dans
 * `runtime/_test/alias.mjs` ; on le réemploie plutôt que d'en écrire un
 * second. L'import d'`agents.ts` est donc DYNAMIQUE : un import
 * statique serait hissé avant l'exécution du `register()`.
 */

register("../runtime/_test/alias.mjs", import.meta.url);

const { OasisAgentsRuntime } = await import("../runtime/agents.ts");
type RuntimeAgents = InstanceType<typeof OasisAgentsRuntime>;

// ==================================================================
// 1. Le décor fixe
// ==================================================================

/**
 * Les entrées d'`ai_action_catalog` (0072) dont les cas ont besoin.
 *
 * Recopiées et non inventées : `agent`, `permissionRequise` et
 * `engageDeLArgent` gouvernent le risque et l'autopilote, et un
 * catalogue de complaisance ferait passer des contrôles que la vraie
 * base refuserait.
 */
export const CATALOGUE_EVAL: Readonly<Record<string, EntreeCatalogue>> = Object.freeze({
  createInvoiceDraft: {
    actionType: "createInvoiceDraft",
    agent: "billing",
    label: "Créer des brouillons de facture",
    risqueParDefaut: "medium",
    permissionRequise: "invoice.create",
    ecrit: true,
    engageDeLArgent: true,
  },
  sendInvoice: {
    actionType: "sendInvoice",
    agent: "billing",
    label: "Envoyer une facture au client",
    // Page 15 : « envoyer facture » est un risque ÉLEVÉ. Cette entrée
    // sert au contrôle APPROVAL, qui doit PROUVER le blocage.
    risqueParDefaut: "high",
    permissionRequise: "invoice.create",
    ecrit: true,
    engageDeLArgent: true,
  },
});

/** Tous les droits dont les quatre agents construits ont besoin. */
export const DROITS_COMPLETS: readonly Permission[] = Object.freeze([
  "projects.read",
  "quotes.read",
  "quotes.create",
  "quotes.edit",
  "invoice.create",
  "clients.read",
]);

export const ORGANISATION_A = "org-A-evaluation";
export const ORGANISATION_B = "org-B-evaluation";

/**
 * La grille tarifaire de convention.
 *
 * Les tarifs réels ne sont pas connus — aucune variable
 * `OASIS_AI_TARIF_…` n'est renseignée à ce jour — et ce n'est pas ce
 * qu'on mesure. Ce qu'on mesure est que la CHAÎNE du coût fonctionne :
 * estimation par niveau, somme sur les tentatives, écriture au grand
 * livre avec la provenance du tarif.
 *
 * `base` porte donc un nom qui ne peut pas être confondu avec une
 * grille de production : un montant d'évaluation qui remonterait par
 * erreur dans un tableau de bord se dénoncerait lui-même.
 */
export const BASE_TARIF_EVALUATION = "grille-evaluation";

const TARIF_PAR_NIVEAU: Readonly<Record<NiveauModele, Tarif>> = Object.freeze({
  economy: { entreeCentsParMillion: 5_000, sortieCentsParMillion: 20_000 },
  standard: { entreeCentsParMillion: 25_000, sortieCentsParMillion: 100_000 },
  advanced: { entreeCentsParMillion: 125_000, sortieCentsParMillion: 500_000 },
});

export const GRILLE_EVALUATION: GrilleTarifaire = Object.freeze({
  tarifs: TARIF_PAR_NIVEAU,
  base: BASE_TARIF_EVALUATION,
  anomalies: [],
});

/** Une grille où AUCUN niveau n'est tarifé — pour éprouver le coût inconnu. */
export const GRILLE_SANS_TARIF: GrilleTarifaire = Object.freeze({
  tarifs: Object.freeze(
    Object.fromEntries(NIVEAUX_MODELE.map((n) => [n, null])) as Record<NiveauModele, Tarif | null>,
  ),
  base: null,
  anomalies: [],
});

// ==================================================================
// 2. Ce que le décor observe
// ==================================================================

export type Observations = {
  /** Les identifiants de modèle demandés au fournisseur, dans l'ordre. */
  readonly demandesModele: readonly string[];
  readonly lectures: readonly { rpc: string; arguments: Record<string, unknown> }[];
  readonly evenements: readonly EvenementUsage[];
  readonly actionsEcrites: readonly Parameters<PortActionEngine["enregistrer"]>[0][];
  readonly approbations: readonly Parameters<PortActionEngine["demanderApprobation"]>[0][];
  readonly autopilotesInterroges: readonly Parameters<
    PortActionEngine["autoriseAutopilote"]
  >[0][];
  /** LES ÉCRITURES MÉTIER. Doit rester vide. */
  readonly executionsMetier: readonly Parameters<PortServicesMetier["executer"]>[0][];
  readonly cacheLu: readonly { cle: string; modele: string; empreinte: string }[];
  readonly cacheEcrit: readonly { cle: string; modele: string }[];
};

export type OptionsHarnais = {
  /** Les données que chaque fonction SQL rend, indexées par son nom. */
  donnees?: Record<string, unknown>;
  /** Les fonctions dont la lecture échoue. */
  lecturesEnEchec?: readonly string[];
  /** Le script du modèle simulé. Ignoré quand `fournisseur` est fourni. */
  scripts?: Scripts;
  /** Un fournisseur réel, pour le mode hors intégration continue. */
  fournisseur?: ModelProvider;
  organizationId?: string;
  permissions?: readonly Permission[];
  /** Le niveau d'autonomie des quatre agents. 2 = prépare, sans agir. */
  niveauAutonomie?: 0 | 1 | 2 | 3 | 4;
  /** Les types d'action que le produit sait exécuter. Vide par défaut. */
  executeurs?: readonly string[];
  /** Ce que rend `ai_may_autoexecute`. Faux par défaut. */
  autopiloteRend?: boolean;
  /** Le routeur. Par défaut le vrai, avec sa configuration réelle. */
  routeur?: AIModelRouter;
  /** Le budget rendu par `ai_cost_budget_remaining`. Sans limite par défaut. */
  budget?: BudgetIA;
  /** La grille tarifaire. Celle d'évaluation par défaut. */
  grille?: GrilleTarifaire;
  /** Des entrées de cache déjà présentes, indexées par clé. */
  cachePrerempli?: Record<string, unknown>;
  /** Le catalogue d'actions. Celui d'évaluation par défaut. */
  catalogue?: Readonly<Record<string, EntreeCatalogue>>;
};

export type Harnais = {
  runtime: RuntimeAgents;
  /** `null` en mode réel : il n'y a alors aucun script à interroger. */
  modele: ModeleSimule | null;
  routeur: AIModelRouter;
  identite: IdentiteAppel;
  observations: Observations;
};

// ==================================================================
// 3. Le montage
// ==================================================================

/**
 * Monte un runtime complet autour d'un scénario.
 *
 * Tout ce qui touche le monde extérieur est un port, et chaque port
 * note ce qu'on lui demande. C'est ce qui permet d'affirmer « aucune
 * donnée métier n'a bougé » comme un FAIT MESURÉ, et non comme une
 * conclusion tirée d'une relecture de code.
 */
export function monterHarnais(options: OptionsHarnais = {}): Harnais {
  const lectures: { rpc: string; arguments: Record<string, unknown> }[] = [];
  const evenements: EvenementUsage[] = [];
  const actionsEcrites: Parameters<PortActionEngine["enregistrer"]>[0][] = [];
  const approbations: Parameters<PortActionEngine["demanderApprobation"]>[0][] = [];
  const autopilotesInterroges: Parameters<PortActionEngine["autoriseAutopilote"]>[0][] = [];
  const executionsMetier: Parameters<PortServicesMetier["executer"]>[0][] = [];
  const cacheLu: { cle: string; modele: string; empreinte: string }[] = [];
  const cacheEcrit: { cle: string; modele: string }[] = [];

  const enEchec = new Set(options.lecturesEnEchec ?? []);
  const donnees = options.donnees ?? {};
  const catalogue = options.catalogue ?? CATALOGUE_EVAL;

  const modele = options.fournisseur === undefined ? new ModeleSimule(options.scripts ?? {}) : null;
  const fournisseur = new FournisseurObserve(
    options.fournisseur ?? fournisseurDe(modele as ModeleSimule),
  );

  const routeur = options.routeur ?? new AIModelRouter();
  const identite: IdentiteAppel = {
    organizationId: options.organizationId ?? ORGANISATION_A,
    workspaceId: "ws-evaluation",
    userId: "user-evaluation",
    permissions: options.permissions ?? DROITS_COMPLETS,
  };

  /**
   * Le port de lecture : les fixtures, et rien d'autre.
   *
   * UNE FONCTION NON PRÉVUE PAR LE CAS N'EST PAS UNE FONCTION VIDE.
   * Rendre `null` en silence laisserait passer un agent qui lit une
   * source dont personne n'a écrit la fixture, et l'évaluation noterait
   * son interprétation d'une absence qu'on aurait fabriquée sans le
   * savoir. On rend donc un ÉCHEC NOMMÉ : la source apparaît comme non
   * lue dans le contexte, l'agent doit le dire, et le rapport le voit.
   */
  const lire: PortLectureSource = async ({ rpc, arguments: args }) => {
    lectures.push({ rpc, arguments: args });
    if (enEchec.has(rpc)) {
      return { ok: false, message: `Évaluation : la source « ${rpc} » est déclarée muette.` };
    }
    if (!(rpc in donnees)) {
      return {
        ok: false,
        message: `Évaluation : aucune donnée n'est prévue pour « ${rpc} » dans ce cas.`,
      };
    }
    return { ok: true, donnees: donnees[rpc] };
  };

  const routage: PortRoutage = {
    resolve: (contexte) => routeur.resolve(contexte),
    modelePourNiveau: (niveau) => routeur.modelePourNiveau(niveau),
  };

  const portCout: PortCout = {
    budget: async () => options.budget ?? BUDGET_SANS_LIMITE,
    lireCache: async (appel) => {
      cacheLu.push({ cle: appel.cle, modele: appel.modele, empreinte: appel.empreinte });
      return options.cachePrerempli?.[appel.cle] ?? null;
    },
    ecrireCache: async (appel) => {
      cacheEcrit.push({ cle: appel.cle, modele: appel.modele });
    },
    repartition: async () => ({ lignes: [], complet: true }),
  };

  const portActions: PortActionEngine = {
    async catalogue(actionType) {
      return catalogue[actionType] ?? null;
    },
    async enregistrer(appel) {
      actionsEcrites.push(appel);
      return `action-eval-${actionsEcrites.length}`;
    },
    async demanderApprobation(appel) {
      approbations.push(appel);
      return `approval-eval-${approbations.length}`;
    },
    async autoriseAutopilote(appel) {
      autopilotesInterroges.push(appel);
      return options.autopiloteRend === true;
    },
    async cloturer() {},
    async journaliser() {},
  };

  const services: PortServicesMetier = {
    executeurs: options.executeurs ?? [],
    async executer(appel) {
      // SI CETTE FERMETURE S'EXÉCUTE PENDANT UNE ÉVALUATION, C'EST LE
      // DÉFAUT QUE LA PAGE 32 APPELLE « ACTION ». On le NOTE plutôt que
      // de lever : le constat doit pouvoir dire QUELLE écriture est
      // partie, pas seulement qu'une exception s'est produite quelque
      // part.
      executionsMetier.push(appel);
      return { ok: true, message: "écriture d'évaluation", resultat: {} };
    },
  };

  const reglages: Record<string, ReglageAgent> = {};
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    reglages[agent] = {
      agent,
      actif: true,
      niveau: options.niveauAutonomie ?? 2,
      parDefaut: false,
    };
  }

  const runtime = new OasisAgentsRuntime({
    identite,
    constructeur: new AgentContextBuilder(lire),
    runner: new OasisAgentRunner({
      routeur: routage,
      cout: new AICostControlService(portCout, { grille: options.grille ?? GRILLE_EVALUATION }),
      journal: new JournalUsage(async (evenement) => {
        evenements.push(evenement);
      }),
    }),
    moteurActions: new OasisActionEngine(portActions, services),
    reglages,
    fournisseur,
    lire: async ({ rpc, arguments: args }) => {
      lectures.push({ rpc, arguments: args });
      if (enEchec.has(rpc)) {
        throw new Error(`Évaluation : la source « ${rpc} » est déclarée muette.`);
      }
      return rpc in donnees ? donnees[rpc] : null;
    },
    // L'ENVIRONNEMENT EST VIDE, délibérément : aucune évaluation ne doit
    // dépendre d'une variable posée sur la machine qui la lance. Le
    // tracing reste donc éteint et le routage n'a aucune surcharge —
    // deux passages sur deux postes différents sont comparables.
    env: {},
  });

  return {
    runtime,
    modele,
    routeur,
    identite,
    observations: {
      // Un accesseur, et non une copie : le fournisseur note au fil de
      // l'eau et c'est sa liste qui fait foi. Une copie prise au
      // montage serait vide pour toujours.
      get demandesModele() {
        return fournisseur.demandes;
      },
      lectures,
      evenements,
      actionsEcrites,
      approbations,
      autopilotesInterroges,
      executionsMetier,
      cacheLu,
      cacheEcrit,
    },
  };
}
