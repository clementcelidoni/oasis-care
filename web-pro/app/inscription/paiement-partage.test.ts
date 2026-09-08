import { test } from "node:test";
import assert from "node:assert/strict";

import { lirePaiementEnCours, type PaiementEnCours } from "./paiement-partage.ts";

const AVEC_ESSAI: PaiementEnCours = {
  planKey: "team",
  cycle: "monthly",
  avecEssai: true,
  premierPrelevementLe: "2026-10-07",
  finEssaiLe: "2026-10-07",
};

const SANS_ESSAI: PaiementEnCours = {
  planKey: "solo",
  cycle: "yearly",
  avecEssai: false,
  premierPrelevementLe: "2026-09-07",
  finEssaiLe: null,
};

// ------------------------------------------------------------------
// CE QUI PASSE
// ------------------------------------------------------------------

test("un aller-retour ne perd rien", () => {
  assert.deepEqual(lirePaiementEnCours(JSON.stringify(AVEC_ESSAI)), AVEC_ESSAI);
  assert.deepEqual(lirePaiementEnCours(JSON.stringify(SANS_ESSAI)), SANS_ESSAI);
});

test("une clé de trop est ignorée sans faire échouer la lecture", () => {
  // Un cookie posé par une version antérieure ne doit pas rendre
  // l'écran muet : on lit ce qu'on connaît, on laisse le reste.
  const lu = lirePaiementEnCours(JSON.stringify({ ...AVEC_ESSAI, montantCents: 7990 }));
  assert.deepEqual(lu, AVEC_ESSAI);
});

// ------------------------------------------------------------------
// CE QUI NE PASSE PAS — au moindre doute, on ne dit rien
// ------------------------------------------------------------------

test("l'absence de cookie n'est pas une erreur, c'est un silence", () => {
  assert.equal(lirePaiementEnCours(undefined), null);
  assert.equal(lirePaiementEnCours(""), null);
});

test("un cookie illisible ne devient pas un paiement", () => {
  assert.equal(lirePaiementEnCours("{"), null);
  assert.equal(lirePaiementEnCours("null"), null);
  assert.equal(lirePaiementEnCours('"team"'), null);
  assert.equal(lirePaiementEnCours("[]"), null);
});

test("une date de prélèvement mal formée est refusée plutôt que réparée", () => {
  // Une date inventée serait affichée avec le même aplomb qu'une date
  // vraie, et c'est celle-là que le client retiendrait.
  for (const jour of ["07/10/2026", "2026-10-07T00:00:00Z", "demain", "", "2026-13-45X"]) {
    assert.equal(
      lirePaiementEnCours(JSON.stringify({ ...AVEC_ESSAI, premierPrelevementLe: jour })),
      null,
      `« ${jour} » ne doit pas passer`,
    );
  }
});

test("un rythme inconnu est refusé", () => {
  assert.equal(lirePaiementEnCours(JSON.stringify({ ...AVEC_ESSAI, cycle: "weekly" })), null);
  assert.equal(lirePaiementEnCours(JSON.stringify({ ...AVEC_ESSAI, cycle: 1 })), null);
});

test("une offre sans clé, ou d'une longueur absurde, est refusée", () => {
  assert.equal(lirePaiementEnCours(JSON.stringify({ ...AVEC_ESSAI, planKey: "  " })), null);
  assert.equal(
    lirePaiementEnCours(JSON.stringify({ ...AVEC_ESSAI, planKey: "x".repeat(65) })),
    null,
  );
});

test("un essai sans date de fin n'est pas un essai", () => {
  // « Un mois gratuit » sans dire jusqu'à quand, c'est taire la seule
  // information qui compte.
  assert.equal(
    lirePaiementEnCours(JSON.stringify({ ...AVEC_ESSAI, finEssaiLe: null })),
    null,
  );
});

test("un booléen envoyé comme texte ne passe pas pour un booléen", () => {
  assert.equal(lirePaiementEnCours(JSON.stringify({ ...AVEC_ESSAI, avecEssai: "true" })), null);
});
