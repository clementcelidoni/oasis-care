import assert from "node:assert/strict";
import { test } from "node:test";

import {
  borneBasse,
  champsCachesJournal,
  FENETRE_PAR_DEFAUT,
  lienJournal,
  lireFiltresJournal,
} from "./filtres.ts";

const MAINTENANT = new Date("2026-09-05T12:00:00.000Z");

test("la fenêtre par défaut est trente jours, et elle ne s'écrit pas dans l'URL", () => {
  const filtres = lireFiltresJournal({});
  assert.equal(filtres.fenetre, FENETRE_PAR_DEFAUT);
  assert.equal(lienJournal("/securite/journal", filtres, {}), "/securite/journal");
});

test("la borne basse est calculée depuis une horloge qu'on peut fournir", () => {
  assert.equal(borneBasse("24h", MAINTENANT), "2026-09-04T12:00:00.000Z");
  assert.equal(borneBasse("7j", MAINTENANT), "2026-08-29T12:00:00.000Z");
  assert.equal(borneBasse("30j", MAINTENANT), "2026-08-06T12:00:00.000Z");
  // « Tout » n'est pas une très vieille date : c'est l'absence de borne.
  // Une date arbitraire finirait par couper un journal qu'on conserve.
  assert.equal(borneBasse("tout", MAINTENANT), null);
});

test("la famille « autre » n'est pas un filtre : elle n'a aucun préfixe à envoyer en base", () => {
  // La proposer produirait une liste vide qu'on lirait « aucun acte de
  // cette famille », alors que la cause serait qu'on ne sait pas la
  // demander.
  assert.equal(lireFiltresJournal({ famille: "autre" }).famille, null);
  assert.equal(lireFiltresJournal({ famille: "droits" }).famille, "droits");
  assert.equal(lireFiltresJournal({ famille: "n'importe quoi" }).famille, null);
});

test("un identifiant d'administrateur qui n'est pas un uuid est ignoré", () => {
  // Une chaîne quelconque partirait dans un `eq` sur une colonne uuid et
  // reviendrait en erreur de conversion illisible.
  assert.equal(lireFiltresJournal({ admin: "moi" }).adminUserId, null);
  assert.equal(
    lireFiltresJournal({ admin: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }).adminUserId,
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  );
});

test("changer de famille garde la fenêtre mais repart à la première page", () => {
  const filtres = lireFiltresJournal({ fenetre: "7j", page: "5" });
  const url = new URL(
    lienJournal("/securite/journal", filtres, { famille: "droits" }),
    "https://exemple.test",
  );
  assert.equal(url.searchParams.get("fenetre"), "7j");
  assert.equal(url.searchParams.get("famille"), "droits");
  assert.equal(url.searchParams.get("page"), null);
});

test("changer de page garde tous les filtres", () => {
  const filtres = lireFiltresJournal({ famille: "argent", fenetre: "24h", q: "remise" });
  const url = new URL(
    lienJournal("/securite/journal", filtres, { page: 2 }),
    "https://exemple.test",
  );
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("famille"), "argent");
  assert.equal(url.searchParams.get("fenetre"), "24h");
  assert.equal(url.searchParams.get("q"), "remise");
});

test("les champs cachés emportent les filtres actifs, jamais les défauts", () => {
  assert.deepEqual(champsCachesJournal(lireFiltresJournal({})), []);
  assert.deepEqual(
    champsCachesJournal(lireFiltresJournal({ famille: "droits", fenetre: "24h" })),
    [
      { nom: "famille", valeur: "droits" },
      { nom: "fenetre", valeur: "24h" },
    ],
  );
});
