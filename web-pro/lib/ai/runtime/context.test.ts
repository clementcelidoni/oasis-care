import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS_AVEC_PLAN,
  AgentContextBuilder,
  CLES_INTERDITES,
  ELEMENTS_MAX_DEFAUT,
  LONGUEUR_TEXTE_MAX,
  elaguer,
  empreinteDe,
  outilsPourContexte,
  serialiserStable,
  type PortLectureSource,
} from "./context.ts";
import { OasisAIToolRegistry, registreOutils } from "./tools.ts";
import type { IdentiteAppel, Permission } from "./types.ts";

/**
 * §11V — LE CONTEXTE MINIMAL (spec p. 20-22).
 *
 * Ce fichier défend une seule idée sous trois formes : CE QUI N'EST PAS
 * ENVOYÉ. Un test qui vérifie que Finance reçoit bien ses revenus est
 * facile et sans valeur ; celui qui vérifie qu'il ne reçoit pas de
 * photos de plantes est le sujet.
 */

const TOUS_DROITS: Permission[] = [
  "clients.read",
  "clients.write",
  "quotes.read",
  "quotes.create",
  "quotes.edit",
  "quotes.approve",
  "projects.read",
  "projects.manage",
  "digitalTwin.edit",
  "nursery.stock.manage",
  "invoice.create",
  "organization.manageUsers",
];

function identite(permissions: Permission[] = TOUS_DROITS): IdentiteAppel {
  return {
    organizationId: "org-a",
    workspaceId: "ws-a",
    userId: "user-1",
    permissions,
  };
}

/** Un lecteur qui note ce qu'on lui demande et rend ce qu'on lui dit. */
function lecteur(reponses: Record<string, unknown>): {
  port: PortLectureSource;
  appels: { rpc: string; arguments: Record<string, unknown> }[];
} {
  const appels: { rpc: string; arguments: Record<string, unknown> }[] = [];
  const port: PortLectureSource = async (appel) => {
    appels.push(appel);
    return appel.rpc in reponses
      ? { ok: true, donnees: reponses[appel.rpc] }
      : { ok: false, message: "aucune réponse prévue par le test" };
  };
  return { port, appels };
}

// ==================================================================
// 1. LA MINIMISATION — chaque agent reçoit SEULEMENT le contexte utile
// ==================================================================

test("Finance lit ses sources financières, et AUCUNE autre", async () => {
  const { port, appels } = lecteur({
    ai_finance_snapshot: { chiffreAffaires: {} },
    ai_finance_margin_breakdown: { global: {} },
    ai_analyze_project_margin: { chantiers: [] },
  });

  const contexte = await new AgentContextBuilder(port).construire({
    agent: "finance",
    identite: identite(),
  });

  const rpcs = appels.map((a) => a.rpc).sort();
  assert.deepEqual(rpcs, [
    "ai_analyze_project_margin",
    "ai_finance_margin_breakdown",
    "ai_finance_snapshot",
  ]);
  for (const interdit of ["ai_get_digital_twin_quantities", "ai_find_stock", "ai_get_client_context"]) {
    assert.ok(!rpcs.includes(interdit), `Finance ne doit pas lire ${interdit}`);
  }
  assert.equal(contexte.vide, false);
});

test("la Direction ne lit aucune source primaire (p. 8)", async () => {
  const { port, appels } = lecteur({
    ai_executive_brief: { actionsPrioritaires: [] },
    ai_get_daily_priorities: { date: "2026-09-03" },
  });

  await new AgentContextBuilder(port).construire({ agent: "executive", identite: identite() });

  // « Il ne doit PAS récupérer toute la base directement. Il utilise
  // les résultats structurés des agents spécialisés. »
  for (const appel of appels) {
    assert.ok(
      ["ai_executive_brief", "ai_get_daily_priorities"].includes(appel.rpc),
      `la Direction ne doit pas appeler ${appel.rpc}`,
    );
  }
});

test("les outils offerts suivent l'agent, pas l'inventaire", async () => {
  const { port } = lecteur({ ai_finance_snapshot: {} });
  const contexte = await new AgentContextBuilder(port).construire({
    agent: "finance",
    identite: identite(),
  });

  const noms = outilsPourContexte(contexte, registreOutils()).map((o) => o.nom);
  assert.ok(noms.includes("getCompanyMetrics"));
  assert.ok(!noms.includes("getQuote"), "Finance n'a pas d'outil de devis");
  assert.ok(!noms.includes("getNurseryStock"), "Finance n'a pas d'outil de pépinière");
  assert.ok(noms.includes("searchEntities"), "les outils transverses restent offerts");
});

test("une source dont le droit manque N'EST PAS interrogée, et le droit est nommé", async () => {
  const { port, appels } = lecteur({ ai_finance_snapshot: { ok: true } });

  const contexte = await new AgentContextBuilder(port).construire({
    agent: "finance",
    // `invoice.create` est là, `quotes.read` et `projects.read` non.
    identite: identite(["invoice.create"]),
  });

  assert.deepEqual(appels.map((a) => a.rpc), ["ai_finance_snapshot"]);
  assert.deepEqual([...contexte.permissionsManquantes].sort(), ["projects.read", "quotes.read"]);
  assert.equal(contexte.vide, false, "la source requise a répondu : l'analyse est partielle, pas vide");
});

test("aucune source requise lue → contexte VIDE, et l'agent ne doit pas être appelé", async () => {
  const { port } = lecteur({});
  const contexte = await new AgentContextBuilder(port).construire({
    agent: "billing",
    identite: identite([]),
  });
  assert.equal(contexte.vide, true);
  assert.deepEqual(contexte.permissionsManquantes, ["invoice.create"]);
});

test("une cible absente rend l'étape non applicable, sans appel — mais pas l'agent muet", async () => {
  const { port, appels } = lecteur({
    ai_quote_price_analysis: {},
    ai_get_daily_priorities: { devisARelancer: [] },
  });
  const contexte = await new AgentContextBuilder(port).construire({
    agent: "quotePricing",
    identite: identite(),
    // Aucun `quoteId` : aucun devis DÉSIGNÉ à analyser.
  });

  // Les étapes qui dépendent du devis n'appellent rien.
  assert.deepEqual(appels.map((a) => a.rpc), ["ai_get_daily_priorities"]);
  const parOutil = new Map(contexte.sources.map((s) => [s.outil, s]));
  assert.equal(parOutil.get("getQuote")?.ok, false);
  assert.match(parOutil.get("getQuote")?.motif ?? "", /Cible absente/);

  // Mais le portefeuille, lui, ne dépend d'aucune cible : l'agent a de
  // quoi parler. Un contexte vide ici ferait rapporter « rien à dire »
  // au brief de Direction, tous les matins.
  assert.equal(contexte.vide, false);
});

test("l'organisation est injectée par le serveur, jamais par l'appelant", async () => {
  const { port, appels } = lecteur({ ai_billing_candidates: {} });
  await new AgentContextBuilder(port).construire({ agent: "billing", identite: identite() });
  assert.equal(appels[0].arguments.p_organization_id, "org-a");
});

test("une fonction qui relit l'organisation sur la ligne ne la reçoit PAS", async () => {
  const { port, appels } = lecteur({ ai_quote_price_analysis: {} });
  await new AgentContextBuilder(port).construire({
    agent: "quotePricing",
    identite: identite(),
    cible: { quoteId: "devis-1" },
    sourcesDemandees: ["getQuote"],
  });
  assert.deepEqual(appels[0].arguments, { p_quote_id: "devis-1" });
  assert.ok(
    !("p_organization_id" in appels[0].arguments),
    "on ne peut pas se tromper d'entreprise sur un paramètre qui n'existe pas",
  );
});

// ==================================================================
// 2. L'ÉLAGAGE — la barrière contre nous-mêmes
// ==================================================================

test("les clés interdites ne partent pas, même imbriquées", () => {
  const elague = elaguer({
    montantCents: 3_845_000,
    client: { nom: "Dupont", photoUrl: "https://…", signature_base64: "AAAA" },
    chantiers: [{ id: 1, mainPhoto: "x", documents: ["a", "b"] }],
  }) as Record<string, unknown>;

  const serialise = JSON.stringify(elague);
  assert.ok(serialise.includes("3845000"), "les chiffres restent");
  assert.ok(serialise.includes("Dupont"), "les noms utiles restent");
  for (const fragment of ["photoUrl", "signature_base64", "mainPhoto", "documents"]) {
    assert.ok(!serialise.includes(fragment), `« ${fragment} » ne doit pas sortir de l'entreprise`);
  }
});

test("la liste des clés interdites couvre les familles annoncées par la page 20", () => {
  for (const attendu of ["photo", "document", "signature", "token", "iban"]) {
    assert.ok(CLES_INTERDITES.includes(attendu), `« ${attendu} » doit figurer dans la liste`);
  }
});

test("un tableau trop long est coupé, ET LE DIT", () => {
  const elague = elaguer({ lignes: Array.from({ length: 120 }, (_, i) => i) }, 50) as {
    lignes: unknown[];
  };
  assert.equal(elague.lignes.length, 51, "50 éléments plus la mention de ce qui manque");
  assert.match(String(elague.lignes[50]), /70 élément\(s\) non transmis/);
});

test("le plafond par défaut est celui annoncé", () => {
  const elague = elaguer({ x: Array.from({ length: ELEMENTS_MAX_DEFAUT + 5 }, () => 1) }) as {
    x: unknown[];
  };
  assert.equal(elague.x.length, ELEMENTS_MAX_DEFAUT + 1);
});

test("un texte immense est tronqué plutôt qu'envoyé", () => {
  const elague = elaguer({ note: "a".repeat(LONGUEUR_TEXTE_MAX + 500) }) as { note: string };
  assert.ok(elague.note.length < LONGUEUR_TEXTE_MAX + 50);
  assert.match(elague.note, /texte tronqué/);
});

test("l'élagage ne modifie pas la valeur d'origine", () => {
  const origine = { photo: "x", montantCents: 100 };
  elaguer(origine);
  assert.equal(origine.photo, "x", "la valeur d'audit ne doit pas être corrompue");
});

test("une profondeur absurde s'arrête au lieu de boucler", () => {
  let noeud: Record<string, unknown> = { fin: 1 };
  for (let i = 0; i < 40; i += 1) noeud = { suivant: noeud };
  const serialise = JSON.stringify(elaguer(noeud));
  assert.match(serialise, /profondeur maximale/);
});

// ==================================================================
// 3. L'EMPREINTE — celle que `ai_cache_lookup` exige
// ==================================================================

test("l'empreinte ne dépend pas de l'ordre des clés", () => {
  assert.equal(
    empreinteDe({ b: 2, a: 1 }, ["x"]),
    empreinteDe({ a: 1, b: 2 }, ["x"]),
    "sans tri, le cache raterait toujours, et ça ne se verrait que sur la facture",
  );
});

test("l'empreinte change quand la donnée change", () => {
  assert.notEqual(empreinteDe({ a: 1 }, ["x"]), empreinteDe({ a: 2 }, ["x"]));
});

test("l'empreinte change quand les sources lues changent", () => {
  // Deux contextes qui n'ont pas lu les mêmes choses ne doivent pas
  // partager d'entrée de cache, même si le peu qu'ils ont lu coïncide.
  assert.notEqual(empreinteDe({ a: 1 }, ["x:ok"]), empreinteDe({ a: 1 }, ["x:ok", "y:ko"]));
});

test("la sérialisation stable trie à toute profondeur", () => {
  assert.equal(
    serialiserStable({ z: { b: 1, a: 2 }, a: [3, { d: 1, c: 2 }] }),
    '{"a":[3,{"c":2,"d":1}],"z":{"a":2,"b":1}}',
  );
});

// ==================================================================
// 4. LES QUATRE CHAMPS DE LA PAGE 21-22, ET LA DATE D'ARRÊTÉ
// ==================================================================

test("chaque contexte porte organizationId, workspaceId, userId et permissions", async () => {
  const { port } = lecteur({ ai_billing_candidates: {} });
  const contexte = await new AgentContextBuilder(port).construire({
    agent: "billing",
    identite: identite(),
  });
  assert.equal(contexte.organizationId, "org-a");
  assert.equal(contexte.workspaceId, "ws-a");
  assert.equal(contexte.userId, "user-1");
  assert.ok(contexte.permissions.includes("invoice.create"));
});

test("la date d'arrêté est prise AVANT la première lecture", async () => {
  const instants = ["2026-09-03T08:00:00.000Z", "2026-09-03T09:00:00.000Z"];
  let index = 0;
  const { port } = lecteur({ ai_billing_candidates: {} });

  const contexte = await new AgentContextBuilder(port, {
    maintenant: () => new Date(instants[Math.min(index++, instants.length - 1)]),
  }).construire({ agent: "billing", identite: identite() });

  assert.equal(
    contexte.dateArreteDonnees,
    instants[0],
    "une date posée à la fin daterait la réponse, pas les données",
  );
});

test("un plan qui nomme un outil inexistant lève, au lieu de rendre un contexte vide", async () => {
  const { port } = lecteur({});
  // Registre vide : le plan de `billing` nomme alors un outil absent.
  // En silence, l'agent répondrait « je n'ai rien trouvé » — une
  // faute de programmation déguisée en donnée manquante.
  const builderCasse = new AgentContextBuilder(port, {
    registre: new OasisAIToolRegistry([]),
  });
  await assert.rejects(
    () => builderCasse.construire({ agent: "billing", identite: identite() }),
    /n'existe pas dans le registre/,
  );
});

test("seuls les agents réellement construits ont un plan", () => {
  assert.deepEqual([...AGENTS_AVEC_PLAN].sort(), ["billing", "executive", "finance", "quotePricing"]);
});

// ==================================================================
// 9. AUCUN SPÉCIALISTE NE PART VIDE DANS UN BRIEF
// ==================================================================

/**
 * `/api/oasis-ai/brief` n'envoie AUCUNE cible : la Direction demande
 * « que dois-je faire aujourd'hui ? », pas « analyse ce devis ». Un
 * spécialiste dont toutes les sources requises dépendent d'un
 * identifiant ressort donc vide, et `OasisAgentRunner` refuse avant
 * même d'appeler le modèle — la Direction reçoit « rien à dire » et en
 * conclut, à tort, à l'absence de sujet.
 *
 * C'est arrivé : le plan de `quotePricing` n'avait que `getQuote` en
 * source requise. Ce test relit les TROIS spécialistes avec la cible
 * réellement fournie par `/brief` — c'est-à-dire aucune — et échoue si
 * l'un d'eux ressort vide.
 */
test("les trois spécialistes ont de quoi répondre SANS cible, comme dans /brief", async () => {
  const { port } = lecteur({
    ai_finance_snapshot: { caEncaisseTtcCents: 120_000 },
    ai_finance_margin_breakdown: { lignes: [] },
    ai_analyze_project_margin: { chantiers: [] },
    ai_billing_candidates: { dossiers: [] },
    ai_get_daily_priorities: { devisARelancer: [], devisQuiExpirent: [] },
    ai_executive_brief: { actionsPrioritaires: [] },
  });
  const builder = new AgentContextBuilder(port);

  for (const agent of ["finance", "billing", "quotePricing"] as const) {
    // Pas de `cible` du tout : exactement ce que `/brief` passe.
    const contexte = await builder.construire({ agent, identite: identite() });
    assert.equal(
      contexte.vide,
      false,
      `« ${agent} » ressort vide sans cible : il rapportera « rien à dire » à chaque brief`,
    );
  }
});
