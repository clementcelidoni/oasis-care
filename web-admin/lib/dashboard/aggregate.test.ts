import { test } from "node:test";
import assert from "node:assert/strict";

import {
  combineReasons,
  formatSignedCount,
  reasonFor,
  shareOf,
  sumKnown,
} from "./aggregate.ts";
import { resolveActivityWindow } from "./windows.ts";

/**
 * Ce que ces tests protègent : la seule règle du tableau de bord qui
 * ne se voit pas à l'œil nu.
 *
 * Un écran qui affiche « 0 € » là où la vérité est « nous ne suivons
 * l'abonnement d'aucune entreprise » a l'air parfaitement sain. Rien
 * ne le signale — ni la compilation, ni le lint, ni un coup d'œil à la
 * page ; il faut connaître la base pour voir le mensonge. Le jour où
 * quelqu'un ajoutera un `?? 0` pour faire taire une erreur de type, ce
 * sont ces assertions qui le rattraperont.
 */

test("un chiffre inconnu traverse l'agrégation sans devenir un chiffre", () => {
  assert.equal(formatSignedCount(null), null);
  assert.equal(sumKnown([3, null]), null, "Pro connu + Mobile inconnu = inconnu");
  assert.equal(sumKnown([null, null]), null);
  assert.equal(shareOf(null, 10), null);
  assert.equal(shareOf(3, null), null);
});

test("zéro n'est pas inconnu : c'est un chiffre, et il s'affiche", () => {
  assert.equal(formatSignedCount(0), "±0");
  assert.equal(sumKnown([0, 0]), 0, "deux vrais zéros font un vrai zéro");
  assert.equal(shareOf(0, 4), 0, "aucune couverture sur quatre est un vrai zéro");
});

test("une addition connue de bout en bout rend bien le total", () => {
  assert.equal(sumKnown([3, 4]), 7);
  assert.equal(sumKnown([]), null, "on n'a rien additionné, on ne sait rien");
});

test("une part n'existe pas sans dénominateur", () => {
  assert.equal(shareOf(1, 0), null, "0 entreprise ne donne pas 0 % de couverture");
  assert.equal(shareOf(1, 2), 0.5);
});

test("une part supérieure au tout est une incohérence, pas une barre pleine", () => {
  // Le cas réel qu'on défend : 2 « utilisateurs Pro » pour 1 compte au
  // total. Raboté à 1, il se dessinerait comme « 100 % de nos comptes
  // sont rattachés à une entreprise Pro » — une phrase fausse et
  // parfaitement plausible.
  assert.equal(shareOf(2, 1), null);
  assert.equal(shareOf(-1, 4), null, "une part négative n'existe pas non plus");
  assert.equal(shareOf(4, 4), 1, "l'égalité, elle, reste un vrai 100 %");
});

test("la progression du mois porte son signe, et le bon moins", () => {
  assert.equal(formatSignedCount(482)?.startsWith("+"), true);
  assert.equal(formatSignedCount(-3), "−3", "U+2212, pas un trait d'union");
});

test("un motif absent ne devient jamais une chaîne vide affichable", () => {
  assert.equal(reasonFor({ mrr_cents: "" }, "mrr_cents"), null);
  assert.equal(reasonFor(undefined, "mrr_cents"), null);
  assert.equal(reasonFor({ mrr_cents: "aucun abonnement suivi" }, "mrr_cents"), "aucun abonnement suivi");
});

test("un chiffre agrégé porte le motif de CHAQUE source qui manque", () => {
  const reasons = {
    pro_trials: "Pro : rien n'écrit la table.",
    mobile_trials: "Mobile : Apple ne distingue pas un essai d'un achat.",
  };
  const combined = combineReasons(reasons, ["pro_trials", "mobile_trials"]) ?? "";
  assert.ok(combined.includes("Pro :"), "le motif Pro doit rester lisible");
  assert.ok(combined.includes("Mobile :"), "le motif Mobile ne doit pas être avalé par le premier");
  assert.equal(combineReasons(reasons, ["churn_30d_percent"]), null);
});

test("la fenêtre d'activité retombe sur aujourd'hui plutôt que de refuser une URL bricolée", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  assert.equal(resolveActivityWindow(undefined, now).key, "jour");
  assert.equal(resolveActivityWindow("n'importe quoi", now).key, "jour");
  assert.equal(resolveActivityWindow(["24h", "7j"], now).key, "jour", "un paramètre répété n'est pas une fenêtre");
  assert.equal(
    resolveActivityWindow("jour", now).since,
    null,
    "« aujourd'hui » est calculé par la base, à l'heure de Paris",
  );
});

test("les fenêtres glissantes se terminent maintenant", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  assert.equal(resolveActivityWindow("1h", now).since?.toISOString(), "2026-09-03T11:00:00.000Z");
  assert.equal(resolveActivityWindow("24h", now).since?.toISOString(), "2026-09-02T12:00:00.000Z");
  assert.equal(resolveActivityWindow("7j", now).since?.toISOString(), "2026-08-27T12:00:00.000Z");
});
