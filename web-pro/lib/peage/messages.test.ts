// Les preuves sur la traduction d'un refus du péage.
//
//     node --test --experimental-strip-types "lib/peage/messages.test.ts"
//
// CE QUE CES TESTS DÉFENDENT, dans l'ordre :
//
//   1. UN REFUS QUI N'EST PAS CELUI DU PÉAGE N'EST PAS TRADUIT. C'est
//      le piège le plus coûteux : dire « payez votre abonnement » à
//      quelqu'un dont l'abonnement est en règle et qui vient de heurter
//      un vrai bogue. Il paierait deux fois, ou il partirait.
//   2. LE MESSAGE NOMME LA FACTURE quand on la connaît. Un refus
//      vérifiable ne ressemble pas à une décision arbitraire.
//   3. LES DATES NE RECULENT PAS D'UN JOUR selon le fuseau du serveur.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  enDateFrancaise,
  enEuros,
  estUnRefusDuPeage,
  messagePeage,
  precisionCreance,
  traduireRefus,
} from "./messages.ts";
import type { SituationPeage } from "./situation.ts";

const REFUS_PEAGE = {
  message:
    'new row violates row-level security policy "Péage — création" for table "crm_customers"',
};

const REFUS_SIEGE = {
  message:
    'new row violates row-level security policy "Péage — création" for table "organization_invitations"',
};

const SITUATION: SituationPeage = {
  etat: "restreint",
  peutExploiter: false,
  peutGrandir: false,
  impayeDepuis: "2026-03-03",
  facturesEchues: 1,
  montantDuCents: 16788,
  joursDeSursisRestants: null,
  finEssai: null,
  finPeriode: "2026-04-02",
};

test("un refus du péage est reconnu, un refus de droits ordinaire ne l'est pas", () => {
  assert.equal(estUnRefusDuPeage(REFUS_PEAGE), true);
  assert.equal(
    estUnRefusDuPeage({
      message: 'new row violates row-level security policy "Members write invoices" for table "invoices"',
    }),
    false,
    "Un refus de PERMISSION n'est pas un refus d'ARGENT.",
  );
  assert.equal(estUnRefusDuPeage({ message: "could not connect to server" }), false);
  assert.equal(estUnRefusDuPeage(null), false);
});

test("UNE VRAIE PANNE N'EST JAMAIS MAQUILLÉE EN PROBLÈME D'ABONNEMENT", () => {
  const panne = { message: "connexion perdue avec la base" };
  assert.equal(traduireRefus(panne, SITUATION), "connexion perdue avec la base");
});

test("le refus du péage devient une phrase, et elle nomme la facture", () => {
  const phrase = traduireRefus(REFUS_PEAGE, SITUATION);
  assert.match(phrase, /vous gardez/i, "La première chose dite est que rien n'est perdu.");
  assert.match(phrase, /3 mars 2026/);
  assert.match(phrase, /167,88/);
  assert.equal(phrase.includes("row-level security"), false);
});

test("le refus sur un SIÈGE parle du collaborateur, pas de la production", () => {
  const enSursis: SituationPeage = { ...SITUATION, etat: "sursis", peutExploiter: true };
  const phrase = traduireRefus(REFUS_SIEGE, enSursis);
  assert.match(phrase, /prélèvement n'a pas abouti/);
  assert.match(phrase, /collaborateur/);
});

test("sans situation connue, on dit une phrase VRAIE DANS LES TROIS CAS", () => {
  // Les 128 actions serveur du produit n'ont pas lu peage_situation :
  // ce serait un aller-retour de plus à chaque écriture. La phrase
  // rendue doit donc valoir pour « transit », « restreint » et le
  // sursis — et surtout n'inventer ni facture ni résiliation.
  const phrase = traduireRefus(REFUS_PEAGE, null);
  assert.match(phrase, /abonnement/);
  assert.match(phrase, /intact/, "Rien n'est perdu : c'est ce qu'il faut dire en premier.");
  assert.equal(phrase.includes("attend son règlement"), false);
  assert.equal(
    phrase.includes("arrivé à échéance"),
    false,
    "Un compte qui n'a jamais eu d'abonnement chercherait une résiliation inexistante.",
  );
});

test("sans situation connue, un refus de SIÈGE se distingue quand même", () => {
  const phrase = traduireRefus(REFUS_SIEGE, null);
  assert.match(phrase, /collaborateur/);
  assert.match(phrase, /rien d'autre n'est bloqué/i);
});

test("« ouvert » n'envoie personne payer", () => {
  // Si le péage dit ouvert et qu'un refus arrive quand même, le motif
  // est ailleurs. Envoyer ce client à la caisse serait la pire méprise.
  const phrase = messagePeage("ouvert");
  assert.match(phrase, /bien en cours/);
});

test("le transit se dit sans dramatiser : le contrat manque, pas les données", () => {
  const phrase = messagePeage("transit");
  assert.match(phrase, /intact/);
  assert.match(phrase, /il ne manque que le contrat/);
});

test("plusieurs factures se disent au pluriel, et zéro ne se dit pas", () => {
  assert.equal(precisionCreance({ ...SITUATION, facturesEchues: 0, impayeDepuis: null }), null);
  const deux = precisionCreance({ ...SITUATION, facturesEchues: 2, montantDuCents: 33576 });
  assert.match(String(deux), /^2 factures/);
});

test("une date ne recule pas d'un jour selon le fuseau du serveur", () => {
  // « 2026-01-01 » construit en Date() est minuit UTC : un serveur à
  // Paris l'afficherait le 31 décembre. On découpe la chaîne.
  assert.equal(enDateFrancaise("2026-01-01"), "1 janvier 2026");
  assert.equal(enDateFrancaise("2026-12-31"), "31 décembre 2026");
  assert.equal(enDateFrancaise("2026-08-09T22:00:00.000Z"), "9 août 2026");
});

test("les montants sont en euros, pas en centimes", () => {
  assert.match(enEuros(16788), /167,88/);
  assert.match(enEuros(0), /0,00/);
});
