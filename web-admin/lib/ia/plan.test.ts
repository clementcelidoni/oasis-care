import test from "node:test";
import assert from "node:assert/strict";

import { lireEtatRouteur } from "./modeles.ts";
import { planifierChangements, raconter } from "./plan.ts";
import type { LigneSurcharge } from "./types.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * `plan.ts` décide ce que le Control Center va écrire chez un client :
 * quel agent bascule sur quel modèle, et lequel revient au défaut du
 * produit. C'est le seul chemin d'écriture de l'aiguillage des modèles,
 * et il n'en avait aucun test.
 *
 * LE DÉFAUT QU'ILS FIGENT. Chaque agent part dans sa propre fonction
 * SQL, donc dans sa propre transaction : rien ne peut annuler les
 * premières écritures quand la troisième échoue. La seule protection
 * possible est de tout lire et tout comprendre AVANT d'écrire la
 * première ligne. La version précédente validait à l'intérieur de la
 * boucle d'écriture, et rendait « aucun changement n'a été enregistré »
 * alors que deux agents venaient de changer ET d'être journalisés. Une
 * Server Action est une URL : un formulaire amputé n'a pas besoin de
 * l'écran pour arriver.
 */

// Un environnement figé : on ne veut pas que le résultat dépende des
// variables du poste qui joue les tests.
const ENV = Object.freeze({});
const ETAT = lireEtatRouteur(ENV);

function surcharge(agent: string, model: string): LigneSurcharge {
  return {
    organization_id: "00000000-0000-4000-8000-000000000000",
    agent,
    model,
    reason: "essai",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    updated_by: null,
  };
}

/** Un formulaire complet, à modifier au cas par cas. */
function formulaire(valeurs: Record<string, unknown>) {
  const complet: Record<string, unknown> = {
    "agent.executive": "produit",
    "agent.finance": "produit",
    "agent.billing": "produit",
    "agent.quote_pricing": "produit",
    ...valeurs,
  };
  return (nom: string) => (nom in complet ? complet[nom] : null);
}

test("un formulaire qui ne change rien ne produit aucun geste", () => {
  const plan = planifierChangements(ETAT, [], formulaire({}));
  assert.equal(plan.statut, "ok");
  assert.equal(plan.statut === "ok" ? plan.changements.length : -1, 0);
});

test("un niveau demandé produit un geste « imposer » avec l'identifiant littéral", () => {
  const plan = planifierChangements(ETAT, [], formulaire({ "agent.finance": "advanced" }));
  assert.equal(plan.statut, "ok");
  if (plan.statut !== "ok") return;
  assert.equal(plan.changements.length, 1);
  const [geste] = plan.changements;
  assert.equal(geste.geste, "imposer");
  assert.equal(geste.cleSql, "finance");
  if (geste.geste !== "imposer") return;
  // L'identifiant, pas le niveau : la base stocke un modèle littéral.
  assert.equal(geste.modele, ETAT.modeles.advanced);
  assert.notEqual(geste.modele, "advanced");
});

test("revenir au produit alors qu'une surcharge existe produit un geste « lever »", () => {
  const plan = planifierChangements(
    ETAT,
    [surcharge("finance", ETAT.modeles.advanced)],
    formulaire({}),
  );
  assert.equal(plan.statut, "ok");
  if (plan.statut !== "ok") return;
  assert.equal(plan.changements.length, 1);
  assert.equal(plan.changements[0].geste, "lever");
  assert.equal(plan.changements[0].cleSql, "finance");
});

test("un agent qui porte déjà le niveau demandé n'est pas réécrit", () => {
  // Réécrire à l'identique ferait une ligne de journal qui n'apprend
  // rien et déplacerait `updated_at` : on perdrait la date du vrai
  // dernier changement.
  const plan = planifierChangements(
    ETAT,
    [surcharge("finance", ETAT.modeles.advanced)],
    formulaire({ "agent.finance": "advanced" }),
  );
  assert.equal(plan.statut, "ok");
  assert.equal(plan.statut === "ok" ? plan.changements.length : -1, 0);
});

test("une surcharge DÉCROCHÉE se laisse toujours reposer sur son niveau apparent", () => {
  // Un identifiant que le routeur ne connaît plus (variable corrigée
  // depuis) : l'écran doit permettre d'en sortir, donc tout choix est
  // un changement — y compris celui qui porte le nom du niveau supposé.
  const plan = planifierChangements(
    ETAT,
    [surcharge("finance", "un-modele-qui-n-existe-plus")],
    formulaire({ "agent.finance": "advanced" }),
  );
  assert.equal(plan.statut, "ok");
  assert.equal(plan.statut === "ok" ? plan.changements.length : -1, 1);
});

test("LE DÉFAUT CORRIGÉ : un champ manquant refuse le plan ENTIER, pas seulement le sien", () => {
  // Deux agents parfaitement valides changent, le troisième champ est
  // absent. Le plan doit être refusé en bloc : si on rendait les deux
  // premiers, ils seraient écrits et journalisés, et l'opérateur lirait
  // ensuite un message d'échec qui ne les nomme pas.
  const lire = (nom: string) => {
    if (nom === "agent.executive") return "economy";
    if (nom === "agent.finance") return "advanced";
    if (nom === "agent.billing") return null; // champ absent du POST
    return "produit";
  };
  const plan = planifierChangements(ETAT, [], lire);
  assert.equal(plan.statut, "erreur");
  if (plan.statut !== "erreur") return;
  assert.match(plan.message, /Facturation|billing/i);
  assert.match(plan.message, /Aucun changement n'a été enregistré/);
});

test("une valeur inventée est refusée comme un champ manquant", () => {
  const plan = planifierChangements(
    ETAT,
    [],
    formulaire({ "agent.finance": "gpt-le-plus-cher" }),
  );
  assert.equal(plan.statut, "erreur");
});

test("les quatre agents surchargeables sont bien les quatre, et pas un de plus", () => {
  const plan = planifierChangements(
    ETAT,
    [],
    formulaire({
      "agent.executive": "advanced",
      "agent.finance": "advanced",
      "agent.billing": "advanced",
      "agent.quote_pricing": "advanced",
    }),
  );
  assert.equal(plan.statut, "ok");
  if (plan.statut !== "ok") return;
  assert.deepEqual(
    plan.changements.map((c) => c.cleSql).sort(),
    ["billing", "executive", "finance", "quote_pricing"],
  );
});

// ------------------------------------------------------------------
// Le compte rendu
// ------------------------------------------------------------------

test("rien à faire se dit sans alarmer", () => {
  const r = raconter([], []);
  assert.equal(r.statut, "ok");
  assert.match(r.message, /Aucun changement/);
});

test("tout est passé : un succès, au pluriel juste", () => {
  const r = raconter(["Finance → Sol", "Direction → Luna"], []);
  assert.equal(r.statut, "ok");
  assert.match(r.message, /2 changements enregistrés et journalisés/);
});

test("LE DÉFAUT CORRIGÉ : un échec partiel NOMME ce qui est déjà passé", () => {
  // C'est tout l'objet de la correction. Un message qui ne parlerait
  // que de l'agent en défaut laisserait l'opérateur croire que rien
  // n'a bougé, alors que le modèle le plus cher tourne déjà chez le
  // client.
  const r = raconter(["Finance → Sol"], ["Imposer le modèle de « Facturation » : la base a refusé."]);
  assert.equal(r.statut, "erreur");
  assert.match(r.message, /Facturation/);
  assert.match(r.message, /ATTENTION/);
  assert.match(r.message, /Finance → Sol/);
  assert.doesNotMatch(r.message, /Aucun changement n'a été enregistré/);
});

test("tout a échoué : on peut alors dire que rien n'a été enregistré", () => {
  const r = raconter([], ["Imposer le modèle de « Facturation » : la base a refusé."]);
  assert.equal(r.statut, "erreur");
  assert.match(r.message, /Aucun changement n'a été enregistré/);
  assert.doesNotMatch(r.message, /ATTENTION/);
});
