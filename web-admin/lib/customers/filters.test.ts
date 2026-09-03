import test from "node:test";
import assert from "node:assert/strict";

import {
  ORGANIZATION_FILTERS,
  USER_FILTERS,
  findFilter,
  listHref,
  parseFilter,
} from "./filters.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * Trois filtres de la spec p.7 n'ont aucune donnée derrière et la base
 * LÈVE plutôt que de les honorer. Le jour où quelqu'un « corrige » ce
 * catalogue en retirant un `unsupportedReason` — pour faire disparaître
 * un chip grisé qui dérange l'œil — le filtre redeviendrait cliquable
 * et l'écran se mettrait à afficher une erreur SQL au clic.
 *
 * Le pire scénario est ailleurs : si quelqu'un retirait aussi le
 * `raise` côté SQL, cliquer sur « Mobile » rendrait la plateforme
 * ENTIÈRE sous un titre affirmant « voici les utilisateurs Mobile ».
 * Ce test-là ne peut pas l'empêcher, mais il fige au moins la moitié
 * qui vit ici.
 */

test("les trois filtres impossibles de la spec p.7 sont éteints, avec leur raison", () => {
  for (const value of ["mobile", "trial", "cancelled"]) {
    const option = findFilter(USER_FILTERS, value);
    assert.ok(option, `le filtre « ${value} » a disparu du catalogue`);
    assert.ok(
      option.unsupportedReason && option.unsupportedReason.length > 40,
      `le filtre « ${value} » doit rester inerte ET dire pourquoi`,
    );
  }
});

/**
 * Le pendant du test précédent : les filtres que la base ACCEPTE ne
 * doivent pas devenir inertes par un copier-coller malheureux. Un
 * filtre grisé sans raison d'être est une fonction perdue en silence.
 */
test("les filtres acceptés par la base restent cliquables", () => {
  for (const value of [null, "pro", "premium", "gratuit", "actif", "inactif", "banni", "offert"]) {
    const option = findFilter(USER_FILTERS, value);
    assert.ok(option, `le filtre « ${value} » a disparu du catalogue`);
    assert.equal(option.unsupportedReason, undefined);
  }
});

test("les filtres d'entreprise sont tous acceptés par la base", () => {
  // `admin_list_organizations` n'a aucun filtre impossible : elle
  // n'accepte que archivees, toutes, avec_abonnement, sans_abonnement.
  for (const option of ORGANIZATION_FILTERS) {
    assert.equal(option.unsupportedReason, undefined);
  }
  const values = ORGANIZATION_FILTERS.map((option) => option.value);
  assert.deepEqual(values, [null, "avec_abonnement", "sans_abonnement", "archivees", "toutes"]);
});

/**
 * L'URL est l'état de la page. Ces règles-là se cassent sans bruit :
 * une page reportée d'un filtre à l'autre ouvre un écran vide, et une
 * URL pleine de paramètres vides n'est plus la même que la page
 * d'accueil de la liste alors qu'elle montre exactement la même chose.
 */
test("les paramètres vides sont omis de l'URL", () => {
  assert.equal(listHref("/utilisateurs", {}), "/utilisateurs");
  assert.equal(listHref("/utilisateurs", { q: null, filtre: null, page: 1 }), "/utilisateurs");
});

test("la première page n'est pas écrite dans l'URL", () => {
  // Revenir en page 1 doit rendre l'adresse canonique, pas y laisser la
  // trace du détour.
  assert.equal(listHref("/utilisateurs", { filtre: "banni", page: 1 }), "/utilisateurs?filtre=banni");
  assert.equal(
    listHref("/utilisateurs", { filtre: "banni", page: 3 }),
    "/utilisateurs?filtre=banni&page=3",
  );
});

test("la recherche est encodée, jamais recopiée telle quelle dans l'URL", () => {
  const href = listHref("/organisations", { q: "jardins & co" });
  assert.equal(href, "/organisations?q=jardins+%26+co");
  // Le `&` du nom ne doit pas se transformer en séparateur de
  // paramètres : sinon « co » deviendrait un paramètre à part.
  assert.equal(new URL(href, "https://exemple.test").searchParams.get("q"), "jardins & co");
});

test("un filtre inconnu part tel quel vers la base, qui l'arbitre", () => {
  // Ce catalogue ne valide rien : dupliquer ici la liste des filtres
  // acceptés créerait deux vérités à tenir d'accord, et c'est toujours
  // la copie qui dérive.
  assert.equal(parseFilter("nimportequoi"), "nimportequoi");
  assert.equal(parseFilter("  pro  "), "pro");
  assert.equal(parseFilter(""), null);
  assert.equal(parseFilter(undefined), null);
});
