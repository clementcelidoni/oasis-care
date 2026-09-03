import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLES_AUTONOMIE,
  LIBELLES_AUTONOMIE,
  NIVEAUX_AUTONOMIE,
  REGLAGE_PAR_DEFAUT,
  estNiveauAutonomie,
  lireNiveauAutonomie,
  lireReglagesAgents,
  motifRefusAction,
  peutAgirSeul,
  peutExecuterApresAccord,
  peutPreparerUneAction,
  peutRecommander,
  type NiveauAutonomie,
  type ReglageAgent,
} from "./autonomy.ts";
import { AGENTS_PREMIERE_ITERATION } from "./definitions.ts";

/**
 * §11V — LE CURSEUR D'AUTONOMIE, ÉPROUVÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI SE JOUE ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * `ai_agent_settings` (0072) est le seul endroit où une entreprise dit
 * jusqu'où ses agents ont le droit d'aller. Deux erreurs sont possibles
 * et elles n'ont pas le même coût :
 *
 *   • lire trop BAS — un agent réglé au niveau 3 qui n'agit plus.
 *     Agaçant, visible, réparable.
 *
 *   • lire trop HAUT — un agent réglé au niveau 1 qui enregistre des
 *     actions. Invisible jusqu'au jour où quelqu'un valide une facture
 *     qu'il n'avait pas demandée.
 *
 * Tous les tests de ce fichier vérifient que la seconde n'arrive jamais,
 * y compris quand la base répond n'importe quoi.
 */

function reglage(niveau: NiveauAutonomie, actif = true): ReglageAgent {
  return { agent: "billing", actif, niveau, parDefaut: false };
}

// ==================================================================
// 1. Les cinq portes
// ==================================================================

test("chaque niveau ouvre exactement les portes que 0072 lui donne", () => {
  const attendu: Record<NiveauAutonomie, [boolean, boolean, boolean, boolean]> = {
    0: [false, false, false, false],
    1: [true, false, false, false],
    2: [true, true, false, false],
    3: [true, true, true, false],
    4: [true, true, true, true],
  };

  for (const niveau of NIVEAUX_AUTONOMIE) {
    const r = reglage(niveau);
    assert.deepEqual(
      [peutRecommander(r), peutPreparerUneAction(r), peutExecuterApresAccord(r), peutAgirSeul(r)],
      attendu[niveau],
      `le niveau ${niveau} n'ouvre pas ce qu'il devrait`,
    );
  }
});

test("un agent éteint ne peut rien, même réglé au niveau 4", () => {
  const eteint = reglage(4, false);
  assert.equal(peutRecommander(eteint), false);
  assert.equal(peutPreparerUneAction(eteint), false);
  assert.equal(peutExecuterApresAccord(eteint), false);
  assert.equal(peutAgirSeul(eteint), false);
});

test("« agir seul » est le niveau 4 EXACTEMENT, pas « au moins 4 »", () => {
  // Écrit `=== 4` dans `autonomy.ts`. Si un niveau 5 apparaissait en
  // base demain, il ne devrait pas hériter de l'autopilote par le seul
  // effet d'une comparaison `>=`.
  assert.equal(peutAgirSeul({ ...reglage(4), niveau: 5 as unknown as NiveauAutonomie }), false);
});

// ==================================================================
// 2. La lecture d'un niveau, quand la base répond mal
// ==================================================================

test("une valeur illisible retombe sur le DÉFAUT, jamais sur 0 ni sur 4", () => {
  for (const valeur of [null, undefined, "", "quatre", NaN, {}, [], true]) {
    assert.equal(
      lireNiveauAutonomie(valeur),
      REGLAGE_PAR_DEFAUT.niveau,
      `« ${String(valeur)} » doit rendre le niveau par défaut`,
    );
  }
  assert.equal(REGLAGE_PAR_DEFAUT.niveau, 1, "le défaut de 0072 est 1 — le niveau qui n'écrit rien");
});

test("un niveau hors bornes ne s'écrête PAS vers le haut", () => {
  // 7 ne devient pas 4. Un écrêtage donnerait l'autopilote à une valeur
  // aberrante ; le défaut, lui, ne donne rien.
  assert.equal(lireNiveauAutonomie(7), 1);
  assert.equal(lireNiveauAutonomie(-3), 1);
});

test("un niveau décimal est tronqué, pas arrondi", () => {
  assert.equal(lireNiveauAutonomie(3.9), 3, "3,9 n'est pas 4 : on ne monte pas par arrondi");
  assert.equal(lireNiveauAutonomie("2"), 2, "PostgREST rend parfois des entiers en texte");
});

test("estNiveauAutonomie refuse tout ce qui n'est pas un des cinq entiers", () => {
  assert.equal(estNiveauAutonomie(0), true);
  assert.equal(estNiveauAutonomie(4), true);
  assert.equal(estNiveauAutonomie(5), false);
  assert.equal(estNiveauAutonomie("2"), false);
  assert.equal(estNiveauAutonomie(2.5), false);
});

// ==================================================================
// 3. Les messages
// ==================================================================

test("le refus nomme l'écran où le réglage vit", () => {
  const message = motifRefusAction(reglage(1), "Facturation");
  assert.ok(message.includes("Facturation"));
  assert.ok(message.includes("niveau d'autonomie 1"));
  assert.ok(message.includes(LIBELLES_AUTONOMIE[1]));
  assert.ok(message.includes("Oasis AI › Agents"), "un refus sans l'écran à ouvrir n'est pas actionnable");
});

test("les cinq niveaux ont une clé et un libellé, et les clés sont celles de 0072", () => {
  assert.deepEqual(Object.values(CLES_AUTONOMIE), [
    "observe",
    "advise",
    "prepare",
    "confirm_to_execute",
    "authorized_autopilot",
  ]);
  for (const niveau of NIVEAUX_AUTONOMIE) {
    assert.ok(LIBELLES_AUTONOMIE[niveau].length > 0);
  }
});

// ==================================================================
// 4. LA LECTURE DE `ai_agent_settings`
// ==================================================================

test("la carte rendue porte exactement les agents demandés, ni plus ni moins", async () => {
  const carte = await lireReglagesAgents(
    "org-A",
    AGENTS_PREMIERE_ITERATION,
    async () => [{ agent: "billing", enabled: true, autonomy_level: 3 }],
  );

  assert.deepEqual(Object.keys(carte).sort(), [...AGENTS_PREMIERE_ITERATION].sort());
  assert.equal(carte.billing.niveau, 3);
  assert.equal(carte.billing.parDefaut, false);
  assert.equal(carte.finance.niveau, 1, "un agent absent de la table reçoit le défaut");
  assert.equal(carte.finance.parDefaut, true, "et le dit, pour que l'écran distingue les deux");
});

test("`quote_pricing` de la base rejoint `quotePricing` de la spec", async () => {
  // Sans cette normalisation, l'agent de chiffrage resterait au niveau
  // 1 quoi que l'entreprise règle — une panne muette, du bon côté par
  // accident, et invisible depuis l'écran.
  const carte = await lireReglagesAgents(
    "org-A",
    AGENTS_PREMIERE_ITERATION,
    async () => [{ agent: "quote_pricing", enabled: true, autonomy_level: 4 }],
  );

  assert.equal(carte.quotePricing.niveau, 4);
  assert.equal(carte.quotePricing.parDefaut, false);
});

test("une ligne pour un agent qu'on n'a pas demandé est ignorée, pas ajoutée", async () => {
  const carte = await lireReglagesAgents(
    "org-A",
    AGENTS_PREMIERE_ITERATION,
    async () => [
      { agent: "fleet", enabled: true, autonomy_level: 4 },
      { agent: "inconnu-du-produit", enabled: true, autonomy_level: 4 },
    ],
  );

  assert.equal(carte.fleet, undefined, "un cinquième agent n'entre pas dans le produit par la base");
  assert.equal(Object.keys(carte).length, AGENTS_PREMIERE_ITERATION.length);
});

test("`enabled: null` ne suffit PAS à éteindre un agent, mais `false` oui", async () => {
  const carte = await lireReglagesAgents(
    "org-A",
    AGENTS_PREMIERE_ITERATION,
    async () => [
      { agent: "billing", enabled: null, autonomy_level: 2 },
      { agent: "finance", enabled: false, autonomy_level: 2 },
    ],
  );

  assert.equal(carte.billing.actif, true, "seul un « false » explicite éteint");
  assert.equal(carte.finance.actif, false);
});

test("une table illisible retombe au niveau 1 pour tous, et le SIGNALE", async () => {
  const dits: string[] = [];
  const carte = await lireReglagesAgents(
    "org-A",
    AGENTS_PREMIERE_ITERATION,
    async () => {
      throw new Error("relation ai_agent_settings does not exist");
    },
    (m) => dits.push(m),
  );

  for (const agent of AGENTS_PREMIERE_ITERATION) {
    assert.equal(carte[agent].niveau, 1);
    assert.equal(carte[agent].parDefaut, true);
    assert.equal(peutPreparerUneAction(carte[agent]), false, "au niveau 1, rien ne s'écrit");
  }

  assert.equal(dits.length, 1, "le silence ferait chercher longtemps une entreprise réglée au niveau 3");
  assert.ok(dits[0].includes("org-A"));
  assert.ok(dits[0].includes("niveau 1"));
});
