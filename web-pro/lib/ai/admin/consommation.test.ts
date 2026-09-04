import { test } from "node:test";
import assert from "node:assert/strict";

import { agregerConsommation, debutDuJourParis, type AppelIA } from "./consommation.ts";

/**
 * §11X — CE QUE LA CONSOMMATION DOIT GARANTIR, ÉPROUVÉ SANS BASE.
 *
 * Ce fichier remplace `agregation.test.ts`. Deux de ses trois défenses
 * survivent — le jour parisien, la lecture tronquée — et la première a
 * disparu avec ce qu'elle protégeait : « un appel sans tarif ne vaut pas
 * zéro » n'a plus de sens ici, puisqu'aucun tarif n'est lu.
 *
 * Ce qui la remplace est d'un autre ordre, et c'est le fond du
 * déménagement : ce module compte des APPELS et des JETONS. Un appel est
 * toujours connu — c'est même la seule chose qui le soit toujours — donc
 * aucun compteur de cet écran ne peut être un minorant silencieux. Le
 * risque a changé de nature : il n'est plus de sous-estimer une dépense,
 * il est de laisser un euro ou un nom de modèle revenir par une porte
 * dérobée. C'est `types.test.ts` qui monte cette garde-là.
 *
 * Restent donc ici les trois défenses de calcul :
 *
 *   1. LE JOUR EST CELUI DE PARIS, comme celui de la base. Deux chiffres
 *      proches et discordants coûtent plus cher qu'un seul franchement
 *      faux.
 *   2. UNE LECTURE TRONQUÉE SE DÉCLARE TRONQUÉE.
 *   3. UN VIDE EST UN VIDE, ET NON UNE MOYENNE À ZÉRO.
 */

const BASE: AppelIA = {
  agent: "finance",
  jetonsEntree: 1000,
  jetonsSortie: 200,
  dureeMs: 900,
  succes: true,
  motifPanne: null,
  decisionId: null,
  utilisateurId: "u1",
  quand: "2026-07-15T10:00:00.000Z",
};

const MAINTENANT = new Date("2026-07-15T12:00:00.000Z");

function appel(surcharge: Partial<AppelIA> = {}): AppelIA {
  return { ...BASE, ...surcharge };
}

// ==================================================================
// 1. Les volumes
// ==================================================================

test("les appels et les jetons s'additionnent sur le mois", () => {
  const tableau = agregerConsommation(
    [appel(), appel({ jetonsEntree: 500, jetonsSortie: 50 })],
    { maintenant: MAINTENANT },
  );

  assert.equal(tableau.mois.appels, 2);
  assert.equal(tableau.mois.jetonsEntree, 1500);
  assert.equal(tableau.mois.jetonsSortie, 250);
});

test("un mois vide ne rend ni zéro trompeur ni moyenne", () => {
  const tableau = agregerConsommation([], { maintenant: MAINTENANT });

  assert.equal(tableau.mois.appels, 0);
  assert.deepEqual(tableau.parAgent, []);
  assert.equal(tableau.decisionsDistinctes, 0);
  assert.equal(tableau.utilisateursDistincts, 0);
  // `null` et non 0 : « aucun appel à mesurer » n'est pas « des appels
  // instantanés », et la carte affiche un tiret pour le premier.
  assert.equal(tableau.latenceMoyenneMs, null);
  assert.equal(tableau.complet, true);
});

test("une lecture tronquée se déclare tronquée", () => {
  const tableau = agregerConsommation([appel()], { maintenant: MAINTENANT, complet: false });
  assert.equal(tableau.complet, false);

  // Y compris quand il n'y a rien à agréger : une lecture bornée qui
  // rend zéro ligne reste une lecture bornée.
  const vide = agregerConsommation([], { maintenant: MAINTENANT, complet: false });
  assert.equal(vide.complet, false);
});

// ==================================================================
// 2. Le jour parisien
// ==================================================================

test("le jour commence à minuit heure de Paris, été comme hiver", () => {
  // Été : Paris est à UTC+2, donc minuit local vaut 22 h la veille en UTC.
  assert.equal(
    debutDuJourParis(new Date("2026-07-15T12:00:00.000Z")).toISOString(),
    "2026-07-14T22:00:00.000Z",
  );
  // Hiver : UTC+1.
  assert.equal(
    debutDuJourParis(new Date("2026-01-15T12:00:00.000Z")).toISOString(),
    "2026-01-14T23:00:00.000Z",
  );
});

test("un appel passé après 22 h UTC en été compte pour le jour suivant", () => {
  // 2026-07-15T22:30Z, c'est le 16 juillet à 00 h 30 à Paris. Compter à
  // partir de minuit UTC rangerait cet appel dans le 15, c'est-à-dire
  // dans un autre jour que celui dont la base parle.
  const minuitPasse = new Date("2026-07-15T22:30:00.000Z");
  const tableau = agregerConsommation(
    [
      appel({ quand: "2026-07-15T21:00:00.000Z" }), // 23 h, la veille à Paris
      appel({ quand: "2026-07-15T22:30:00.000Z" }), // 00 h 30, aujourd'hui
    ],
    { maintenant: minuitPasse },
  );

  assert.equal(tableau.mois.appels, 2);
  assert.equal(tableau.jour.appels, 1);
});

test("un horodatage illisible sort du jour mais reste dans le mois", () => {
  // `Date.parse` rend NaN, et `NaN >= x` est faux. C'est le bon sens de
  // l'erreur : on ne gonfle pas le chiffre du jour avec une ligne dont
  // on ignore quand elle a eu lieu.
  const tableau = agregerConsommation([appel({ quand: "pas une date" })], {
    maintenant: MAINTENANT,
  });

  assert.equal(tableau.mois.appels, 1);
  assert.equal(tableau.jour.appels, 0);
});

// ==================================================================
// 3. Les ventilations
// ==================================================================

test("la ventilation par agent classe le plus sollicité en tête", () => {
  const tableau = agregerConsommation(
    [
      appel({ agent: "billing" }),
      appel({ agent: "finance" }),
      appel({ agent: "finance" }),
      appel({ agent: "finance" }),
    ],
    { maintenant: MAINTENANT },
  );

  assert.deepEqual(
    tableau.parAgent.map((l) => l.cle),
    ["finance", "billing"],
  );
  assert.equal(tableau.parAgent[0].volume.appels, 3);
});

test("à égalité d'appels, les jetons départagent", () => {
  // Dix questions courtes et dix analyses de trois pages ne sont pas le
  // même usage ; sans ce second critère, le classement serait celui de
  // l'ordre d'insertion, c'est-à-dire aucun.
  const tableau = agregerConsommation(
    [
      appel({ agent: "billing", jetonsEntree: 10, jetonsSortie: 10 }),
      appel({ agent: "finance", jetonsEntree: 5000, jetonsSortie: 5000 }),
    ],
    { maintenant: MAINTENANT },
  );

  assert.deepEqual(
    tableau.parAgent.map((l) => l.cle),
    ["finance", "billing"],
  );
});

test("un appel sans auteur est compté, sous une clé vide", () => {
  // `ai_usage_events.user_id` passe à NULL quand le compte est supprimé
  // (`on delete set null`). Le travail, lui, a bien eu lieu : le perdre
  // ferait un total du mois plus petit que la somme de ses parts.
  const tableau = agregerConsommation(
    [appel({ utilisateurId: null }), appel({ utilisateurId: "u1" })],
    { maintenant: MAINTENANT },
  );

  assert.equal(tableau.mois.appels, 2);
  assert.equal(tableau.utilisateursDistincts, 2);
  assert.ok(tableau.parUtilisateur.some((l) => l.cle === ""));
});

test("seuls les appels rattachés à une décision entrent dans la ventilation par décision", () => {
  const tableau = agregerConsommation(
    [appel({ decisionId: "d1" }), appel({ decisionId: "d1" }), appel({ decisionId: null })],
    { maintenant: MAINTENANT },
  );

  assert.equal(tableau.decisionsDistinctes, 1);
  assert.equal(tableau.parDecision.length, 1);
  assert.equal(tableau.parDecision[0].volume.appels, 2);
  // Le troisième appel n'a pas disparu pour autant.
  assert.equal(tableau.mois.appels, 3);
});

// ==================================================================
// 4. Ce qui n'a pas abouti
// ==================================================================

test("les refus sont groupés par motif, le plus fréquent d'abord", () => {
  const tableau = agregerConsommation(
    [
      appel({ succes: false, motifPanne: "budget_exceeded" }),
      appel({ succes: false, motifPanne: "budget_exceeded" }),
      appel({ succes: false, motifPanne: "timeout" }),
      appel(),
    ],
    { maintenant: MAINTENANT },
  );

  assert.equal(tableau.appelsEnEchec, 3);
  assert.deepEqual(tableau.pannes, [
    { motif: "budget_exceeded", appels: 2 },
    { motif: "timeout", appels: 1 },
  ]);
});

test("un échec sans motif enregistré est compté, pas ignoré", () => {
  // Sinon la somme des motifs serait plus petite que le nombre
  // d'échecs, et l'écart n'aurait aucune explication à l'écran.
  const tableau = agregerConsommation([appel({ succes: false, motifPanne: null })], {
    maintenant: MAINTENANT,
  });

  assert.equal(tableau.appelsEnEchec, 1);
  assert.deepEqual(tableau.pannes, [{ motif: "inconnu", appels: 1 }]);
});

test("un appel en échec compte quand même dans le volume consommé", () => {
  // Les jetons d'entrée sont facturés par le fournisseur même quand la
  // réponse n'arrive pas. Les retirer du compteur ferait croire à une
  // entreprise qu'un après-midi de tentatives n'a rien mobilisé.
  const tableau = agregerConsommation(
    [appel({ succes: false, motifPanne: "timeout", jetonsEntree: 800, jetonsSortie: 0 })],
    { maintenant: MAINTENANT },
  );

  assert.equal(tableau.mois.appels, 1);
  assert.equal(tableau.mois.jetonsEntree, 800);
});
