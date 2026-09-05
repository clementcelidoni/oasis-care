import test from "node:test";
import assert from "node:assert/strict";

import {
  libelleMois,
  moisCivil,
  moisProposables,
  motifsBloquants,
  totalPrevisionnelHtCents,
} from "./facture.ts";
import type { LigneCalculee } from "./types.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * 1. LES BORNES D'UNE PÉRIODE. `period_end` est EXCLUSIVE côté base —
 *    la contrainte est `period_end > period_start`, et les libellés de
 *    ligne écrivent « du 01/01 au 31/01 », soit `period_end - 1`. Se
 *    tromper d'un jour ferait facturer treize mois par an, et l'index
 *    unique d'idempotence cesserait de reconnaître la même période.
 *
 * 2. UN SOUS-TOTAL NE S'AFFICHE PAS SOUS UNE LISTE INCOMPLÈTE. Dès
 *    qu'une ligne porte un motif de blocage, le total prévisionnel rend
 *    `null` : un chiffre faux qui a l'air d'un chiffre ne demande pas à
 *    être vérifié.
 */

function ligne(partiel: Partial<LigneCalculee>): LigneCalculee {
  return {
    line_position: 1,
    kind: "plan",
    module_key: null,
    description: "Pro — abonnement mensuel",
    quantity: 1,
    unit_price_cents: 7990,
    vat_rate: 20,
    blocking_reason: null,
    ...partiel,
  };
}

test("un mois civil va du 1er au 1er du mois suivant — la fin est EXCLUSIVE", () => {
  assert.deepEqual(moisCivil(2026, 1), { debut: "2026-01-01", fin: "2026-02-01" });
  assert.deepEqual(moisCivil(2026, 2), { debut: "2026-02-01", fin: "2026-03-01" });
});

test("décembre bascule sur le 1er janvier de l'année suivante", () => {
  assert.deepEqual(moisCivil(2026, 12), { debut: "2026-12-01", fin: "2027-01-01" });
});

test("février bissextile n'a pas besoin d'être connu : la fin est le 1er mars", () => {
  assert.deepEqual(moisCivil(2028, 2), { debut: "2028-02-01", fin: "2028-03-01" });
});

test("le libellé d'un mois est en français", () => {
  assert.match(libelleMois(2026, 9), /septembre/i);
  assert.match(libelleMois(2026, 9), /2026/);
});

test("les mois proposables partent du mois EN COURS et remontent douze mois", () => {
  const liste = moisProposables(new Date("2026-09-05T12:00:00Z"));
  assert.equal(liste.length, 12);
  assert.deepEqual({ annee: liste[0].annee, mois: liste[0].mois }, { annee: 2026, mois: 9 });
  assert.deepEqual({ annee: liste[11].annee, mois: liste[11].mois }, { annee: 2025, mois: 10 });
});

test("un même motif de blocage n'est pas répété — un régime de TVA inconnu marque toutes les lignes", () => {
  const motif = "Régime de TVA inconnu pour cette entreprise.";
  const motifs = motifsBloquants([
    ligne({ blocking_reason: motif }),
    ligne({ line_position: 2, blocking_reason: motif }),
    ligne({ line_position: 3, blocking_reason: "La case « team × BioLab » n'a pas de prix." }),
  ]);
  assert.equal(motifs.length, 2);
  assert.ok(motifs.includes(motif));
});

test("aucun motif quand rien ne bloque", () => {
  assert.deepEqual(motifsBloquants([ligne({}), ligne({ line_position: 2 })]), []);
});

test("le total prévisionnel additionne quantité × prix unitaire", () => {
  const total = totalPrevisionnelHtCents([
    ligne({ unit_price_cents: 7990 }),
    ligne({ line_position: 2, kind: "seats", quantity: 3, unit_price_cents: 990 }),
    ligne({ line_position: 3, kind: "discount", unit_price_cents: -5000 }),
  ]);
  assert.equal(total, 7990 + 2970 - 5000);
});

test("une seule ligne bloquée rend le total INCONNU, jamais partiel", () => {
  const total = totalPrevisionnelHtCents([
    ligne({ unit_price_cents: 7990 }),
    ligne({ line_position: 2, kind: "module", unit_price_cents: 0, blocking_reason: "Case non décidée." }),
  ]);
  assert.equal(total, null);
});

test("aucune ligne : inconnu, et non zéro", () => {
  assert.equal(totalPrevisionnelHtCents([]), null);
});
