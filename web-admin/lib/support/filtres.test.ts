import assert from "node:assert/strict";
import { test } from "node:test";

import {
  champsCaches,
  lienFiltre,
  lireFiltres,
  statutsRetenus,
  STATUT_PAR_DEFAUT,
} from "./filtres.ts";

test("sans paramètre, la liste s'ouvre sur ce qui attend une réponse", () => {
  const filtres = lireFiltres({});
  assert.equal(filtres.statut, STATUT_PAR_DEFAUT);
  assert.deepEqual(statutsRetenus(filtres.statut), ["open", "pending"]);
  assert.equal(filtres.page, 1);
});

test("« toutes » ne restreint rien, et ne le fait pas en énumérant les statuts", () => {
  // Rendre `null` plutôt que les quatre statuts : le jour où la base en
  // gagne un cinquième, « Toutes » continue de porter son nom.
  assert.equal(statutsRetenus("toutes"), null);
});

test("un filtre mal orthographié retombe sur le défaut au lieu de vider la liste", () => {
  const filtres = lireFiltres({ statut: "urgent", priorite: "moyenne", produit: "android" });
  assert.equal(filtres.statut, STATUT_PAR_DEFAUT);
  assert.equal(filtres.priorite, null);
  assert.equal(filtres.produit, null);
});

test("une page illisible, nulle ou négative vaut 1", () => {
  assert.equal(lireFiltres({ page: "0" }).page, 1);
  assert.equal(lireFiltres({ page: "-3" }).page, 1);
  assert.equal(lireFiltres({ page: "trois" }).page, 1);
  assert.equal(lireFiltres({ page: "4" }).page, 4);
});

test("une recherche vide n'est pas une recherche", () => {
  assert.equal(lireFiltres({ q: "   " }).recherche, null);
  assert.equal(lireFiltres({ q: "  facture  " }).recherche, "facture");
});

test("changer de filtre emporte les autres, mais jamais la page", () => {
  const filtres = lireFiltres({ statut: "closed", q: "facture", page: "4" });
  const lien = lienFiltre("/support", filtres, { priorite: "urgent" });

  const url = new URL(lien, "https://exemple.test");
  assert.equal(url.searchParams.get("statut"), "closed");
  assert.equal(url.searchParams.get("q"), "facture");
  assert.equal(url.searchParams.get("priorite"), "urgent");
  // La page 4 d'une liste filtrée autrement afficherait un vide qu'on
  // lirait « aucun résultat ».
  assert.equal(url.searchParams.get("page"), null);
});

test("le défaut ne s'écrit pas dans l'URL : une adresse propre se partage", () => {
  assert.equal(lienFiltre("/support", lireFiltres({}), {}), "/support");
});

test("changer de page garde les filtres", () => {
  const filtres = lireFiltres({ statut: "open", produit: "mobile" });
  const url = new URL(lienFiltre("/support", filtres, { page: 3 }), "https://exemple.test");
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("statut"), "open");
  assert.equal(url.searchParams.get("produit"), "mobile");
});

test("les champs cachés emportent les filtres dans le formulaire de recherche", () => {
  const champs = champsCaches(lireFiltres({ statut: "closed", priorite: "high" }));
  assert.deepEqual(champs, [
    { nom: "statut", valeur: "closed" },
    { nom: "priorite", valeur: "high" },
  ]);
  // Le défaut n'a pas besoin d'être transporté : il est le défaut.
  assert.deepEqual(champsCaches(lireFiltres({})), []);
});
