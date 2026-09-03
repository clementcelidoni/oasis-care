import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIANCES,
  MESSAGE_INDISPONIBLE,
  MOTIFS_PANNE,
  PANNES_FOURNISSEUR,
  centimes,
  compteur,
  estConfiance,
  estDonneesInsuffisantes,
  lireConfiance,
  nombreLisible,
} from "./types.ts";

/**
 * §11V — LES LECTURES PRIMITIVES, ET LA CONVERSION QUI MENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN FICHIER DE TESTS POUR QUATRE PETITES FONCTIONS
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce que ce sont elles qui lisent l'argent. La mémoire de ce dépôt
 * porte quatre classes de bugs silencieux, et deux d'entre elles
 * naissent ici : le `|| 0` derrière la lecture d'un nombre, et le
 * timestamp aveugle. La première a une jumelle moins connue et tout
 * aussi coûteuse — `Number()`, qui rend ZÉRO pour `null`, `""`,
 * `false` et `[]`.
 *
 * La différence entre les deux se voit à ce qu'elles produisent :
 *
 *   `|| 0`     transforme un zéro légitime… en zéro. Sans dégât.
 *              Et transforme un `null` en zéro. Avec dégât.
 *
 *   `Number()` transforme un VIDE en zéro, ce qui est pire : le vide
 *              venait de quelque part — une colonne non renseignée, un
 *              champ que le modèle n'a pas rempli — et le zéro, lui,
 *              a l'air d'une mesure.
 *
 * Ces tests figent la seule réponse défendable : on ne sait pas.
 */

// ==================================================================
// 1. `nombreLisible` — la règle, énoncée une fois
// ==================================================================

test("les quatre vides que `Number()` transforme en zéro rendent null", () => {
  for (const vide of [null, undefined, "", "   ", false, true, [], {}]) {
    assert.equal(
      nombreLisible(vide),
      null,
      `« ${JSON.stringify(vide) ?? String(vide)} » n'est pas un nombre, et surtout pas zéro`,
    );
  }
});

test("un vrai zéro reste zéro", () => {
  // La règle ne doit pas basculer dans l'excès inverse : mesurer zéro
  // est une information, et l'effacer serait la même faute retournée.
  assert.equal(nombreLisible(0), 0);
  assert.equal(nombreLisible("0"), 0);
  assert.equal(centimes(0), 0);
});

test("PostgREST rend les bigint en TEXTE, et c'est le seul cas où une chaîne est acceptée", () => {
  assert.equal(nombreLisible("3845000"), 3_845_000);
  assert.equal(centimes("3845000"), 3_845_000);
  assert.equal(nombreLisible("38 450"), null, "un espace n'est pas un séparateur de milliers ici");
  assert.equal(nombreLisible("38,45"), null, "une virgule décimale non plus");
});

test("ni l'infini ni NaN ne passent pour des montants", () => {
  assert.equal(nombreLisible(Number.POSITIVE_INFINITY), null);
  assert.equal(nombreLisible(NaN), null);
  assert.equal(centimes("Infinity"), null);
});

test("les centimes sont TRONQUÉS, jamais arrondis", () => {
  // Arrondir créerait un centime qui n'existe nulle part en base.
  assert.equal(centimes(1234.9), 1234);
  assert.equal(centimes(-1234.9), -1234);
});

// ==================================================================
// 2. `compteur` — l'exception assumée
// ==================================================================

test("les compteurs de jetons, EUX, valent zéro quand on ne sait pas", () => {
  // Et c'est volontaire : un appel dont on ne compte pas les jetons
  // n'est pas un appel gratuit, mais `ai_usage_events.input_tokens`
  // est `not null`. Zéro y est un compte mesuré, pas un montant
  // inventé — la colonne d'argent, elle, reste nullable.
  assert.equal(compteur(null), 0);
  assert.equal(compteur(undefined), 0);
  assert.equal(compteur(-5), 0, "un compteur négatif n'existe pas");
  assert.equal(compteur(1200), 1200);
  assert.equal(compteur("1200"), 1200);
});

// ==================================================================
// 3. La confiance — le doute descend, il ne monte pas
// ==================================================================

test("une confiance inconnue vaut « insufficient_data », jamais « high »", () => {
  assert.equal(lireConfiance("assez sûr"), "insufficient_data");
  assert.equal(lireConfiance(null), "insufficient_data");
  assert.equal(lireConfiance(undefined), "insufficient_data");
  assert.equal(lireConfiance("high"), "high");
});

test("estConfiance ne reconnaît que les quatre valeurs déclarées", () => {
  for (const c of CONFIANCES) assert.equal(estConfiance(c), true);
  assert.equal(estConfiance("HIGH"), false, "la casse compte : la base est en minuscules");
  assert.equal(estConfiance(2), false);
});

test("« données insuffisantes » se distingue des trois autres", () => {
  assert.equal(estDonneesInsuffisantes("insufficient_data"), true);
  assert.equal(estDonneesInsuffisantes("low"), false, "« peu de données » n'est pas « pas de données »");
});

// ==================================================================
// 4. Les motifs de panne
// ==================================================================

test("les pannes du fournisseur sont un sous-ensemble des motifs acceptés par 0076", () => {
  for (const panne of PANNES_FOURNISSEUR) {
    assert.ok(
      (MOTIFS_PANNE as readonly string[]).includes(panne),
      `« ${panne} » ferait échouer l'insertion du journal au moment précis où quelque chose va mal`,
    );
  }
});

test("le message d'indisponibilité est celui de la page 23, mot pour mot", () => {
  assert.equal(MESSAGE_INDISPONIBLE, "Service temporairement indisponible.");
});
