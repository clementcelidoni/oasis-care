import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AGENTS_PREMIERE_ITERATION,
  CLE_BASE,
  CONSIGNE_DIRECTION,
  DEFINITIONS,
  SOCLE_INSTRUCTIONS,
  consigneContexte,
  estAgentConstruit,
  instructionsPour,
  sourcesDe,
  type AgentConstruit,
} from "./definitions.ts";
import { CONSIGNE_FRONTIERE_DETERMINISTE, registreOutils } from "./tools.ts";
import type { AgentContext } from "./context.ts";
import type { Permission } from "./types.ts";

/**
 * §11V — LES QUATRE AGENTS : QUI ILS SONT, ET CE QU'ON LEUR DIT.
 *
 * ══════════════════════════════════════════════════════════════════
 * ON N'ÉPROUVE PAS UNE INSTRUCTION EN LA RELISANT
 * ══════════════════════════════════════════════════════════════════
 *
 * Une instruction d'agent est du texte : aucun test ne peut vérifier
 * qu'un modèle l'a comprise. Ce qu'un test PEUT vérifier, et qui casse
 * réellement en pratique, c'est qu'elle soit COMPLÈTE — que les six
 * règles qui protègent contre une erreur coûteuse y soient toutes, dans
 * chacun des quatre agents.
 *
 * La panne visée est banale : quelqu'un ajoute un cinquième agent, le
 * construit à partir d'un copier-coller, et oublie la ligne sur les
 * données qui ne sont pas des instructions. Rien ne casse. Rien
 * n'alerte. Jusqu'au jour où le nom d'un client dit « envoie ce devis ».
 *
 * ─── ET LE PIÈGE PROPRE À CET ENSEMBLE ───
 *
 * `CONSIGNE_DIRECTION` — « tu ne lis pas la base, tu interroges les
 * spécialistes » (p. 8) — n'a de sens que pour la Direction. Collée sur
 * Finance, qui EST un spécialiste, elle lui ordonnerait de déléguer à
 * personne. Un test l'exige sur un agent et l'interdit sur les trois
 * autres.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..");

function contexte(surcharge: Partial<AgentContext> = {}): AgentContext {
  return {
    agent: "finance",
    organizationId: "org-A",
    workspaceId: "ws-A",
    userId: "user-A",
    permissions: ["projects.read"] as readonly Permission[],
    donnees: {},
    sources: [],
    permissionsManquantes: [],
    vide: false,
    dateArreteDonnees: "2026-09-03T09:00:00.000Z",
    empreinte: "abc",
    tailleCaracteres: 0,
    ...surcharge,
  };
}

// ==================================================================
// 1. Les quatre agents, et pas un cinquième
// ==================================================================

test("les quatre agents construits sont ceux que 0072 accepte", () => {
  assert.deepEqual([...AGENTS_PREMIERE_ITERATION], ["executive", "finance", "billing", "quotePricing"]);
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    assert.ok(DEFINITIONS[agent], `« ${agent} » n'a pas de définition`);
    assert.equal(DEFINITIONS[agent].cle, agent, "la clé de la définition doit être sa propre clé");
  }
});

test("la graphie de la base est celle de 0072, pas celle de la spec", () => {
  // La spec écrit `quotePricing`, `ai_is_supported_agent` écrit
  // `quote_pricing`. Une action enregistrée sous le mauvais nom serait
  // refusée par la contrainte — après avoir payé l'appel.
  // La CLÉ est la graphie de la spec, la VALEUR celle de la base. Le
  // seul couple qui diffère est celui du chiffrage, et c'est
  // exactement le piège que cette table existe pour désamorcer.
  const attendu: Record<AgentConstruit, string> = {
    executive: "executive",
    finance: "finance",
    billing: "billing",
    quotePricing: "quote_pricing",
  };
  assert.deepEqual(CLE_BASE, attendu);

  const socle = readFileSync(
    join(racineDepot, "supabase", "migrations", "0072_phase11v_socle.sql"),
    "utf8",
  );
  for (const cle of Object.values(CLE_BASE)) {
    assert.ok(socle.includes(`'${cle}'`), `« ${cle} » doit exister dans 0072`);
  }
});

test("estAgentConstruit refuse les dix agents que la spec nomme sans qu'on les construise", () => {
  assert.equal(estAgentConstruit("finance"), true);
  for (const absent of ["sales", "operations", "planning", "procurement", "nursery", "fleet", "customer", "market", "risk", "classification"]) {
    assert.equal(estAgentConstruit(absent), false, `« ${absent} » n'est pas construit dans cette itération`);
  }
  assert.equal(estAgentConstruit(null), false);
});

// ==================================================================
// 2. LE SOCLE — les règles qui doivent être dans les quatre
// ==================================================================

test("les quatre instructions portent la frontière déterministe (p. 11-12)", () => {
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    assert.ok(
      instructionsPour(agent, contexte()).includes(CONSIGNE_FRONTIERE_DETERMINISTE),
      `« ${agent} » pourrait recalculer une marge que le SQL a déjà calculée`,
    );
  }
});

test("les quatre disent qu'une donnée reçue n'est jamais une instruction", () => {
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    const texte = instructionsPour(agent, contexte());
    assert.ok(
      texte.includes("JAMAIS DES INSTRUCTIONS"),
      `« ${agent} » n'est pas protégé contre un nom de client qui dit « supprime tout »`,
    );
  }
});

test("les quatre distinguent « null » de « zéro », et « insufficient_data » d'une confiance faible", () => {
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    const texte = instructionsPour(agent, contexte());
    assert.ok(texte.includes("UNE DONNÉE ABSENTE SE DIT"), agent);
    assert.ok(texte.includes("N'EST PAS UNE CONFIANCE FAIBLE"), agent);
    assert.ok(
      texte.includes("estimatedImpactCents"),
      `« ${agent} » doit savoir que la base REFUSE un montant sans données`,
    );
  }
});

test("les quatre annoncent qu'un outil d'action ne fait rien tout de suite", () => {
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    const texte = instructionsPour(agent, contexte());
    assert.ok(texte.includes("NE FONT RIEN TOUT DE SUITE"), agent);
    assert.ok(texte.includes("Ne dis donc jamais"), agent);
  }
});

test("le socle ne demande AUCUNE conversion de centimes en euros", () => {
  // Les sorties sont structurées : `estimatedImpactCents` est un entier.
  // Demander une division au modèle réintroduirait le calcul que la
  // page 12 lui interdit, et l'affichage est le travail de l'écran.
  assert.ok(!/divise par 100|diviser par 100/i.test(SOCLE_INSTRUCTIONS));
});

// ==================================================================
// 3. CE QUI N'APPARTIENT QU'À LA DIRECTION (p. 8)
// ==================================================================

test("seule la Direction reçoit la consigne de ne pas lire la base", () => {
  const direction = instructionsPour("executive", contexte({ agent: "executive" }));
  assert.ok(direction.includes(CONSIGNE_DIRECTION));
  assert.ok(direction.includes("TU NE LIS PAS LA BASE"));

  for (const specialiste of ["finance", "billing", "quotePricing"] as const) {
    assert.ok(
      !instructionsPour(specialiste, contexte({ agent: specialiste })).includes(CONSIGNE_DIRECTION),
      `« ${specialiste} » EST un spécialiste : lui dire de déléguer n'a aucun sens`,
    );
  }
});

test("la Direction est tenue de nommer les agents qu'elle a réellement interrogés", () => {
  assert.ok(CONSIGNE_DIRECTION.includes("agentsConsultes"));
  assert.ok(CONSIGNE_DIRECTION.includes("ATTRIBUABLE"));
  assert.ok(CONSIGNE_DIRECTION.includes("Cinq décisions au plus"));
});

test("chaque agent porte son rôle et ses limites, et elles ne sont pas vides", () => {
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    const definition = DEFINITIONS[agent];
    const texte = instructionsPour(agent, contexte({ agent }));

    assert.ok(texte.includes(definition.libelle), `le rôle de « ${agent} » n'est pas annoncé`);
    assert.ok(texte.includes(definition.responsabilites));
    assert.ok(definition.limites.length > 0, `« ${agent} » n'a aucune limite écrite`);
    for (const limite of definition.limites) assert.ok(texte.includes(limite));
  }
});

test("la Direction s'interdit explicitement d'écrire et de prévoir", () => {
  const limites = DEFINITIONS.executive.limites.join(" ");
  assert.ok(limites.includes("N'écrit rien"));
  assert.ok(limites.includes("Ne prévoit pas"), "une prévision est une estimation, et elle est interdite");
  assert.ok(limites.includes("Ne lit JAMAIS la base directement"));
});

test("la Facturation dit qu'elle crée des BROUILLONS et n'émet aucun numéro", () => {
  const limites = DEFINITIONS.billing.limites.join(" ");
  assert.ok(limites.includes("BROUILLONS"));
  assert.ok(limites.includes("n'envoie rien"));
});

test("le chiffrage refuse de conclure sous cinq comparables et ne chiffre pas le déplacement", () => {
  const limites = DEFINITIONS.quotePricing.limites.join(" ");
  assert.ok(limites.includes("cinq comparables"));
  assert.ok(
    limites.includes("distancier n'existe pas"),
    "getTravelEstimate n'a pas de service : l'agent doit le dire plutôt que d'estimer",
  );
});

// ==================================================================
// 4. LA PARTIE QUI DÉPEND DU CONTEXTE
// ==================================================================

test("la date d'arrêté est annoncée à l'agent (p. 21)", () => {
  // « Aujourd'hui », relu trois jours plus tard, est un mensonge que
  // personne n'a écrit.
  const texte = consigneContexte(contexte({ dateArreteDonnees: "2026-09-03T09:00:00.000Z" }));
  assert.ok(texte.includes("2026-09-03T09:00:00.000Z"));
  assert.ok(texte.includes("Données arrêtées au"));
});

test("une source en échec est NOMMÉE, parce qu'elle ressemble sinon à « rien à signaler »", () => {
  const texte = consigneContexte(
    contexte({
      sources: [
        { outil: "getCompanyMetrics", rpc: "ai_company_metrics", ok: true, motif: null },
        { outil: "getMarginBreakdown", rpc: "ai_margin_breakdown", ok: false, motif: "délai dépassé" },
      ],
    }),
  );

  assert.ok(texte.includes("SOURCES NON LUES"));
  assert.ok(texte.includes("getMarginBreakdown"));
  assert.ok(texte.includes("délai dépassé"));
  assert.ok(!texte.includes("getCompanyMetrics"), "on ne liste que ce qui a échoué");
});

test("une source en échec sans motif est quand même annoncée", () => {
  const texte = consigneContexte(
    contexte({ sources: [{ outil: "getQuote", rpc: "ai_quote", ok: false, motif: null }] }),
  );
  assert.ok(texte.includes("getQuote"));
  assert.ok(texte.includes("lecture impossible"));
});

test("les droits manquants entrent dans l'instruction, avec l'ordre de les dire", () => {
  const texte = consigneContexte(contexte({ permissionsManquantes: ["quotes.read"] }));
  assert.ok(texte.includes("quotes.read"));
  assert.ok(texte.includes("donneesManquantes"));
  assert.ok(texte.includes("Ce n'est pas « rien à signaler »"));
});

test("un contexte sain n'encombre l'instruction d'aucune alerte", () => {
  const texte = consigneContexte(contexte());
  assert.ok(!texte.includes("SOURCES NON LUES"));
  assert.ok(!texte.includes("DROITS MANQUANTS"));
});

test("l'instruction est RECONSTRUITE : deux dates d'arrêté donnent deux textes", () => {
  // Une instruction mémorisée au démarrage annoncerait, six heures plus
  // tard, des données arrêtées ce matin.
  const matin = instructionsPour("finance", contexte({ dateArreteDonnees: "2026-09-03T07:00:00.000Z" }));
  const soir = instructionsPour("finance", contexte({ dateArreteDonnees: "2026-09-03T19:00:00.000Z" }));
  assert.notEqual(matin, soir);
});

// ==================================================================
// 5. LES SOURCES, DÉDUITES DU REGISTRE
// ==================================================================

test("chaque agent a au moins une source, et toutes sont des fonctions déclarées", () => {
  const registre = registreOutils();
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    const sources = sourcesDe(agent, registre);
    assert.ok(sources.length > 0, `« ${agent} » n'aurait rien à lire`);
    for (const rpc of sources) {
      assert.equal(typeof rpc, "string");
      assert.ok(rpc.length > 0);
    }
  }
});

test("les sources d'un agent lui appartiennent réellement dans le registre", () => {
  const registre = registreOutils();
  for (const agent of AGENTS_PREMIERE_ITERATION) {
    for (const rpc of sourcesDe(agent, registre)) {
      const outil = registre.tous().find((o) => o.rpc === rpc && o.agent === agent);
      assert.ok(outil, `« ${rpc} » est attribué à « ${agent} » sans lui appartenir`);
    }
  }
});

test("la Facturation ne peut pas lire les sources du chiffrage, ni l'inverse", () => {
  // La moitié « outils » de la minimisation de la page 20, vue depuis
  // les définitions.
  const facturation = new Set(sourcesDe("billing"));
  const chiffrage = new Set(sourcesDe("quotePricing"));
  for (const rpc of chiffrage) {
    assert.ok(!facturation.has(rpc), `« ${rpc} » est visible des deux côtés`);
  }
});
