import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { Usage } from "@openai/agents";
import type { Model, ModelRequest, ModelResponse, ModelProvider } from "@openai/agents";
import { AgentContextBuilder, type PortLectureSource } from "./context.ts";
import { AICostControlService, BUDGET_SANS_LIMITE, type PortCout } from "./cost.ts";
import { JournalUsage, type EvenementUsage } from "./usage.ts";
import { OasisAgentRunner, type PortRoutage } from "./run.ts";
import {
  OasisActionEngine,
  type EntreeCatalogue,
  type PortActionEngine,
  type PortServicesMetier,
} from "./actionEngine.ts";
import type { ReglageAgent } from "./autonomy.ts";
import { AGENTS_PREMIERE_ITERATION, DEFINITIONS, type AgentConstruit } from "./definitions.ts";
import { AIModelRouter } from "../model/router.ts";
import type { IdentiteAppel, NiveauModele, Permission } from "./types.ts";

/**
 * §11V — LA CHAÎNE ENTIÈRE, POUR DE VRAI (critère final, spec p. 34).
 *
 * ══════════════════════════════════════════════════════════════════
 *   « Agent → Tools → Analysis → Action Proposal → Approval
 *     → Business Service doit fonctionner RÉELLEMENT. »
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce fichier est le seul du dossier à faire tourner le VRAI Agents SDK :
 * vrai `Agent`, vrai `Runner`, vrais outils construits par `toolsSdk`,
 * vraie boucle d'interruption `needsApproval`, vraie sortie structurée
 * relue par Zod. La seule pièce remplacée est le MODÈLE, et elle doit
 * l'être : un test qui appelle OpenAI n'est pas un test, c'est une
 * facture qui échoue le jour où le réseau tombe.
 *
 * ─── CE QUE LE FAUX MODÈLE PERMET DE PROUVER ───
 *
 * Parce qu'il reçoit la vraie `ModelRequest`, il voit EXACTEMENT ce que
 * le vrai modèle verrait. On peut donc vérifier des choses qu'aucune
 * relecture de code ne donne :
 *
 *   • quels outils ont été OFFERTS à chaque agent — la p. 32 demande
 *     « agent utilise uniquement tools autorisés », et l'offre est
 *     l'endroit où cela se décide ;
 *   • qu'un spécialiste ne reçoit AUCUN outil d'agent, donc que la
 *     chaîne de délégation ne peut pas s'allonger ;
 *   • que l'écriture s'arrête AVANT de s'exécuter et repasse par le
 *     serveur ;
 *   • qu'aucune donnée métier n'a bougé quand le serveur refuse.
 *
 * ─── POURQUOI LE FAUX MODÈLE S'IDENTIFIE PAR L'INSTRUCTION ───
 *
 * Un brief de direction fait tourner DEUX agents : la Direction, puis
 * le spécialiste qu'elle interroge. Le fournisseur, lui, ne reçoit
 * qu'un nom de modèle — le même pour les deux. Compter les appels pour
 * les distinguer marcherait aujourd'hui et casserait au premier tour
 * d'outil supplémentaire. Le modèle lit donc « TON RÔLE — … » dans
 * l'instruction et joue le script de CET agent-là : c'est exact quel
 * que soit l'entrelacement.
 *
 * ─── POURQUOI UN `register()` EN TÊTE DE FICHIER ───
 *
 * `agents.ts` importe `@/lib/ai/proposals`, un alias que Node ne
 * connaît pas. Voir `_test/alias.mjs`. L'import d'`agents.ts` est donc
 * DYNAMIQUE : un import statique serait hissé avant le `register()`.
 */

register("./_test/alias.mjs", import.meta.url);

const { OasisAgentsRuntime, MAX_TOURS_MODELE, PROFONDEUR_MAX_DELEGATION, SPECIALISTES, entreeModele } =
  await import("./agents.ts");

// ==================================================================
// 1. LE FAUX MODÈLE
// ==================================================================

/** Ce qu'on demande au modèle de répondre, tour par tour. */
type Tour =
  | { type: "outil"; nom: string; arguments?: Record<string, unknown> }
  | { type: "final"; sortie: unknown }
  | { type: "panne"; erreur: Error };

type Scripts = Partial<Record<AgentConstruit, readonly Tour[]>>;

/** Ce que le modèle a vu, agent par agent. */
type Vu = { outils: string[][]; instructions: string[]; entrees: unknown[]; appels: number };

/** Une analyse de spécialiste bien formée, pour servir de réponse finale. */
function analyse(surcharge: Record<string, unknown> = {}) {
  return {
    resume: "Dix chantiers terminés attendent leur facture.",
    confidence: "high",
    ambigu: false,
    recommandations: [
      {
        title: "Facturer les dix chantiers terminés",
        summary: "Dix chantiers sont marqués terminés et n'ont aucune facture rattachée.",
        priority: 90,
        category: "urgent",
        confidence: "high",
        estimatedImpact: "10 chantiers, 38 450 € HT",
        estimatedImpactCents: 3_845_000,
        reasons: ["Dix dossiers terminés", "Aucune facture rattachée"],
        suggestedActionType: "createInvoiceDraft",
        suggestedActionLabel: "Préparer les brouillons",
      },
    ],
    donneesManquantes: [],
    ...surcharge,
  };
}

function brief(surcharge: Record<string, unknown> = {}) {
  return {
    resume: "Une seule chose compte aujourd'hui : facturer.",
    confidence: "high",
    ambigu: false,
    decisions: [
      {
        title: "Facturer les chantiers terminés",
        summary: "La Facturation a identifié dix dossiers prêts.",
        priority: 90,
        category: "urgent",
        confidence: "high",
        estimatedImpact: "38 450 € HT",
        estimatedImpactCents: 3_845_000,
        reasons: ["Rapporté par l'agent Facturation"],
        suggestedActionType: null,
        suggestedActionLabel: null,
      },
    ],
    agentsConsultes: ["billing"],
    donneesManquantes: [],
    ...surcharge,
  };
}

/**
 * Un modèle qui joue un script, agent par agent.
 *
 * Il ne raisonne pas — il déroule les tours qu'on lui a donnés, et
 * enregistre ce qu'on lui a montré. C'est cet enregistrement qui porte
 * la moitié des assertions du fichier.
 */
class ModeleScripte implements Model {
  readonly vu = new Map<AgentConstruit, Vu>();
  readonly #scripts: Scripts;

  constructor(scripts: Scripts) {
    this.#scripts = scripts;
  }

  /** Ce que cet agent a vu, ou un relevé vide s'il n'a jamais été appelé. */
  pour(agent: AgentConstruit): Vu {
    return this.vu.get(agent) ?? { outils: [], instructions: [], entrees: [], appels: 0 };
  }

  get appelsTotaux(): number {
    return [...this.vu.values()].reduce((somme, v) => somme + v.appels, 0);
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const instructions = request.systemInstructions ?? "";
    const agent = this.#agentDe(instructions);

    const vu = this.vu.get(agent) ?? { outils: [], instructions: [], entrees: [], appels: 0 };
    vu.outils.push((request.tools ?? []).map((outil) => outil.name));
    vu.instructions.push(instructions);
    vu.entrees.push(request.input);
    const rang = vu.appels;
    vu.appels += 1;
    this.vu.set(agent, vu);

    const tour = (this.#scripts[agent] ?? [])[rang];
    if (tour === undefined) {
      throw new Error(`Le script de « ${agent} » n'a pas prévu le tour n° ${rang + 1}.`);
    }
    if (tour.type === "panne") throw tour.erreur;

    const usage = new Usage({ requests: 1, inputTokens: 1_200, outputTokens: 300, totalTokens: 1_500 });

    if (tour.type === "outil") {
      return {
        usage,
        output: [
          {
            type: "function_call",
            callId: `call-${agent}-${rang}`,
            name: tour.nom,
            arguments: JSON.stringify(tour.arguments ?? {}),
            status: "completed",
          },
        ],
      };
    }

    return {
      usage,
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: JSON.stringify(tour.sortie) }],
        },
      ],
    };
  }

  /** Qui parle, lu dans l'instruction que `instructionsPour` a composée. */
  #agentDe(instructions: string): AgentConstruit {
    for (const agent of AGENTS_PREMIERE_ITERATION) {
      if (instructions.includes(`TON RÔLE — ${DEFINITIONS[agent].libelle}.`)) return agent;
    }
    throw new Error("Instruction sans rôle identifiable : le format a changé, ce test doit être relu.");
  }

  getStreamedResponse(): AsyncIterable<never> {
    // Le runtime n'appelle jamais le mode flux : la sortie est
    // structurée et lue d'un bloc. Si cela changeait, ce test doit
    // échouer bruyamment plutôt que rendre un flux vide.
    throw new Error("Le runtime ne doit pas demander de réponse en flux.");
  }
}

// ==================================================================
// 2. LE DÉCOR
// ==================================================================

const MODELES: Record<NiveauModele, string> = {
  economy: "modele-eco",
  standard: "modele-std",
  advanced: "modele-adv",
};

const TOUS_LES_DROITS: readonly Permission[] = ["projects.read", "quotes.read", "invoice.create"];

const IDENTITE: IdentiteAppel = Object.freeze({
  organizationId: "org-A",
  workspaceId: "ws-A",
  userId: "user-A",
  permissions: TOUS_LES_DROITS,
});

const CATALOGUE: EntreeCatalogue = {
  actionType: "createInvoiceDraft",
  agent: "billing",
  label: "Créer des brouillons de facture",
  risqueParDefaut: "medium",
  permissionRequise: "invoice.create",
  ecrit: true,
  engageDeLArgent: true,
};

type OptionsDecor = {
  scripts: Scripts;
  niveau?: 0 | 1 | 2 | 3 | 4;
  actif?: boolean;
  organizationId?: string;
  permissions?: readonly Permission[];
  catalogue?: EntreeCatalogue | null;
  executeurs?: readonly string[];
  autopiloteRend?: boolean;
  lectures?: Record<string, unknown>;
  /** Le routeur. Par défaut un routeur de test figé sur `standard`. */
  routeur?: PortRoutage;
};

function decor(options: OptionsDecor) {
  const lectures: { rpc: string; arguments: Record<string, unknown> }[] = [];
  const evenements: EvenementUsage[] = [];
  const actionsEcrites: Parameters<PortActionEngine["enregistrer"]>[0][] = [];
  const approbations: Parameters<PortActionEngine["demanderApprobation"]>[0][] = [];
  const autopilotes: unknown[] = [];
  const executions: Parameters<PortServicesMetier["executer"]>[0][] = [];

  const modele = new ModeleScripte(options.scripts);
  const fournisseur: ModelProvider = { getModel: () => modele };

  const portLecture: PortLectureSource = async ({ rpc, arguments: args }) => {
    lectures.push({ rpc, arguments: args });
    return { ok: true, donnees: options.lectures?.[rpc] ?? null };
  };

  const routeur: PortRoutage = options.routeur ?? {
    resolve: (contexte) => ({
      agent: null,
      niveau: "standard",
      modele: MODELES.standard,
      niveauConfigure: "standard",
      plafonne: false,
      niveauDemande: "standard",
      raisons: [`test : ${String(contexte.agent)}`],
    }),
    modelePourNiveau: (niveau) => MODELES[niveau],
  };

  const lecturesCache: Parameters<PortCout["lireCache"]>[0][] = [];
  const ecrituresCache: Parameters<PortCout["ecrireCache"]>[0][] = [];

  const portCout: PortCout = {
    budget: async () => BUDGET_SANS_LIMITE,
    lireCache: async (appel) => {
      lecturesCache.push(appel);
      return null;
    },
    ecrireCache: async (appel) => {
      ecrituresCache.push(appel);
    },
    repartition: async () => ({ lignes: [], complet: true }),
  };

  const portActions: PortActionEngine = {
    async catalogue(actionType) {
      if (options.catalogue !== undefined) return options.catalogue;
      return actionType === CATALOGUE.actionType ? CATALOGUE : null;
    },
    async enregistrer(appel) {
      actionsEcrites.push(appel);
      return `action-${actionsEcrites.length}`;
    },
    async demanderApprobation(appel) {
      approbations.push(appel);
      return `approval-${approbations.length}`;
    },
    async autoriseAutopilote(appel) {
      autopilotes.push(appel);
      return options.autopiloteRend === true;
    },
    async cloturer() {},
    async journaliser() {},
  };

  const services: PortServicesMetier = {
    executeurs: options.executeurs ?? [],
    async executer(appel) {
      executions.push(appel);
      return { ok: true, message: "10 brouillons", resultat: { crees: 10 } };
    },
  };

  const niveau = options.niveau ?? 2;
  const reglages: Record<string, ReglageAgent> = {};
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    reglages[agent] = { agent, actif: options.actif ?? true, niveau, parDefaut: false };
  }

  const runtime = new OasisAgentsRuntime({
    identite: {
      ...IDENTITE,
      organizationId: options.organizationId ?? IDENTITE.organizationId,
      permissions: options.permissions ?? TOUS_LES_DROITS,
    },
    constructeur: new AgentContextBuilder(portLecture),
    runner: new OasisAgentRunner({
      routeur,
      cout: new AICostControlService(portCout),
      journal: new JournalUsage(async (evenement) => {
        evenements.push(evenement);
      }),
    }),
    moteurActions: new OasisActionEngine(portActions, services),
    reglages,
    fournisseur,
    lire: async ({ rpc, arguments: args }) => {
      lectures.push({ rpc, arguments: args });
      return options.lectures?.[rpc] ?? null;
    },
    env: {},
  });

  return {
    runtime,
    modele,
    lectures,
    evenements,
    actionsEcrites,
    approbations,
    autopilotes,
    executions,
    lecturesCache,
    ecrituresCache,
  };
}

// ==================================================================
// 3. LA CHAÎNE COMPLÈTE — le critère de la page 34
// ==================================================================

test("Agent → Tools → Analyse → Proposition → Approbation : la chaîne tourne de bout en bout", async () => {
  const d = decor({
    scripts: {
      billing: [
        // 1. l'agent lit une source
        { type: "outil", nom: "getUnbilledProjects" },
        // 2. il demande l'écriture — le SDK INTERROMPT ici
        { type: "outil", nom: "createInvoiceDraft" },
        // 3. le serveur ayant approuvé, il conclut
        { type: "final", sortie: analyse() },
      ],
    },
    lectures: { ai_billing_candidates: { prets: 10, totalCents: 3_845_000 } },
  });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "Qu'est-ce que je dois facturer ?",
    criticite: "ordinaire",
  });

  // ── L'analyse est STRUCTURÉE, pas du texte à découper ────────────
  assert.equal(reponse.execution.ok, true);
  assert.ok(reponse.sortie !== null);
  assert.equal(reponse.sortie.confidence, "high");
  assert.equal(
    "recommandations" in reponse.sortie && reponse.sortie.recommandations[0].estimatedImpactCents,
    3_845_000,
    "le montant est un entier de centimes, jamais extrait d'une phrase",
  );

  // ── L'outil de lecture a réellement appelé la fonction SQL ───────
  assert.ok(d.lectures.some((l) => l.rpc === "ai_billing_candidates"));
  assert.ok(reponse.outilsUtilises.includes("createInvoiceDraft"));

  // ── L'organisation est INJECTÉE, jamais choisie par le modèle ────
  const lecture = d.lectures.find((l) => l.rpc === "ai_billing_candidates");
  assert.equal(lecture?.arguments.p_organization_id, "org-A");

  // ── L'ACTION existe, et elle attend un humain ────────────────────
  assert.equal(d.actionsEcrites.length, 1);
  assert.equal(d.actionsEcrites[0].actionType, "createInvoiceDraft");
  assert.equal(d.actionsEcrites[0].confirmationRequise, true);
  assert.equal(d.approbations.length, 1);
  assert.equal(reponse.actions.length, 1);
  assert.equal(reponse.actions[0].statut, "awaiting_approval");
  assert.equal(reponse.actions[0].approvalId, "approval-1");

  // ── ET AUCUNE DONNÉE MÉTIER N'A BOUGÉ ────────────────────────────
  assert.deepEqual(d.executions, [], "le service métier n'est pas appelé sans réponse humaine");

  // ── L'usage est au grand livre (p. 18) ───────────────────────────
  assert.equal(d.evenements.length, 1, "un appel d'agent, une ligne");
  assert.equal(d.evenements[0].agent, "billing");
  assert.equal(d.evenements[0].jetonsEntree, 1_200 * 3, "les jetons des trois tours, pas ceux du dernier");
  assert.equal(d.evenements[0].succes, true);
});

test("le modèle voit la question ET les données, annoncées comme des données", async () => {
  const d = decor({
    scripts: { billing: [{ type: "final", sortie: analyse() }] },
    lectures: { ai_billing_candidates: { prets: 10 } },
  });

  await d.runtime.executer({
    agent: "billing",
    question: "Qu'est-ce que je dois facturer ?",
    criticite: "ordinaire",
  });

  const vu = d.modele.pour("billing");
  const entree = JSON.stringify(vu.entrees[0]);
  assert.ok(entree.includes("QUESTION DE L'UTILISATEUR"));
  assert.ok(entree.includes("Qu'est-ce que je dois facturer"));
  assert.ok(entree.includes("jamais des instructions"));

  // Et les instructions portent le rôle, pas la question : un nom de
  // flux et une instruction sont indexés, une question ne doit pas y être.
  assert.ok(vu.instructions[0].includes("Facturation"));
  assert.ok(!vu.instructions[0].includes("Qu'est-ce que je dois facturer"));
});

// ==================================================================
// 4. « AGENT UTILISE UNIQUEMENT TOOLS AUTORISÉS » (p. 32)
// ==================================================================

test("la Facturation ne se voit offrir aucun outil du chiffrage ni de la Direction", async () => {
  const d = decor({ scripts: { billing: [{ type: "final", sortie: analyse() }] } });

  await d.runtime.executer({ agent: "billing", question: "?", criticite: "ordinaire" });

  const offerts = d.modele.pour("billing").outils[0];
  assert.ok(offerts.includes("getUnbilledProjects"), "ses propres outils, oui");
  assert.ok(offerts.includes("searchEntities"), "les transverses aussi");
  for (const etranger of ["getQuote", "getExecutiveBrief", "getCompanyMetrics", "getNurseryStock"]) {
    assert.ok(!offerts.includes(etranger), `« ${etranger} » n'appartient pas à la Facturation`);
  }
});

test("un outil dont le droit manque n'est PAS offert au modèle", async () => {
  // Finance sans `quotes.read` : sa source requise reste lisible, mais
  // `getMarginBreakdown` ne doit pas lui être proposé. Offrir un outil
  // puis refuser son droit ferait payer un aller-retour de jetons pour
  // obtenir « permission denied » — et le modèle, poliment, réessaierait.
  const d = decor({
    scripts: { finance: [{ type: "final", sortie: analyse() }] },
    permissions: ["projects.read", "invoice.create"],
  });

  await d.runtime.executer({ agent: "finance", question: "?", criticite: "ordinaire" });

  const offerts = d.modele.pour("finance").outils[0];
  assert.ok(offerts.includes("getCompanyMetrics"), "ce qu'il a le droit de lire lui est offert");
  assert.ok(!offerts.includes("getMarginBreakdown"), "ce qu'il n'a pas le droit de lire, non");
});

test("sans le droit qu'exige sa source REQUISE, l'agent ne coûte pas un seul jeton", async () => {
  // `getUnbilledProjects` exige `invoice.create`. Sans lui, le contexte
  // de la Facturation est vide : payer un raisonnement sur rien produit
  // une réponse confiante et creuse, la pire des deux.
  const d = decor({
    scripts: { billing: [{ type: "final", sortie: analyse() }] },
    permissions: ["projects.read", "quotes.read"],
  });

  const reponse = await d.runtime.executer({ agent: "billing", question: "?", criticite: "ordinaire" });

  assert.equal(reponse.execution.ok, false);
  assert.equal(reponse.execution.ok === false && reponse.execution.motif, "droits_manquants");
  assert.equal(d.modele.appelsTotaux, 0);
  assert.deepEqual(d.evenements, [], "aucun jeton n'a été consommé, donc rien à inscrire");
});

test("un spécialiste ne reçoit AUCUN outil d'agent : la chaîne ne peut pas s'allonger", async () => {
  const d = decor({ scripts: { finance: [{ type: "final", sortie: analyse() }] } });

  await d.runtime.executer({ agent: "finance", question: "?", criticite: "ordinaire" });

  for (const specialiste of SPECIALISTES) {
    const nom = `demander${specialiste.charAt(0).toUpperCase()}${specialiste.slice(1)}`;
    assert.ok(
      !d.modele.pour("finance").outils[0].includes(nom),
      `« ${nom} » ne doit pas être offert à un spécialiste`,
    );
  }
  assert.equal(PROFONDEUR_MAX_DELEGATION, 1);
});

// ==================================================================
// 5. « AGENTS AS TOOLS » (p. 10) ET LE BRIEF (p. 29)
// ==================================================================

test("la Direction interroge un spécialiste comme un outil, et chacun est routé et facturé pour son compte", async () => {
  const d = decor({
    scripts: {
      executive: [
        { type: "outil", nom: "demanderBilling", arguments: { question: "Qu'y a-t-il à facturer ?" } },
        { type: "final", sortie: brief() },
      ],
      billing: [{ type: "final", sortie: analyse() }],
    },
    lectures: { ai_executive_brief: { alertes: [] }, ai_billing_candidates: { prets: 10 } },
  });

  const reponse = await d.runtime.executer({
    agent: "executive",
    question: "Que dois-je faire aujourd'hui ?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, true);
  assert.ok(reponse.sortie !== null && "decisions" in reponse.sortie);

  // La délégation a bien eu lieu, et elle est TRACÉE séparément.
  assert.equal(reponse.delegations.length, 1);
  assert.equal(reponse.delegations[0].agent, "billing");
  assert.equal(reponse.delegations[0].execution.ok, true);

  // DEUX lignes au grand livre. Une seule ferait porter la dépense du
  // spécialiste au dos de la Direction — ou la ferait disparaître.
  assert.equal(d.evenements.length, 2);
  assert.deepEqual(d.evenements.map((e) => e.agent).sort(), ["billing", "executive"]);

  // La Direction s'est vu offrir les trois spécialistes.
  const offerts = d.modele.pour("executive").outils[0];
  for (const specialiste of SPECIALISTES) {
    const nom = `demander${specialiste.charAt(0).toUpperCase()}${specialiste.slice(1)}`;
    assert.ok(offerts.includes(nom), `« ${nom} » manque à la Direction`);
  }
});

test("le spécialiste interrogé lit SES sources : la Direction ne lui transmet aucun chiffre", async () => {
  const d = decor({
    scripts: {
      executive: [
        { type: "outil", nom: "demanderBilling", arguments: { question: "Qu'y a-t-il à facturer ?" } },
        { type: "final", sortie: brief() },
      ],
      billing: [{ type: "final", sortie: analyse() }],
    },
    lectures: { ai_executive_brief: {}, ai_billing_candidates: { prets: 10 } },
  });

  await d.runtime.executer({
    agent: "executive",
    question: "Que dois-je faire ?",
    criticite: "ordinaire",
  });

  // C'est ce qui rend vraie la phrase de la p. 8 — la Direction « n'a
  // aucune donnée à lui » — et ce qui rend chaque ligne du brief
  // attribuable à celui qui l'a calculée.
  assert.ok(d.lectures.some((l) => l.rpc === "ai_billing_candidates"));
  const entree = JSON.stringify(d.modele.pour("billing").entrees[0]);
  assert.ok(entree.includes("Qu'y a-t-il à facturer"));
});

test("un spécialiste en panne ne fait pas taire la Direction : elle apprend qu'il n'a pas répondu", async () => {
  const d = decor({
    scripts: {
      executive: [
        { type: "outil", nom: "demanderBilling", arguments: { question: "?" } },
        { type: "final", sortie: brief({ donneesManquantes: ["la Facturation n'a pas répondu"] }) },
      ],
      billing: [{ type: "panne", erreur: new Error("ETIMEDOUT") }],
    },
    lectures: { ai_executive_brief: {}, ai_billing_candidates: {} },
  });

  const reponse = await d.runtime.executer({
    agent: "executive",
    question: "Que dois-je faire ?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, true, "la Direction conclut quand même");
  assert.equal(reponse.delegations.length, 1);
  assert.equal(reponse.delegations[0].execution.ok, false);
  assert.ok(
    reponse.sortie !== null &&
      "donneesManquantes" in reponse.sortie &&
      reponse.sortie.donneesManquantes.length > 0,
    "et elle le dit plutôt que de conclure sans lui",
  );
});

// ==================================================================
// 6. LE CONTRÔLE SERVEUR D'UNE INTERRUPTION (p. 13-14)
// ==================================================================

test("au niveau 1, l'écriture demandée est REFUSÉE côté serveur et rien n'est enregistré", async () => {
  const d = decor({
    niveau: 1,
    scripts: {
      billing: [
        { type: "outil", nom: "createInvoiceDraft" },
        { type: "final", sortie: analyse({ recommandations: [] }) },
      ],
    },
  });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "Prépare les factures",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, true, "l'agent répond, il n'écrit simplement pas");
  assert.deepEqual(d.actionsEcrites, [], "aucune ligne d'action");
  assert.deepEqual(d.approbations, []);
  assert.deepEqual(reponse.actions, []);
  assert.ok(
    reponse.avertissements.some((a) => a.includes("niveau d'autonomie 1")),
    "le refus remonte à l'utilisateur avec le réglage à changer",
  );
});

test("un type d'action hors catalogue n'enregistre rien et le modèle l'apprend", async () => {
  const d = decor({
    niveau: 3,
    catalogue: null,
    scripts: {
      billing: [
        { type: "outil", nom: "createInvoiceDraft" },
        { type: "final", sortie: analyse({ recommandations: [] }) },
      ],
    },
  });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "Prépare les factures",
    criticite: "ordinaire",
  });

  assert.deepEqual(d.actionsEcrites, []);
  assert.ok(reponse.avertissements.some((a) => a.includes("catalogue")));
});

test("un risque élevé n'atteint jamais le service métier, même au niveau 4", async () => {
  const d = decor({
    niveau: 4,
    autopiloteRend: true,
    executeurs: ["createInvoiceDraft"],
    catalogue: { ...CATALOGUE, risqueParDefaut: "high" },
    scripts: {
      billing: [
        { type: "outil", nom: "createInvoiceDraft" },
        { type: "final", sortie: analyse() },
      ],
    },
  });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "Prépare les factures",
    criticite: "ordinaire",
  });

  assert.deepEqual(d.autopilotes, [], "on ne demande même pas à la base : le chemin n'existe pas");
  assert.deepEqual(d.executions, []);
  assert.equal(reponse.actions[0].statut, "awaiting_approval");
  assert.equal(reponse.actions[0].confirmationRequise, true);
});

test("l'autopilote agit quand tout l'autorise — et c'est le seul chemin vers le service métier", async () => {
  const d = decor({
    niveau: 4,
    autopiloteRend: true,
    executeurs: ["createInvoiceDraft"],
    scripts: {
      billing: [
        { type: "outil", nom: "createInvoiceDraft" },
        { type: "final", sortie: analyse() },
      ],
    },
  });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "Prépare les factures",
    criticite: "ordinaire",
  });

  assert.equal(d.executions.length, 1, "le dernier maillon de la page 14");
  assert.equal(d.executions[0].organizationId, "org-A");
  assert.equal(reponse.actions[0].statut, "executed");
  assert.deepEqual(d.approbations, [], "il n'y a plus rien à valider");
});

// ==================================================================
// 7. L'AUTONOMIE, VUE D'EN HAUT
// ==================================================================

test("au niveau 0, aucun contexte n'est construit et aucun modèle n'est appelé", async () => {
  const d = decor({ niveau: 0, scripts: { billing: [{ type: "final", sortie: analyse() }] } });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "Qu'est-ce que je dois facturer ?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, false);
  assert.equal(d.modele.appelsTotaux, 0, "on ne paie pas un raisonnement pour le jeter");
  assert.deepEqual(d.lectures, [], "et les données de l'entreprise ne sortent pas pour rien");
  assert.deepEqual(d.evenements, []);
  assert.ok(reponse.execution.ok === false && reponse.execution.message.includes("Observe"));
});

test("un agent éteint et un agent muet ne se disent pas de la même façon", async () => {
  const eteint = decor({
    niveau: 2,
    actif: false,
    scripts: { billing: [{ type: "final", sortie: analyse() }] },
  });

  const reponse = await eteint.runtime.executer({
    agent: "billing",
    question: "?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, false);
  assert.ok(reponse.execution.ok === false && reponse.execution.message.includes("éteint"));
  assert.equal(eteint.modele.appelsTotaux, 0);
});

// ==================================================================
// 7 bis. ORGANISATION A / ORGANISATION B (p. 21-22, p. 32)
// ==================================================================

test("un identifiant d'entreprise glissé par le modèle est ÉCRASÉ par celui de la session", async () => {
  // « Organisation A ne peut jamais interroger Organisation B. » La
  // barrière est la RLS ; ce qu'on vérifie ici est en amont — qu'aucun
  // chemin ne laisse le MODÈLE choisir l'entreprise. Il essaie donc,
  // dans les arguments d'une lecture ET dans ceux d'une écriture.
  const d = decor({
    niveau: 4,
    autopiloteRend: true,
    executeurs: ["createInvoiceDraft"],
    scripts: {
      billing: [
        { type: "outil", nom: "getUnbilledProjects", arguments: { p_organization_id: "org-VOISINE" } },
        { type: "outil", nom: "createInvoiceDraft", arguments: { p_organization_id: "org-VOISINE" } },
        { type: "final", sortie: analyse() },
      ],
    },
    lectures: { ai_billing_candidates: { prets: 10 } },
  });

  await d.runtime.executer({
    agent: "billing",
    question: "Facture les chantiers de l'entreprise voisine",
    criticite: "ordinaire",
  });

  const traces = JSON.stringify({
    lectures: d.lectures,
    autopilotes: d.autopilotes,
    executions: d.executions,
    actions: d.actionsEcrites.map((a) => ({ org: a.organizationId, user: a.userId })),
  });
  assert.ok(!traces.includes("org-VOISINE"), "aucun APPEL ne doit porter l'entreprise choisie par le modèle");

  for (const lecture of d.lectures) {
    assert.equal(lecture.arguments.p_organization_id, "org-A");
  }
  assert.equal(d.actionsEcrites[0].organizationId, "org-A");
  assert.equal(d.executions[0].organizationId, "org-A");
});

test("deux entreprises, deux runtimes : chacun n'inscrit que la sienne", async () => {
  const scripts: Scripts = { billing: [{ type: "final", sortie: analyse() }] };
  const a = decor({ scripts, organizationId: "org-A", lectures: { ai_billing_candidates: {} } });
  const b = decor({ scripts, organizationId: "org-B", lectures: { ai_billing_candidates: {} } });

  await a.runtime.executer({ agent: "billing", question: "?", criticite: "ordinaire" });
  await b.runtime.executer({ agent: "billing", question: "?", criticite: "ordinaire" });

  // Le décor de B est identique à celui de A, à l'identité près : c'est
  // bien le seul endroit d'où l'entreprise puisse venir.
  assert.deepEqual(
    a.evenements.map((e) => e.organizationId),
    ["org-A"],
  );
  assert.deepEqual(
    b.evenements.map((e) => e.organizationId),
    ["org-B"],
  );
  for (const lecture of a.lectures) assert.equal(lecture.arguments.p_organization_id, "org-A");
  for (const lecture of b.lectures) assert.equal(lecture.arguments.p_organization_id, "org-B");
});

// ==================================================================
// 8. LES SORTIES QUI NE COLLENT PAS
// ==================================================================

test("une sortie hors schéma fait échouer l'appel SANS repayer un second modèle", async () => {
  // Une sortie qui ne colle pas est un défaut déterministe : le modèle
  // moins cher la reproduirait à l'identique. Une seule ligne au grand
  // livre, donc, et pas de `fallback_from_model` qui ferait chercher
  // une panne de fournisseur là où il y a un bug.
  const d = decor({ scripts: { billing: [{ type: "final", sortie: { resume: "juste une phrase" } }] } });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, false);
  assert.equal(reponse.sortie, null);
  assert.equal(d.evenements.length, 1, "l'échec est journalisé : les jetons ont bien été payés");
  assert.equal(d.evenements[0].succes, false);
});

test("la sortie de la Direction est bornée à cinq décisions, triées ici et pas par le modèle", async () => {
  const decisions = Array.from({ length: 7 }, (_, i) => ({
    title: `decision ${i}`,
    summary: "…",
    priority: i * 10,
    category: "information",
    confidence: "medium",
    estimatedImpact: "—",
    estimatedImpactCents: null,
    reasons: [],
    suggestedActionType: null,
    suggestedActionLabel: null,
  }));

  const d = decor({
    scripts: { executive: [{ type: "final", sortie: brief({ decisions }) }] },
    lectures: { ai_executive_brief: {} },
  });

  const reponse = await d.runtime.executer({
    agent: "executive",
    question: "Que dois-je faire ?",
    criticite: "ordinaire",
  });

  assert.ok(reponse.sortie !== null && "decisions" in reponse.sortie);
  assert.equal(reponse.sortie.decisions.length, 5);
  assert.equal(reponse.sortie.decisions[0].title, "decision 6", "la plus prioritaire d'abord");
});

// ==================================================================
// 9. Les bornes du runtime
// ==================================================================

test("le nombre de tours de modèle est borné", () => {
  assert.equal(MAX_TOURS_MODELE, 8);
});

test("`entreeModele` sépare toujours la question des données", () => {
  const texte = entreeModele("combien ?", {
    agent: "finance",
    organizationId: "org-A",
    workspaceId: "ws-A",
    userId: "user-A",
    permissions: [],
    donnees: { getCompanyMetrics: { caCents: 1 } },
    sources: [],
    permissionsManquantes: [],
    vide: false,
    dateArreteDonnees: "2026-09-03T09:00:00.000Z",
    empreinte: "e",
    tailleCaracteres: 10,
  });

  const positionQuestion = texte.indexOf("combien ?");
  const positionDonnees = texte.indexOf("DONNÉES LUES POUR TOI");
  assert.ok(positionQuestion >= 0 && positionDonnees > positionQuestion);
});

// ==================================================================
// 10. LES RÉGRESSIONS QUE PERSONNE NE VOYAIT
// ==================================================================

/**
 * Le VRAI routeur, avec des identifiants de test.
 *
 * Les trois noms de modèle n'ont pas le droit d'être écrits ailleurs
 * que dans `router.ts` (`router.test.ts` le vérifie) : on passe donc
 * par les variables d'environnement du routeur, ce qui donne la vraie
 * logique — décalage relatif, planchers absolus, plafonds — sans écrire
 * un seul identifiant réel.
 */
function vraiRouteur(): AIModelRouter {
  return new AIModelRouter({
    env: {
      OASIS_MODEL_ECONOMY: MODELES.economy,
      OASIS_MODEL_STANDARD: MODELES.standard,
      OASIS_MODEL_ADVANCED: MODELES.advanced,
    },
  });
}

/** Les modèles réellement demandés au fournisseur pour cet agent. */
function modelesVus(d: ReturnType<typeof decor>, agent: AgentConstruit): string[] {
  return d.evenements.filter((e) => e.agent === agent).map((e) => e.modele);
}

test("une Direction aiguillée « simple » ne fait PAS retomber Finance sur le modèle économique", async () => {
  // C'est le chemin le plus fréquent du produit : une question sans
  // mot-clé décisif part à la Direction avec `complexity: "simple"`,
  // pour ne pas payer le modèle avancé le temps de comprendre. Ce
  // signal est RELATIF à la Direction. Transmis tel quel à Finance —
  // configuré `standard` —, il le faisait tomber sur `economy`, et
  // « business analysis → Terra » (p. 34) devenait faux.
  const d = decor({
    routeur: vraiRouteur(),
    scripts: {
      executive: [
        { type: "outil", nom: "demanderFinance", arguments: { question: "Où en est la marge ?" } },
        { type: "final", sortie: brief({ agentsConsultes: ["finance"] }) },
      ],
      finance: [{ type: "final", sortie: analyse({ estimatedImpactCents: null }) }],
    },
    lectures: {
      ai_executive_brief: { actionsPrioritaires: [] },
      ai_get_daily_priorities: { devisARelancer: [] },
      ai_finance_snapshot: { caEncaisseTtcCents: 1_000 },
    },
  });

  await d.runtime.executer({
    agent: "executive",
    question: "Est-ce que je gagne de l'argent sur mes chantiers d'entretien ?",
    criticite: "ordinaire",
    routage: { complexity: "simple" },
  });

  // La Direction, elle, DOIT être descendue d'un cran : c'est
  // l'intention de l'aiguilleur, et elle est configurée « advanced ».
  assert.deepEqual([...new Set(modelesVus(d, "executive"))], [MODELES.standard]);

  // Finance, lui, reste sur son propre niveau.
  assert.deepEqual(
    [...new Set(modelesVus(d, "finance"))],
    [MODELES.standard],
    "le décalage posé pour la Direction ne concerne pas le spécialiste qu'elle interroge",
  );
});

test("un signal ABSOLU, lui, descend jusqu'au spécialiste", async () => {
  // L'argent en jeu ne dépend pas de qui regarde : un plancher posé sur
  // la Direction doit valoir pour Finance aussi, sinon la délégation
  // serait une échappatoire au plafond du forfait et aux planchers de
  // risque.
  const d = decor({
    routeur: vraiRouteur(),
    scripts: {
      executive: [
        { type: "outil", nom: "demanderFinance", arguments: { question: "Et la trésorerie ?" } },
        { type: "final", sortie: brief({ agentsConsultes: ["finance"] }) },
      ],
      finance: [{ type: "final", sortie: analyse({ estimatedImpactCents: null }) }],
    },
    lectures: {
      ai_executive_brief: { actionsPrioritaires: [] },
      ai_get_daily_priorities: {},
      ai_finance_snapshot: {},
    },
  });

  await d.runtime.executer({
    agent: "executive",
    question: "?",
    criticite: "ordinaire",
    // 40 000 euros : très au-dessus du seuil de plancher avancé.
    routage: { financialImpact: 4_000_000 },
  });

  assert.deepEqual(
    [...new Set(modelesVus(d, "finance"))],
    [MODELES.advanced],
    "l'impact financier est un fait, pas une appréciation : il suit la délégation",
  );
});

test("un échec APRÈS un tour payé n'est pas inscrit à zéro jeton", async () => {
  // « La sortie du modèle ne correspond pas au schéma attendu » est
  // levé après un run complet. Les jetons sont payés. Les inscrire à
  // zéro laissait un modèle qui échoue systématiquement brûler du
  // budget sans qu'aucun plafond ne bouge.
  const d = decor({
    scripts: {
      billing: [{ type: "final", sortie: { ceci: "ne colle à aucun schéma" } }],
    },
    lectures: { ai_billing_candidates: { prets: 1 } },
  });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, false);
  assert.equal(d.evenements.length, 1, "l'échec est journalisé, une fois");
  const ligne = d.evenements[0];
  assert.equal(ligne.succes, false);
  assert.equal(ligne.jetonsEntree, 1_200, "les jetons d'entrée du run sont payés : ils se comptent");
  assert.equal(ligne.jetonsSortie, 300);
});

test("le brief mis en cache porte une empreinte qui couvre les SPÉCIALISTES", async () => {
  // L'empreinte du seul contexte de la Direction ne bouge pas quand la
  // trésorerie change : ses deux sources n'en parlent pas. Une entrée
  // de cache indexée dessus resservait un brief périmé pendant un quart
  // d'heure, sans le moindre avertissement.
  const lecturesA: Record<string, unknown> = {
    ai_executive_brief: { actionsPrioritaires: [] },
    ai_get_daily_priorities: { devisARelancer: [] },
    ai_billing_candidates: { prets: 10 },
    ai_finance_snapshot: { caEncaisseTtcCents: 1_000_000 },
  };

  const empreinte = async (lectures: Record<string, unknown>): Promise<string> => {
    const d = decor({
      scripts: { executive: [{ type: "final", sortie: brief({ estimatedImpactCents: null }) }] },
      lectures,
    });
    await d.runtime.executer({
      agent: "executive",
      question: "Que dois-je faire aujourd'hui ?",
      criticite: "ordinaire",
      cache: { cle: "brief:direction" },
    });
    assert.equal(d.lecturesCache.length, 1, "le cache doit avoir été consulté");
    return d.lecturesCache[0].empreinte;
  };

  const avant = await empreinte(lecturesA);
  // SEULE la trésorerie bouge : aucune source de la Direction ne change.
  const apres = await empreinte({
    ...lecturesA,
    ai_finance_snapshot: { caEncaisseTtcCents: 1_450_000 },
  });

  assert.notEqual(
    avant,
    apres,
    "un encaissement doit invalider le brief : sinon il est resservi avec une trésorerie périmée",
  );
});

test("un montant que les données ne contiennent pas est RETIRÉ, et l'utilisateur en est averti", async () => {
  // La frontière déterministe (p. 11-12) ne tenait que par une phrase
  // d'instruction. Un chiffre affiché — « 38 450 euros à facturer » —
  // sortait du modèle alors que la requête qui l'a produit était dans
  // le même objet, à portée de comparaison.
  const d = decor({
    scripts: {
      billing: [
        { type: "outil", nom: "getUnbilledProjects" },
        { type: "final", sortie: analyse() }, // annonce 3 845 000 centimes
      ],
    },
    // La source ne rend PAS ce montant : elle en rend un autre.
    lectures: { ai_billing_candidates: { prets: 10, totalHtCents: 1_200_000 } },
  });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "Qu'est-ce que je dois facturer ?",
    criticite: "ordinaire",
  });

  assert.equal(reponse.execution.ok, true);
  assert.ok(reponse.sortie !== null && "recommandations" in reponse.sortie);
  assert.equal(
    reponse.sortie.recommandations[0].estimatedImpactCents,
    null,
    "un chiffre que le SQL n'a pas rendu ne s'affiche pas comme s'il en venait",
  );
  assert.ok(
    reponse.avertissements.some((a) => /introuvable dans/.test(a)),
    "le retrait se dit ; sans cela, on croirait qu'Oasis n'a rien su estimer",
  );
});

test("un montant QUI VIENT des données traverse la chaîne intact", async () => {
  const d = decor({
    scripts: {
      billing: [
        { type: "outil", nom: "getUnbilledProjects" },
        { type: "final", sortie: analyse() },
      ],
    },
    lectures: { ai_billing_candidates: { prets: 10, totalHtCents: 3_845_000 } },
  });

  const reponse = await d.runtime.executer({
    agent: "billing",
    question: "Qu'est-ce que je dois facturer ?",
    criticite: "ordinaire",
  });

  assert.ok(reponse.sortie !== null && "recommandations" in reponse.sortie);
  assert.equal(reponse.sortie.recommandations[0].estimatedImpactCents, 3_845_000);
  assert.deepEqual(reponse.avertissements, []);
});

test("au niveau 1, un agent ne dépose AUCUNE proposition — comme le réglage le promet", async () => {
  // `autonomy.ts` promet « il recommande, il n'écrit rien, pas même une
  // ligne d'ai_actions » et `motifRefusAction` promet « il ne prépare
  // pas d'action ». La famille `proposition` échappait au curseur.
  const d = decor({
    niveau: 1,
    permissions: ["projects.read", "quotes.read", "quotes.create", "invoice.create"],
    scripts: {
      quotePricing: [
        {
          type: "outil",
          nom: "createQuoteDraft",
          arguments: { p_customer_id: "cli-1", p_title: "Talus", p_lines: [] },
        },
        { type: "final", sortie: analyse({ estimatedImpactCents: null }) },
      ],
    },
    lectures: {
      ai_get_daily_priorities: { devisARelancer: [] },
      ai_quote_price_analysis: { prixProposeHtCents: 1 },
    },
  });

  const reponse = await d.runtime.executer({
    agent: "quotePricing",
    question: "Prépare un devis.",
    criticite: "ordinaire",
  });

  assert.deepEqual(reponse.propositions, [], "le niveau 1 ne prépare rien, brouillon compris");
  assert.deepEqual(d.actionsEcrites, []);
  assert.ok(
    reponse.avertissements.some((a) => /niveau d'autonomie 1/.test(a)),
    "le refus se dit, et il nomme l'écran où le régler",
  );
});
