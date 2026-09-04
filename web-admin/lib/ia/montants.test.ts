import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAFOND_MAX_CENTIMES,
  champDepuisCents,
  etatPlafond,
  lireMontantEuros,
  sansAucunPlafond,
} from "./montants.ts";

/**
 * ==================================================================
 * UN SEUL SUJET : ZÉRO N'EST PAS VIDE, ET VIDE N'EST PAS ZÉRO
 * ==================================================================
 *
 * `daily_organization_limit_cents = 0` veut dire « IA coupée » : le
 * contrôle de coût refusera chaque appel avec `budget_exceeded`.
 * `NULL` veut dire « aucune limite » : tous les appels passent. Ce sont
 * les deux réglages les plus opposés de la table, et une seule
 * distraction les confond.
 *
 * Le pire scénario est celui d'une lecture qui rendrait `0` sur une
 * saisie illisible : « 12,5O » avec la lettre O, un espace insécable
 * collé depuis un tableur, une virgule de trop. L'IA d'une entreprise
 * s'éteindrait sans un mot, et personne ne relierait la panne du
 * lendemain matin à la saisie de la veille.
 */

test("un champ vide veut dire « aucun plafond », pas zéro", () => {
  assert.deepEqual(lireMontantEuros(""), { etat: "aucune" });
  assert.deepEqual(lireMontantEuros("   "), { etat: "aucune" });
  assert.deepEqual(lireMontantEuros(null), { etat: "aucune" });
  assert.deepEqual(lireMontantEuros(undefined), { etat: "aucune" });
});

test("zéro est un montant délibéré, et il est accepté comme tel", () => {
  assert.deepEqual(lireMontantEuros("0"), { etat: "montant", cents: 0 });
  assert.deepEqual(lireMontantEuros("0,00"), { etat: "montant", cents: 0 });
});

test("une saisie illisible est REFUSÉE, jamais ramenée à zéro", () => {
  for (const saisie of ["12,5O", "abc", "1e3", "12abc", "-5", "10,005", "12,", ","]) {
    const lecture = lireMontantEuros(saisie);
    assert.equal(lecture.etat, "illisible", `« ${saisie} » aurait dû être refusée`);
  }
});

test("un champ ne contenant qu'un « € » n'est pas un champ vide", () => {
  // C'est une saisie commencée puis abandonnée. La traiter comme
  // « aucune » retirerait un plafond que personne n'a demandé de
  // retirer — un geste bien trop conséquent pour venir d'un caractère
  // oublié.
  assert.equal(lireMontantEuros("€").etat, "illisible");
});

test("la virgule française, le point, les espaces insécables et le € final sont acceptés", () => {
  assert.deepEqual(lireMontantEuros("12,50"), { etat: "montant", cents: 1250 });
  assert.deepEqual(lireMontantEuros("12.50"), { etat: "montant", cents: 1250 });
  assert.deepEqual(lireMontantEuros("12,5"), { etat: "montant", cents: 1250 });
  assert.deepEqual(lireMontantEuros("25"), { etat: "montant", cents: 2500 });
  // Espace ordinaire, insécable (U+00A0) et insécable fin (U+202F) :
  // les trois sortent d'un tableur ou d'un copier-coller Windows.
  assert.deepEqual(lireMontantEuros("1 000"), { etat: "montant", cents: 100000 });
  assert.deepEqual(lireMontantEuros("1 000 €"), { etat: "montant", cents: 100000 });
  assert.deepEqual(lireMontantEuros("1 000€"), { etat: "montant", cents: 100000 });
});

test("un plafond au-delà de dix millions d'euros est refusé : c'est une virgule oubliée", () => {
  // C'est exactement le geste que l'audit a reproché au gestionnaire
  // client : passer de 50 € à 1 000 000 €. Un plafond de cet ordre ne
  // protège plus de rien.
  const lecture = lireMontantEuros(String(PLAFOND_MAX_CENTIMES / 100 + 1));
  assert.equal(lecture.etat, "illisible");
  assert.deepEqual(lireMontantEuros(String(PLAFOND_MAX_CENTIMES / 100)), {
    etat: "montant",
    cents: PLAFOND_MAX_CENTIMES,
  });
});

test("rouvrir le formulaire d'une entreprise sans plafond ne propose pas des zéros", () => {
  // Sinon le premier clic sur « Enregistrer » écrirait « IA coupée ».
  assert.equal(champDepuisCents(null), "");
  assert.equal(champDepuisCents(0), "0,00");
  assert.equal(champDepuisCents(1250), "12,50");
});

test("l'aller-retour champ → cents → champ ne perd pas de centime", () => {
  for (const cents of [0, 1, 99, 100, 1250, 999999]) {
    const lecture = lireMontantEuros(champDepuisCents(cents));
    assert.deepEqual(lecture, { etat: "montant", cents });
  }
});

test("les trois états d'un plafond restent distincts jusqu'à l'écran", () => {
  assert.deepEqual(etatPlafond(null), { etat: "aucun" });
  assert.deepEqual(etatPlafond(undefined), { etat: "aucun" });
  assert.deepEqual(etatPlafond(0), { etat: "coupee" });
  assert.deepEqual(etatPlafond(1250), { etat: "montant", cents: 1250 });
});

test("« aucune borne » couvre la ligne absente ET les trois colonnes nulles", () => {
  assert.equal(sansAucunPlafond(null), true);
  assert.equal(
    sansAucunPlafond({
      daily_organization_limit_cents: null,
      monthly_organization_limit_cents: null,
      per_agent_limit_cents: null,
    }),
    true,
  );
  // Un plafond à ZÉRO borne, et de la façon la plus stricte qui soit :
  // il coupe. Le compter comme « aucune borne » serait l'erreur exacte
  // que tout ce fichier combat.
  assert.equal(
    sansAucunPlafond({
      daily_organization_limit_cents: 0,
      monthly_organization_limit_cents: null,
      per_agent_limit_cents: null,
    }),
    false,
  );
});
