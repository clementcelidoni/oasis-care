import { test } from "node:test";
import assert from "node:assert/strict";

import { RATIO_CIBLE, debutDuMoisParis, repartirParNiveau } from "../runtime/cost.ts";
import { AIModelRouter } from "../model/router.ts";
import { agregerAppels, debutDuJourParis, type AppelIA } from "./agregation.ts";

/**
 * §11V — LE TABLEAU DE BORD DES COÛTS, ÉPROUVÉ SANS BASE.
 *
 * Ce que ces tests défendent, dans l'ordre d'importance :
 *
 *   1. UN APPEL SANS TARIF NE VAUT PAS ZÉRO. C'est la règle 2 de la
 *      migration 0076, portée jusqu'à l'écran.
 *   2. LE JOUR EST CELUI DE PARIS, comme celui de
 *      `ai_cost_budget_remaining`. Deux chiffres proches et discordants
 *      coûtent plus cher qu'un seul franchement faux.
 *   3. UNE LECTURE TRONQUÉE SE DÉCLARE TRONQUÉE.
 */

const BASE: AppelIA = {
  agent: "finance",
  modele: "m-standard",
  coutCents: 100,
  jetonsEntree: 1000,
  jetonsSortie: 200,
  dureeMs: 900,
  succes: true,
  motifPanne: null,
  decisionId: null,
  utilisateurId: "u1",
  quand: "2026-09-15T10:00:00.000Z",
};

const MAINTENANT = new Date("2026-09-15T14:00:00.000Z");

function appel(patch: Partial<AppelIA>): AppelIA {
  return { ...BASE, ...patch };
}

// ==================================================================
// 1. Ce qu'on sait, et ce qu'on ignore
// ==================================================================

test("le mois additionne ce qui est connu et compte à part ce qui ne l'est pas", () => {
  const t = agregerAppels(
    [appel({ coutCents: 250 }), appel({ coutCents: null }), appel({ coutCents: 50 })],
    { maintenant: MAINTENANT },
  );

  assert.equal(t.mois.centsConnus, 300);
  assert.equal(t.mois.appelsSansTarif, 1);
  assert.equal(t.mois.appels, 3);
});

test("aucun tarif renseigné : zéro connu sur trois appels, et le compteur le dit", () => {
  // C'est l'état RÉEL du produit tant que les variables
  // `OASIS_AI_TARIF_*` ne sont pas posées. L'écran doit écrire « au
  // moins 0,00 € — 3 appels sans tarif connu », jamais « 0,00 € ».
  const t = agregerAppels([appel({ coutCents: null }), appel({ coutCents: null }), appel({ coutCents: null })], {
    maintenant: MAINTENANT,
  });
  assert.equal(t.mois.centsConnus, 0);
  assert.equal(t.mois.appelsSansTarif, 3);
});

test("aucun appel du tout : un tableau vide, pas un tableau faux", () => {
  const t = agregerAppels([], { maintenant: MAINTENANT });
  assert.equal(t.mois.appels, 0);
  assert.equal(t.jour.appels, 0);
  assert.deepEqual(t.parAgent, []);
  assert.equal(t.moyenneParDecisionCents, null);
  assert.equal(t.latenceMoyenneMs, null, "aucune latence à moyenner : un tiret, pas un zéro");
  assert.equal(t.complet, true);
});

// ==================================================================
// 2. Le jour parisien
// ==================================================================

test("le jour se compte depuis minuit à Paris, pas depuis minuit UTC", () => {
  // En septembre, Paris est à UTC+2 : minuit du 15 à Paris, c'est
  // 22 h UTC le 14. Un appel passé à 23 h UTC le 14 appartient donc au
  // 15 parisien — c'est ce que `ai_cost_budget_remaining` compte, et
  // l'écran doit compter pareil.
  const t = agregerAppels(
    [
      appel({ quand: "2026-09-14T23:30:00.000Z", coutCents: 700 }),
      appel({ quand: "2026-09-14T21:00:00.000Z", coutCents: 900 }),
    ],
    { maintenant: MAINTENANT },
  );

  assert.equal(t.jour.centsConnus, 700, "seul l'appel de 1 h 30 du matin heure de Paris");
  assert.equal(t.mois.centsConnus, 1600, "les deux sont dans le mois");
});

test("minuit parisien tombe bien deux heures avant minuit UTC en été, une en hiver", () => {
  const ete = debutDuJourParis(new Date("2026-07-15T12:00:00.000Z"));
  assert.equal(ete.toISOString(), "2026-07-14T22:00:00.000Z");

  const hiver = debutDuJourParis(new Date("2026-01-15T12:00:00.000Z"));
  assert.equal(hiver.toISOString(), "2026-01-14T23:00:00.000Z");
});

test("le jour du changement d'heure ne perd ni ne double une heure", () => {
  // 2026 : passage à l'heure d'été le 29 mars, retour le 25 octobre.
  const printemps = debutDuJourParis(new Date("2026-03-29T12:00:00.000Z"));
  assert.equal(printemps.toISOString(), "2026-03-28T23:00:00.000Z");

  const automne = debutDuJourParis(new Date("2026-10-25T12:00:00.000Z"));
  assert.equal(automne.toISOString(), "2026-10-24T22:00:00.000Z");
});

test("le jour et le mois de l'écran s'alignent sur la même frontière que la base", () => {
  // Le 1ᵉʳ du mois, le début du jour et le début du mois doivent
  // coïncider. S'ils divergeaient, « aujourd'hui » pourrait dépasser
  // « ce mois-ci » pendant deux heures chaque 1ᵉʳ.
  const premier = new Date("2026-09-01T09:00:00.000Z");
  assert.equal(
    debutDuJourParis(premier).toISOString(),
    debutDuMoisParis(premier).toISOString(),
  );
});

test("un horodatage illisible reste dans le mois mais sort du jour", () => {
  const t = agregerAppels([appel({ quand: "pas une date", coutCents: 400 })], {
    maintenant: MAINTENANT,
  });
  assert.equal(t.mois.centsConnus, 400);
  assert.equal(
    t.jour.centsConnus,
    0,
    "on ne gonfle pas le chiffre du jour avec une ligne dont on ignore la date",
  );
});

// ==================================================================
// 3. Les ventilations
// ==================================================================

test("la ventilation par agent classe le plus cher en tête", () => {
  const t = agregerAppels(
    [
      appel({ agent: "billing", coutCents: 50 }),
      appel({ agent: "executive", coutCents: 900 }),
      appel({ agent: "billing", coutCents: 60 }),
    ],
    { maintenant: MAINTENANT },
  );

  assert.deepEqual(
    t.parAgent.map((l) => l.cle),
    ["executive", "billing"],
  );
  assert.equal(t.parAgent[1].depense.appels, 2);
});

test("sans tarif, la ventilation classe par nombre d'appels plutôt que par rien", () => {
  const t = agregerAppels(
    [
      appel({ agent: "billing", coutCents: null }),
      appel({ agent: "executive", coutCents: null }),
      appel({ agent: "billing", coutCents: null }),
    ],
    { maintenant: MAINTENANT },
  );
  assert.deepEqual(
    t.parAgent.map((l) => l.cle),
    ["billing", "executive"],
    "toutes les dépenses valent zéro : le volume reste la seule information",
  );
});

test("le coût par décision ne compte que les appels rattachés à une décision", () => {
  const t = agregerAppels(
    [
      appel({ decisionId: "d1", coutCents: 300 }),
      appel({ decisionId: "d1", coutCents: 100 }),
      appel({ decisionId: "d2", coutCents: 200 }),
      appel({ decisionId: null, coutCents: 5000 }),
    ],
    { maintenant: MAINTENANT },
  );

  assert.equal(t.decisionsDistinctes, 2);
  assert.equal(t.depenseRattachee.centsConnus, 600);
  assert.equal(t.moyenneParDecisionCents, 300);
  assert.equal(
    t.mois.centsConnus,
    5600,
    "la conversation libre coûte aussi, et reste dans le total du mois",
  );
});

test("un appel sans auteur est compté, sous une clé vide", () => {
  // `user_id` est `on delete set null` : le départ d'un salarié efface
  // la personne, pas la dépense.
  const t = agregerAppels(
    [appel({ utilisateurId: null, coutCents: 400 }), appel({ utilisateurId: "u1", coutCents: 100 })],
    { maintenant: MAINTENANT },
  );
  assert.equal(t.utilisateursDistincts, 2);
  assert.equal(t.parUtilisateur[0].cle, "");
  assert.equal(t.parUtilisateur[0].depense.centsConnus, 400);
});

// ==================================================================
// 4. Les échecs, et le ratio
// ==================================================================

test("un refus pour plafond est un échec compté, pas une absence d'activité", () => {
  const t = agregerAppels(
    [
      appel({ succes: false, motifPanne: "budget_exceeded", coutCents: 0 }),
      appel({ succes: false, motifPanne: "timeout", coutCents: null }),
      appel({ succes: false, motifPanne: "budget_exceeded", coutCents: 0 }),
      appel({}),
    ],
    { maintenant: MAINTENANT },
  );

  assert.equal(t.appelsEnEchec, 3);
  assert.deepEqual(t.pannes[0], { motif: "budget_exceeded", appels: 2 });
  assert.equal(t.mois.appels, 4, "un plafond qui coupe tout un après-midi doit se voir");
});

test("un échec sans motif est rangé sous « inconnu », pas ignoré", () => {
  const t = agregerAppels([appel({ succes: false, motifPanne: null })], {
    maintenant: MAINTENANT,
  });
  assert.deepEqual(t.pannes, [{ motif: "inconnu", appels: 1 }]);
});

test("la ventilation par modèle alimente le ratio Luna / Terra / Sol de la page 17", () => {
  const routeur = new AIModelRouter({ env: {} });
  const modeles = routeur.modelesConfigures();

  const t = agregerAppels(
    [
      ...Array.from({ length: 15 }, () => appel({ modele: modeles.economy })),
      ...Array.from({ length: 80 }, () => appel({ modele: modeles.standard })),
      ...Array.from({ length: 5 }, () => appel({ modele: modeles.advanced })),
    ],
    { maintenant: MAINTENANT },
  );

  const ratio = repartirParNiveau(t.parModele, modeles, t.complet);
  assert.deepEqual(ratio.parNiveau, RATIO_CIBLE, "la cible exacte de la page 17");
  assert.deepEqual(ratio.ecartCible, { economy: 0, standard: 0, advanced: 0 });
  assert.equal(ratio.appelsNiveauInconnu, 0);
});

test("un modèle hors configuration n'est pas rangé d'office sur « standard »", () => {
  const modeles = new AIModelRouter({ env: {} }).modelesConfigures();
  const t = agregerAppels(
    [appel({ modele: modeles.standard }), appel({ modele: "modele-oublie" })],
    { maintenant: MAINTENANT },
  );

  const ratio = repartirParNiveau(t.parModele, modeles, t.complet);
  assert.equal(ratio.appelsNiveauInconnu, 1);
  assert.deepEqual(ratio.modelesInconnus, ["modele-oublie"]);
});

test("un coût inconnu contamine le total d'un modèle, contrairement à la dépense d'écran", () => {
  // Les deux règles cohabitent volontairement : `parModele` alimente
  // `repartirParNiveau`, dont le contrat est qu'un terme inconnu rend la
  // somme inconnue. `Depense`, elle, garde le connu et compte l'inconnu
  // à côté, parce qu'un écran vide serait pire.
  const t = agregerAppels(
    [appel({ modele: "m", coutCents: 100 }), appel({ modele: "m", coutCents: null })],
    { maintenant: MAINTENANT },
  );

  assert.equal(t.parModele[0].coutCents, null);
  assert.equal(t.mois.centsConnus, 100);
  assert.equal(t.mois.appelsSansTarif, 1);
});

// ==================================================================
// 5. La lecture tronquée
// ==================================================================

test("une lecture tronquée se déclare tronquée jusqu'à l'écran", () => {
  const t = agregerAppels([appel({})], { maintenant: MAINTENANT, complet: false });
  assert.equal(t.complet, false);

  const ratio = repartirParNiveau(t.parModele, new AIModelRouter({ env: {} }).modelesConfigures(), t.complet);
  assert.equal(ratio.complet, false, "le drapeau doit traverser jusqu'au ratio");
});

test("les jetons et la latence sont agrégés", () => {
  const t = agregerAppels(
    [appel({ jetonsEntree: 100, jetonsSortie: 10, dureeMs: 1000 }), appel({ jetonsEntree: 300, jetonsSortie: 30, dureeMs: 2000 })],
    { maintenant: MAINTENANT },
  );
  assert.equal(t.jetonsEntree, 400);
  assert.equal(t.jetonsSortie, 40);
  assert.equal(t.latenceMoyenneMs, 1500);
});
