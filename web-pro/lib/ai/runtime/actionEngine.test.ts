import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS_MAX_PAR_REPONSE,
  OasisActionEngine,
  RISQUE_ELEVE_AU_DELA_DE_CENTS,
  detient,
  exigeConfirmationHumaine,
  risqueEffectif,
  risqueMax,
  type EntreeCatalogue,
  type PortActionEngine,
  type PortServicesMetier,
} from "./actionEngine.ts";
import type { ReglageAgent } from "./autonomy.ts";
import type { PropositionAction } from "./schemas.ts";
import type { IdentiteAppel, NiveauRisque, Permission } from "./types.ts";

/**
 * §11V — LA CHAÎNE D'ACTION, ÉPROUVÉE (spec p. 32, sections ACTION,
 * APPROVAL et SECURITY ; critère final p. 34).
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER SURVEILLE, ET POURQUOI CE SONT CELLES-LÀ
 * ══════════════════════════════════════════════════════════════════
 *
 * Trois interdits de la spec ne se vérifient pas à la lecture du code,
 * parce qu'ils portent sur ce qui N'ARRIVE PAS :
 *
 *   1. « IA ne touche pas directement DB » (p. 32). On ne peut pas le
 *      prouver en relisant `proposer()` : il faut COMPTER les appels.
 *      Le faux port ci-dessous journalise chacun des siens, et les
 *      tests de refus exigent des compteurs à ZÉRO. Un `enregistrer`
 *      qui partirait avant le contrôle de droit se verrait ici, et
 *      nulle part ailleurs.
 *
 *   2. « High risk bloqué sans confirmation » (p. 32). Le piège n'est
 *      pas qu'un HIGH parte tout seul — `ai_may_autoexecute` le
 *      refuserait sans doute. Le piège est qu'on le LUI DEMANDE : le
 *      jour où l'une de ses douze conditions se relâche, l'interdit de
 *      la page 15 disparaîtrait sans qu'une ligne de TypeScript ait
 *      changé. Les tests exigent donc `autopilotes === 0`, pas
 *      « autopilote refusé ».
 *
 *   3. « Organisation A ne peut jamais interroger Organisation B »
 *      (p. 21-22). La barrière est la RLS. Ce qu'on vérifie ici est en
 *      amont : que l'organisation écrite vient de la SESSION et jamais
 *      des paramètres proposés par le modèle. Un test pousse une
 *      organisation étrangère dans `parameters` et exige que la ligne
 *      insérée porte celle de la session.
 *
 * Le faux port ne simule pas Postgres. Il enregistre des appels et rend
 * ce qu'on lui dit de rendre — ce qui suffit, parce que la question
 * posée ici est « qu'est-ce que le moteur DEMANDE à la base », pas
 * « que répond la base ».
 */

// ==================================================================
// Le décor
// ==================================================================

const IDENTITE: IdentiteAppel = Object.freeze({
  organizationId: "org-A",
  workspaceId: "ws-A",
  userId: "user-A",
  permissions: ["projects.read", "quotes.read", "invoice.create"] as readonly Permission[],
});

function reglage(niveau: 0 | 1 | 2 | 3 | 4, actif = true): ReglageAgent {
  return { agent: "billing", actif, niveau, parDefaut: false };
}

function proposition(surcharge: Partial<PropositionAction> = {}): PropositionAction {
  return {
    actionType: "createInvoiceDraft",
    resume: "Préparer les brouillons des chantiers terminés",
    parameters: {},
    cibleType: null,
    cibleId: null,
    montantCents: null,
    ...surcharge,
  };
}

function entree(surcharge: Partial<EntreeCatalogue> = {}): EntreeCatalogue {
  return {
    actionType: "createInvoiceDraft",
    agent: "billing",
    label: "Créer des brouillons de facture",
    risqueParDefaut: "medium",
    permissionRequise: "invoice.create",
    ecrit: true,
    engageDeLArgent: true,
    ...surcharge,
  };
}

type Appels = {
  catalogue: string[];
  enregistrer: Parameters<PortActionEngine["enregistrer"]>[0][];
  approbations: Parameters<PortActionEngine["demanderApprobation"]>[0][];
  autopilotes: Parameters<PortActionEngine["autoriseAutopilote"]>[0][];
  clotures: Parameters<PortActionEngine["cloturer"]>[0][];
  journal: Parameters<PortActionEngine["journaliser"]>[0][];
  executions: Parameters<PortServicesMetier["executer"]>[0][];
};

type OptionsFaux = {
  entree?: EntreeCatalogue | null;
  autopiloteRend?: boolean;
  executeurs?: readonly string[];
  serviceRend?: { ok: true; message: string; resultat: Record<string, unknown> } | { ok: false; message: string };
  echoue?: Partial<Record<"catalogue" | "enregistrer" | "approbation" | "autopilote" | "journal" | "cloture", string>>;
};

function faux(options: OptionsFaux = {}) {
  const appels: Appels = {
    catalogue: [],
    enregistrer: [],
    approbations: [],
    autopilotes: [],
    clotures: [],
    journal: [],
    executions: [],
  };

  const echoue = options.echoue ?? {};

  const port: PortActionEngine = {
    async catalogue(actionType) {
      appels.catalogue.push(actionType);
      if (echoue.catalogue) throw new Error(echoue.catalogue);
      return options.entree === undefined ? entree() : options.entree;
    },
    async enregistrer(appel) {
      appels.enregistrer.push(appel);
      if (echoue.enregistrer) throw new Error(echoue.enregistrer);
      return "action-1";
    },
    async demanderApprobation(appel) {
      appels.approbations.push(appel);
      if (echoue.approbation) throw new Error(echoue.approbation);
      return "approval-1";
    },
    async autoriseAutopilote(appel) {
      appels.autopilotes.push(appel);
      if (echoue.autopilote) throw new Error(echoue.autopilote);
      return options.autopiloteRend === true;
    },
    async cloturer(appel) {
      appels.clotures.push(appel);
      if (echoue.cloture) throw new Error(echoue.cloture);
    },
    async journaliser(appel) {
      appels.journal.push(appel);
      if (echoue.journal) throw new Error(echoue.journal);
    },
  };

  const services: PortServicesMetier = {
    executeurs: options.executeurs ?? [],
    async executer(appel) {
      appels.executions.push(appel);
      return options.serviceRend ?? { ok: true, message: "fait", resultat: { crees: 3 } };
    },
  };

  return { appels, port, services, moteur: new OasisActionEngine(port, services) };
}

/** Le journal du serveur, muet le temps d'un test qui provoque une panne exprès. */
async function sansBruit<T>(travail: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await travail();
  } finally {
    console.error = original;
  }
}

// ==================================================================
// 1. LE RISQUE — ce que le catalogue pose et ce que le montant relève
// ==================================================================

test("le risque monte avec le montant, et ne descend jamais", () => {
  assert.equal(risqueEffectif(entree({ risqueParDefaut: "low" }), 1_999_999), "low");
  assert.equal(risqueEffectif(entree({ risqueParDefaut: "low" }), RISQUE_ELEVE_AU_DELA_DE_CENTS), "high");
  assert.equal(
    risqueEffectif(entree({ risqueParDefaut: "critical" }), RISQUE_ELEVE_AU_DELA_DE_CENTS),
    "critical",
    "vingt mille euros ne RABAISSE pas un critical à high : risqueMax prend le plus haut",
  );
});

test("un montant inconnu ne relève pas le risque, et c'est délibéré", () => {
  // Le relever ferait passer en `high` toute action sans montant, y
  // compris une note interne. Le montant manquant est traité là où il
  // compte : `ai_may_autoexecute` refuse l'autopilote sur une action
  // qui engage de l'argent sans montant (0072).
  assert.equal(risqueEffectif(entree({ risqueParDefaut: "low" }), null), "low");
});

test("les deux niveaux qui exigent un humain sont high et critical, pas medium", () => {
  assert.equal(exigeConfirmationHumaine("low"), false);
  assert.equal(exigeConfirmationHumaine("medium"), false);
  assert.equal(exigeConfirmationHumaine("high"), true);
  assert.equal(exigeConfirmationHumaine("critical"), true);
});

test("risqueMax classe les quatre niveaux dans l'ordre de la page 15", () => {
  const ordre: NiveauRisque[] = ["low", "medium", "high", "critical"];
  for (let i = 0; i < ordre.length; i += 1) {
    for (let j = 0; j < ordre.length; j += 1) {
      assert.equal(risqueMax(ordre[i], ordre[j]), ordre[Math.max(i, j)]);
    }
  }
});

test("une permission inconnue du produit rend false plutôt que de lever", () => {
  // La colonne `required_permission` est du TEXTE en base : une valeur
  // qui n'est pas dans PERMISSIONS doit refuser, pas planter.
  assert.equal(detient(IDENTITE.permissions, "invoice.create"), true);
  assert.equal(detient(IDENTITE.permissions, "droit.inexistant"), false);
});

// ==================================================================
// 2. « L'IA NE TOUCHE PAS DIRECTEMENT LA BASE » (p. 32)
// ==================================================================

test("un type d'action hors catalogue n'écrit RIEN", async () => {
  const { moteur, appels } = faux({ entree: null });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition({ actionType: "envoyerLaFacture" }),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok, false);
  assert.equal(resultat.ok === false && resultat.motif, "hors_catalogue");
  assert.deepEqual(appels.enregistrer, [], "aucune ligne d'action");
  assert.deepEqual(appels.approbations, [], "aucune demande de validation");
  assert.deepEqual(appels.autopilotes, [], "l'autopilote n'est pas même interrogé");
  assert.deepEqual(appels.executions, [], "aucun service métier appelé");
});

test("un droit manquant arrête la chaîne avant la moindre écriture", async () => {
  const { moteur, appels } = faux();

  const resultat = await moteur.proposer({
    identite: { ...IDENTITE, permissions: ["projects.read"] },
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok, false);
  assert.equal(resultat.ok === false && resultat.motif, "droit_manquant");
  assert.ok(
    resultat.ok === false && resultat.message.includes("invoice.create"),
    "le message nomme le droit à demander",
  );
  assert.deepEqual(appels.enregistrer, []);
  assert.deepEqual(appels.autopilotes, []);
});

test("un agent au niveau 1 ne prépare aucune action, et le message dit quoi régler", async () => {
  const { moteur, appels } = faux();

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(1),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok, false);
  assert.equal(resultat.ok === false && resultat.motif, "autonomie_insuffisante");
  assert.ok(resultat.ok === false && resultat.message.includes("niveau 2"));
  assert.deepEqual(appels.enregistrer, []);
});

test("un agent éteint et un agent au niveau 1 ne se disent pas de la même façon", async () => {
  const { moteur } = faux();
  const commun = {
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    libelleAgent: "Facturation",
  };

  const eteint = await moteur.verifierPrealable({ ...commun, reglage: reglage(4, false) });
  const bas = await moteur.verifierPrealable({ ...commun, reglage: reglage(1) });

  assert.ok(eteint.ok === false && eteint.message.includes("éteint"));
  assert.ok(bas.ok === false && bas.message.includes("niveau d'autonomie 1"));
});

test("le contrôle préalable n'écrit rien, même quand il dit oui", async () => {
  const { moteur, appels } = faux();

  const verdict = await moteur.verifierPrealable({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(2),
    libelleAgent: "Facturation",
  });

  assert.equal(verdict.ok, true);
  assert.deepEqual(appels.catalogue, ["createInvoiceDraft"], "il lit le catalogue");
  assert.deepEqual(appels.enregistrer, [], "et rien d'autre");
  assert.deepEqual(appels.approbations, []);
  assert.deepEqual(appels.autopilotes, []);
  assert.equal(moteur.compteur, 0);
});

// ==================================================================
// 3. « HIGH RISK BLOQUÉ SANS CONFIRMATION » (p. 32)
// ==================================================================

test("un risque élevé n'INTERROGE MÊME PAS l'autopilote, quel que soit le niveau", async () => {
  const { moteur, appels } = faux({
    entree: entree({ risqueParDefaut: "high" }),
    autopiloteRend: true,
    executeurs: ["createInvoiceDraft"],
  });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok, true);
  assert.deepEqual(
    appels.autopilotes,
    [],
    "le chemin d'auto-exécution n'existe pas pour high : on ne se fie pas à un « non » de la base",
  );
  assert.deepEqual(appels.executions, [], "aucun service métier n'a tourné");
  assert.equal(resultat.ok && resultat.action.statut, "awaiting_approval");
  assert.equal(resultat.ok && resultat.action.confirmationRequise, true);
  assert.equal(appels.approbations.length, 1);
  assert.equal(appels.approbations[0].risque, "high");
});

test("un risque critique non plus", async () => {
  const { moteur, appels } = faux({
    entree: entree({ risqueParDefaut: "critical" }),
    autopiloteRend: true,
    executeurs: ["createInvoiceDraft"],
  });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.deepEqual(appels.autopilotes, []);
  assert.equal(resultat.ok && resultat.action.confirmationRequise, true);
});

test("un montant de 20 000 € ferme l'autopilote d'une action pourtant réglée en medium", async () => {
  const { moteur, appels } = faux({
    entree: entree({ risqueParDefaut: "medium" }),
    autopiloteRend: true,
    executeurs: ["createInvoiceDraft"],
  });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition({ montantCents: 2_000_000 }),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.deepEqual(appels.autopilotes, [], "le montant a relevé le risque AVANT le test d'autopilote");
  assert.equal(resultat.ok && resultat.action.risque, "high");
  assert.equal(resultat.ok && resultat.action.montantCents, 2_000_000);
});

test("la ligne d'action porte requires_confirmation = true quand personne n'a autorisé l'autopilote", async () => {
  const { moteur, appels } = faux({ autopiloteRend: false, executeurs: ["createInvoiceDraft"] });

  await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(appels.enregistrer.length, 1);
  assert.equal(appels.enregistrer[0].confirmationRequise, true);
  assert.equal(appels.autopilotes.length, 1, "medium au niveau 4 : là, on demande");
  assert.equal(appels.approbations.length, 1);
});

// ==================================================================
// 4. L'AUTOPILOTE, QUAND IL A LE DROIT
// ==================================================================

test("niveau 4 + risque medium + exécuteur connu + base d'accord = exécution, clôture et journal", async () => {
  const { moteur, appels } = faux({
    autopiloteRend: true,
    executeurs: ["createInvoiceDraft"],
    serviceRend: { ok: true, message: "3 brouillons", resultat: { crees: 3 } },
  });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition({ montantCents: 45_000 }),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok, true);
  assert.equal(resultat.ok && resultat.action.statut, "executed");
  assert.equal(resultat.ok && resultat.action.confirmationRequise, false);
  assert.equal(resultat.ok && resultat.action.approvalId, null);
  assert.deepEqual(appels.approbations, [], "aucune validation demandée : elle n'aurait plus d'objet");
  assert.equal(appels.executions.length, 1);
  assert.deepEqual(appels.clotures, [
    { organizationId: "org-A", actionId: "action-1", ok: true, resultat: { crees: 3 } },
  ]);
  assert.equal(appels.journal[0].evenement, "aiActionExecuted");
  assert.equal(appels.journal[0].confirmation, "autopilot");
});

test("un service métier qui échoue clôt l'action en « failed » plutôt que de la laisser approuvée", async () => {
  const { moteur, appels } = faux({
    autopiloteRend: true,
    executeurs: ["createInvoiceDraft"],
    serviceRend: { ok: false, message: "aucun dossier prêt" },
  });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok && resultat.action.statut, "failed");
  assert.equal(appels.clotures[0].ok, false);
  assert.equal(appels.journal[0].evenement, "aiActionFailed");
});

test("sans exécuteur, l'autopilote n'est pas interrogé et l'utilisateur est prévenu", async () => {
  const { moteur, appels } = faux({ autopiloteRend: true, executeurs: [] });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.deepEqual(appels.autopilotes, []);
  assert.equal(resultat.ok && resultat.action.statut, "awaiting_approval");
  assert.ok(
    resultat.ok && resultat.avertissements.some((a) => a.includes("à la main")),
    "on annonce que le geste restera manuel plutôt que de laisser croire à une exécution",
  );
});

test("au niveau 2, l'absence d'exécuteur ne produit aucun avertissement — le geste manuel est le principe", async () => {
  const { moteur } = faux({ executeurs: [] });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(2),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok, true);
  assert.deepEqual(resultat.ok ? resultat.avertissements : ["—"], []);
});

test("un autopilote invérifiable retombe du côté fermé, et le DIT", async () => {
  const { moteur, appels } = faux({
    executeurs: ["createInvoiceDraft"],
    echoue: { autopilote: "connexion perdue" },
  });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok && resultat.action.confirmationRequise, true);
  assert.ok(
    resultat.ok && resultat.avertissements.some((a) => a.includes("connexion perdue")),
    "« l'autopilote ne part jamais » sans explication est la panne qu'on cherche des semaines",
  );
  assert.equal(appels.approbations.length, 1);
});

// ==================================================================
// 5. LE MULTI-TENANT (p. 21-22)
// ==================================================================

test("l'organisation écrite vient de la SESSION, jamais des paramètres proposés", async () => {
  const { moteur, appels } = faux({ autopiloteRend: true, executeurs: ["createInvoiceDraft"] });

  await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition({
      // Ce que ferait une donnée empoisonnée ou un modèle égaré : glisser
      // une autre entreprise dans les paramètres de l'action.
      parameters: { p_organization_id: "org-B", organizationId: "org-B" },
      montantCents: 1_000,
    }),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(appels.enregistrer[0].organizationId, "org-A");
  assert.equal(appels.autopilotes[0].organizationId, "org-A");
  assert.equal(appels.clotures[0].organizationId, "org-A");
  assert.equal(appels.journal[0].organizationId, "org-A");
  assert.equal(appels.executions[0].organizationId, "org-A");
  // Les paramètres sont transmis TELS QUELS à la base : c'est la
  // fonction SQL qui les filtre. Ce qu'on vérifie ici est que le champ
  // qui DÉSIGNE l'entreprise ne vient pas d'eux.
  assert.deepEqual(appels.enregistrer[0].parametres, {
    p_organization_id: "org-B",
    organizationId: "org-B",
  });
});

test("l'utilisateur inscrit sur l'action est celui de la session", async () => {
  const { moteur, appels } = faux();

  await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(2),
    libelleAgent: "Facturation",
  });

  assert.equal(appels.enregistrer[0].userId, "user-A");
});

test("c'est l'agent du CATALOGUE qui est enregistré, pas celui que le modèle annonce", async () => {
  const { moteur, appels } = faux();

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    // La Direction essaie de proposer une action de Facturation.
    agentDemandeur: "executive",
    proposition: proposition(),
    reglage: reglage(2),
    libelleAgent: "Direction",
  });

  assert.equal(appels.enregistrer[0].agent, "billing");
  assert.ok(
    resultat.ok && resultat.avertissements.some((a) => a.includes("billing")),
    "le désaccord se dit : c'est l'autonomie du propriétaire qui s'applique",
  );
});

// ==================================================================
// 6. LES PANNES, ET CE QU'ELLES NE CASSENT PAS
// ==================================================================

test("un catalogue illisible refuse sans écrire", async () => {
  const { moteur, appels } = faux({ echoue: { catalogue: "schema cache" } });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(4),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok === false && resultat.motif, "erreur_technique");
  assert.deepEqual(appels.enregistrer, []);
});

test("une action enregistrée dont la validation échoue est annoncée comme un échec, pas comme une attente", async () => {
  const { moteur, appels } = faux({ echoue: { approbation: "expiration invalide" } });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(2),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok, false);
  assert.equal(resultat.ok === false && resultat.motif, "erreur_technique");
  assert.ok(
    resultat.ok === false && resultat.message.includes("n'apparaîtra pas"),
    "une ligne restée « proposed » n'est visible nulle part : on ne dit pas « en attente de validation »",
  );
  assert.equal(appels.enregistrer.length, 1, "l'action, elle, existe bel et bien");
});

test("un journal d'audit en panne ne défait pas une action réussie, mais laisse une trace serveur", async () => {
  const { appels } = await sansBruit(async () => {
    const f = faux({ echoue: { journal: "audit indisponible" } });
    const resultat = await f.moteur.proposer({
      identite: IDENTITE,
      agentDemandeur: "billing",
      proposition: proposition(),
      reglage: reglage(2),
      libelleAgent: "Facturation",
    });
    assert.equal(resultat.ok, true);
    return f;
  });

  assert.equal(appels.approbations.length, 1);
});

test("l'enregistrement qui échoue n'entraîne aucune demande de validation orpheline", async () => {
  const { moteur, appels } = faux({ echoue: { enregistrer: "contrainte violée" } });

  const resultat = await moteur.proposer({
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(2),
    libelleAgent: "Facturation",
  });

  assert.equal(resultat.ok === false && resultat.motif, "erreur_technique");
  assert.deepEqual(appels.approbations, []);
  assert.equal(moteur.compteur, 0, "une action qui n'a pas été écrite ne compte pas");
});

// ==================================================================
// 7. LE BUDGET D'ACTIONS D'UNE RÉPONSE
// ==================================================================

test("au-delà du plafond d'actions, la suivante est refusée sans être écrite", async () => {
  const { port, services } = faux();
  const moteur = new OasisActionEngine(port, services, { maxActions: 2 });

  const demande = {
    identite: IDENTITE,
    agentDemandeur: "billing",
    proposition: proposition(),
    reglage: reglage(2),
    libelleAgent: "Facturation",
  };

  assert.equal((await moteur.proposer(demande)).ok, true);
  assert.equal((await moteur.proposer(demande)).ok, true);

  const troisieme = await moteur.proposer(demande);
  assert.equal(troisieme.ok, false);
  assert.equal(troisieme.ok === false && troisieme.motif, "quota_actions");
  assert.equal(moteur.compteur, 2);
});

test("le plafond par défaut est celui que le fichier annonce", () => {
  assert.equal(ACTIONS_MAX_PAR_REPONSE, 20);
});
