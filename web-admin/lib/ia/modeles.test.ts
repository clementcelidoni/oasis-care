import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENTS,
  AGENTS_SURCHARGEABLES,
  CIBLE_RATIO,
  CLE_SQL_AGENT,
  MODELES_PAR_DEFAUT,
  NIVEAUX,
  NIVEAU_LIVRE,
  cleAgentDepuisSql,
  lireEtatRouteur,
  variableAgent,
} from "./modeles.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * `modeles.ts` est une COPIE de deux fichiers de `web-pro` :
 * `lib/ai/model/configuration.ts` et `lib/ai/model/router.ts`. Les deux
 * applications sont déployées séparément, sans monorepo à ce dépôt : il
 * n'existe aucun import possible de l'une vers l'autre, donc aucun
 * compilateur pour signaler une divergence.
 *
 * Le risque est précis et silencieux : le jour où quelqu'un déplace un
 * agent dans `web-pro` sans toucher à ce fichier, le Control Center
 * affiche un niveau qui n'est plus celui qui tourne — et l'écran sert
 * précisément à savoir quel modèle tourne.
 *
 * Ces tests ne peuvent pas comparer les deux dépôts. Ils font ce qu'un
 * test peut faire : FIGER la table, pour que la modifier devienne un
 * geste délibéré, visible dans un diff, plutôt qu'un effet de bord.
 */

test("la table agent → niveau est figée, et trois agents seulement sont au niveau le plus cher", () => {
  // Recopiée de web-pro/lib/ai/model/configuration.ts. La spec p.17
  // vise « ~5 % Sol » : un quatrième agent en « advanced » ferait
  // passer ce ratio du simple au double, et c'est une décision, pas un
  // ajustement.
  assert.deepEqual(NIVEAU_LIVRE, {
    executive: "advanced",
    finance: "standard",
    billing: "standard",
    quotePricing: "advanced",
    sales: "standard",
    operations: "standard",
    planning: "standard",
    procurement: "standard",
    nursery: "standard",
    fleet: "standard",
    customer: "standard",
    market: "advanced",
    risk: "standard",
    classification: "economy",
  });

  const avances = AGENTS.filter((agent) => NIVEAU_LIVRE[agent] === "advanced");
  assert.deepEqual(avances, ["executive", "quotePricing", "market"]);
});

test("les trois identifiants par défaut sont ceux de web-pro", () => {
  assert.deepEqual(MODELES_PAR_DEFAUT, {
    economy: "gpt-5.6-luna",
    standard: "gpt-5.6-terra",
    advanced: "gpt-5.6-sol",
  });
});

test("la cible de répartition est celle de la spec p.17, et elle fait 100", () => {
  assert.deepEqual(CIBLE_RATIO, { economy: 15, standard: 80, advanced: 5 });
  const total = NIVEAUX.reduce((somme, niveau) => somme + CIBLE_RATIO[niveau], 0);
  assert.equal(total, 100);
});

/**
 * QUATRE AGENTS SURCHARGEABLES, PAS QUATORZE.
 *
 * `ai_is_supported_agent` (migration 0072) refuse les dix autres avec un
 * 23514. Proposer un sélecteur pour un agent que la base refusera, c'est
 * un formulaire qui échoue au moment de l'enregistrement, après que
 * quelqu'un a rédigé son motif.
 */
test("seuls les quatre agents que la base accepte sont surchargeables", () => {
  assert.deepEqual(AGENTS_SURCHARGEABLES, ["executive", "finance", "billing", "quotePricing"]);
  assert.equal(CLE_SQL_AGENT.quotePricing, "quote_pricing");
  assert.equal(CLE_SQL_AGENT.sales, undefined);
});

test("la graphie de la base et celle de la spec désignent le même agent", () => {
  // La spec écrit `quotePricing`, la base écrit `quote_pricing`. Un
  // écran qui répondrait « agent inconnu » au nom que la base lui donne
  // serait inutilisable.
  assert.equal(cleAgentDepuisSql("quote_pricing"), "quotePricing");
  assert.equal(cleAgentDepuisSql("quotePricing"), "quotePricing");
  assert.equal(cleAgentDepuisSql("  Finance  "), "finance");
  assert.equal(cleAgentDepuisSql("marketing"), null);
  assert.equal(cleAgentDepuisSql(""), null);
  assert.equal(cleAgentDepuisSql(null), null);
});

test("le nom de la variable d'un agent suit le camelCase → SNAKE_CASE", () => {
  assert.equal(variableAgent("quotePricing"), "OASIS_MODEL_AGENT_QUOTE_PRICING");
  assert.equal(variableAgent("finance"), "OASIS_MODEL_AGENT_FINANCE");
});

// ------------------------------------------------------------------
// La lecture de l'environnement
// ------------------------------------------------------------------

test("sans variable, l'état du routeur est exactement celui du produit", () => {
  const etat = lireEtatRouteur({});
  assert.deepEqual(etat.modeles, MODELES_PAR_DEFAUT);
  assert.deepEqual(etat.agents, NIVEAU_LIVRE);
  assert.deepEqual(etat.anomalies, []);
  assert.deepEqual(etat.identifiantsSurcharges, []);
  assert.deepEqual(etat.agentsDeplaces, []);
});

test("une variable lisible déplace, et se signale comme surcharge", () => {
  const etat = lireEtatRouteur({
    OASIS_MODEL_ADVANCED: "gpt-6-sol",
    OASIS_MODEL_AGENT_FINANCE: "advanced",
  });

  assert.equal(etat.modeles.advanced, "gpt-6-sol");
  assert.deepEqual(etat.identifiantsSurcharges, ["advanced"]);
  assert.equal(etat.agents.finance, "advanced");
  assert.deepEqual(etat.agentsDeplaces, ["finance"]);
  assert.deepEqual(etat.anomalies, []);
});

/**
 * LE CŒUR DE CE FICHIER DE TEST.
 *
 * Une valeur d'environnement illisible ne doit JAMAIS être ignorée en
 * silence. Un réglage d'urgence qui n'a pas pris et que personne ne
 * voit, c'est la panne à sept heures du matin avec, en prime, la
 * conviction fausse d'avoir agi. L'écran affiche les anomalies : encore
 * faut-il qu'elles soient produites.
 */
test("une valeur illisible devient une anomalie, jamais un silence", () => {
  const etat = lireEtatRouteur({ OASIS_MODEL_AGENT_FINANCE: "turbo" });

  // Le niveau du produit reste en vigueur : on ne devine pas.
  assert.equal(etat.agents.finance, NIVEAU_LIVRE.finance);
  assert.equal(etat.anomalies.length, 1);
  assert.equal(etat.anomalies[0].variable, "OASIS_MODEL_AGENT_FINANCE");
  assert.equal(etat.anomalies[0].valeur, "turbo");
  assert.match(etat.anomalies[0].raison, /Niveau inconnu/);
});

test("une variable posée puis vidée est signalée, et ne vide pas l'identifiant", () => {
  // Une chaîne vide envoyée au SDK produirait une erreur
  // incompréhensible bien plus loin. On garde le défaut, et on le dit.
  const etat = lireEtatRouteur({ OASIS_MODEL_STANDARD: "   ", OASIS_MODEL_AGENT_BILLING: "" });

  assert.equal(etat.modeles.standard, MODELES_PAR_DEFAUT.standard);
  assert.equal(etat.agents.billing, NIVEAU_LIVRE.billing);
  assert.equal(etat.anomalies.length, 2);
  for (const anomalie of etat.anomalies) assert.match(anomalie.raison, /Valeur vide/);
});

test("un agent replacé sur son niveau d'origine n'est pas compté comme déplacé", () => {
  // Sinon l'écran signalerait un déplacement là où la variable ne fait
  // que répéter le produit — et un badge qui crie pour rien finit par ne
  // plus être lu.
  const etat = lireEtatRouteur({ OASIS_MODEL_AGENT_FINANCE: "standard" });
  assert.deepEqual(etat.agentsDeplaces, []);
  assert.deepEqual(etat.anomalies, []);
});
