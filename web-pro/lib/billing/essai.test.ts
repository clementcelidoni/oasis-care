import { test } from "node:test";
import assert from "node:assert/strict";

import {
  annoncerEssai,
  dateAnniversaire,
  debutEngagement,
  dernierJourDuMois,
  essaiDisponible,
  finEngagement,
  formaterJourFr,
  horodatageFinEssai,
  planifierEssai,
  ESSAI_MOIS,
} from "./essai.ts";

/**
 * §CYCLE DE VIE — L'ESSAI ET SES DATES, ÉPROUVÉS SANS BASE NI RÉSEAU.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CES TESTS DÉFENDENT
 * ══════════════════════════════════════════════════════════════════
 *
 * 1. LA DATE ANNONCÉE EST LA DATE PRÉLEVÉE. Le calcul est le même que
 *    celui de `saas_date_anniversaire()` (0089 § 1), et il est éprouvé
 *    sur les mêmes cas : 31 janvier → 28 février, puis 31 mars.
 * 2. L'ANCRE NE DÉRIVE PAS. C'est le défaut classique — l'abonné
 *    souscrit le 31 et se retrouve prélevé le 28 pour le restant de sa
 *    vie — et il ne se voit qu'au troisième mois.
 * 3. LA PHRASE DIT UNE DATE, jamais « dans un mois », et elle porte les
 *    deux montants avec leur mention.
 *
 * AUCUNE DATE N'EST PRISE SUR L'HORLOGE. Chaque cas fixe son jour de
 * départ : un test qui partirait de `new Date()` passerait onze mois
 * sur douze et tomberait un 29 février, quatre ans plus tard, sur la
 * machine de quelqu'un d'autre.
 */

// ══════════════════════════════════════════════════════════════════
// LE CALENDRIER
// ══════════════════════════════════════════════════════════════════

test("le dernier jour du mois connaît février et les bissextiles", () => {
  assert.equal(dernierJourDuMois(2026, 1), 31);
  assert.equal(dernierJourDuMois(2026, 2), 28);
  assert.equal(dernierJourDuMois(2028, 2), 29, "2028 est bissextile");
  assert.equal(dernierJourDuMois(2100, 2), 28, "2100 ne l'est pas");
  assert.equal(dernierJourDuMois(2026, 4), 30);
  assert.equal(dernierJourDuMois(2026, 12), 31);
});

test("LE 31 FÉVRIER N'EXISTE PAS : l'ancre retombe sur le dernier jour", () => {
  assert.equal(dateAnniversaire("2026-01-31", 1, 31), "2026-02-28");
  assert.equal(dateAnniversaire("2028-01-31", 1, 31), "2028-02-29");
  assert.equal(dateAnniversaire("2026-03-31", 1, 31), "2026-04-30");
});

test("L'ANCRE NE DÉRIVE PAS — elle revient au 31 dès que le mois le permet", () => {
  // ══════════════════════════════════════════════════════════════
  // LE TEST QUI JUSTIFIE LE PARAMÈTRE `jourAncre`
  // ══════════════════════════════════════════════════════════════
  //
  // Un calcul naïf « la période suivante commence un mois après la
  // précédente » ferait 31 janvier → 28 février → 28 mars → 28 avril :
  // l'abonné souscrit le 31 et se retrouve prélevé le 28 à vie. Avec
  // l'ancre conservée à part, il repasse au 31 en mars.
  const ancre = 31;
  assert.equal(dateAnniversaire("2026-01-31", 1, ancre), "2026-02-28");
  assert.equal(dateAnniversaire("2026-02-28", 1, ancre), "2026-03-31");
  assert.equal(dateAnniversaire("2026-03-31", 1, ancre), "2026-04-30");
  assert.equal(dateAnniversaire("2026-04-30", 1, ancre), "2026-05-31");
});

test("le passage d'année se fait sans surprise", () => {
  assert.equal(dateAnniversaire("2026-12-15", 1, 15), "2027-01-15");
  assert.equal(dateAnniversaire("2026-12-31", 1, 31), "2027-01-31");
  assert.equal(dateAnniversaire("2026-10-06", 12, 6), "2027-10-06");
  assert.equal(dateAnniversaire("2026-10-06", 24, 6), "2028-10-06");
});

test("une date illisible LÈVE plutôt que de retomber sur aujourd'hui", () => {
  // Une date de prélèvement fabriquée à partir d'une entrée illisible
  // serait affichée au client avec le même aplomb qu'une date juste.
  assert.throws(() => dateAnniversaire("06/10/2026", 1, 6), /Jour illisible/);
  assert.throws(() => dateAnniversaire("", 1, 6), /Jour illisible/);
  assert.throws(() => dateAnniversaire("2026-10-06", 1, 0), /Jour d'ancrage invalide/);
  assert.throws(() => dateAnniversaire("2026-10-06", 1, 32), /Jour d'ancrage invalide/);
});

test("la mise en forme d'un jour ne glisse jamais d'un jour", () => {
  // `new Date("2027-03-01")` est minuit UTC : l'afficher dans un fuseau
  // négatif rendrait « 28 février ».
  assert.equal(formaterJourFr("2027-03-01"), "1 mars 2027");
  assert.equal(formaterJourFr("2026-10-06"), "6 octobre 2026");
  assert.equal(formaterJourFr("2026-01-01"), "1 janvier 2026");
});

// ══════════════════════════════════════════════════════════════════
// LE PLAN
// ══════════════════════════════════════════════════════════════════

test("AVEC ESSAI : un mois gratuit, premier prélèvement à la fin", () => {
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: true, cycle: "monthly" });

  assert.equal(ESSAI_MOIS, 1);
  assert.equal(plan.finEssaiLe, "2026-10-06");
  assert.equal(plan.premierPrelevementLe, "2026-10-06");
  assert.equal(plan.echeanceSuivanteLe, "2026-11-06");
  assert.equal(plan.jourAnniversaire, 6);
});

test("SANS ESSAI : le premier prélèvement est le jour même", () => {
  // « S'il s'abonne il paie le premier mois direct » — pour qui renonce
  // à l'essai, c'est aujourd'hui, pas dans trente jours.
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: false, cycle: "monthly" });

  assert.equal(plan.finEssaiLe, null);
  assert.equal(plan.premierPrelevementLe, "2026-09-06");
  assert.equal(plan.echeanceSuivanteLe, "2026-10-06");
});

test("UN ESSAI OUVERT LE 31 JANVIER EST PRÉLEVÉ LE 28 FÉVRIER, PUIS LE 31 MARS", () => {
  // Le cas qui dément « un mois = trente jours » : cet essai-là dure
  // vingt-huit jours, et la deuxième échéance revient au 31.
  const plan = planifierEssai({ souscritLe: "2026-01-31", avecEssai: true, cycle: "monthly" });

  assert.equal(plan.finEssaiLe, "2026-02-28");
  assert.equal(plan.premierPrelevementLe, "2026-02-28");
  assert.equal(plan.echeanceSuivanteLe, "2026-03-31");
  assert.equal(plan.jourAnniversaire, 31, "l'ancre reste 31, elle n'est pas devenue 28");
});

test("À L'ANNÉE : l'essai reste d'UN mois, l'échéance suivante est à douze", () => {
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: true, cycle: "yearly" });

  assert.equal(plan.finEssaiLe, "2026-10-06");
  assert.equal(plan.premierPrelevementLe, "2026-10-06");
  assert.equal(plan.echeanceSuivanteLe, "2027-10-06");
});

test("L'ESSAI EST RÉSERVÉ AU PREMIER ABONNEMENT, résiliation comprise", () => {
  // `saas_start_subscription()` refuse toute entreprise portant déjà une
  // ligne d'abonnement, CANCELLED COMPRISE. Rouvrir l'essai après une
  // résiliation offrirait, en plus, un mois par résiliation.
  assert.equal(essaiDisponible(null), true);
  assert.equal(essaiDisponible(undefined), true);
  assert.equal(essaiDisponible({ status: "cancelled" }), false);
  assert.equal(essaiDisponible({ status: "trialing" }), false);
});

// ══════════════════════════════════════════════════════════════════
// L'ENGAGEMENT CROISÉ AVEC L'ESSAI
// ══════════════════════════════════════════════════════════════════

test("L'ESSAI NE COMPTE PAS DANS L'ENGAGEMENT : les deux partent du premier prélèvement", () => {
  // ══════════════════════════════════════════════════════════════
  // LA RÈGLE DU SOCLE, ET SON CHIFFRE
  // ══════════════════════════════════════════════════════════════
  //
  // Poser la remise le jour de la souscription ferait payer ONZE mois à
  // 49,90 € au lieu de douze, et le douzième basculerait au tarif
  // public sans que personne l'ait annoncé. L'engagement démarre donc
  // au premier prélèvement — et la base le vérifie de son côté
  // (`subscription_discounts_trial_guard`).
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: true, cycle: "monthly" });

  assert.equal(debutEngagement(plan), "2026-10-06");
  assert.equal(finEngagement(debutEngagement(plan), 12), "2027-10-06");
});

test("SANS ESSAI, l'engagement démarre aujourd'hui — la règle est la même", () => {
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: false, cycle: "monthly" });

  assert.equal(debutEngagement(plan), "2026-09-06");
  assert.equal(finEngagement(debutEngagement(plan), 12), "2027-09-06");
});

test("l'engagement rejoue l'arithmétique de mois de Postgres, bissextile comprise", () => {
  // 0081 pose `commitment_ends_on := starts_on + interval 'N months'`.
  // Le seul cas où douze mois ne retombent pas sur le même quantième
  // est le 29 février.
  assert.equal(finEngagement("2028-02-29", 12), "2029-02-28");
  assert.equal(finEngagement("2026-01-31", 12), "2027-01-31");
});

// ══════════════════════════════════════════════════════════════════
// L'ANNONCE
// ══════════════════════════════════════════════════════════════════

const MONTANTS = { totalHtCents: 7990, totalTtcCents: 9588 };

test("L'ANNONCE DIT UNE DATE, PAS « DANS UN MOIS »", () => {
  // C'est l'exigence entière : « Un mois gratuit, puis 79,90 € HT par
  // mois. Votre carte est enregistrée aujourd'hui et débitée le [date]. »
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: true, cycle: "monthly" });
  const a = annoncerEssai(plan, MONTANTS);

  assert.equal(a.titre, "Un mois gratuit, puis 79,90 € HT / mois.");
  assert.match(a.carte, /enregistrée aujourd'hui et débitée le 6 octobre 2026/);
  assert.match(a.prelevement, /95,88 € TTC le 6 octobre 2026/);
  // Pas de « dans un mois » nulle part : cette formule ne se retrouve
  // sur aucun relevé bancaire.
  assert.doesNotMatch(a.phrase, /dans un mois/i);
});

test("LES DEUX MONTANTS SONT DITS, chacun avec SA mention", () => {
  // Le hors taxes est ce qui sera facturé, le toutes taxes ce qui
  // apparaîtra sur le relevé. Découvrir que 79,90 sont devenus 95,88
  // est la première cause de contestation.
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: true, cycle: "monthly" });
  const a = annoncerEssai(plan, MONTANTS);

  assert.match(a.phrase, /79,90 € HT/);
  assert.match(a.phrase, /95,88 € TTC/);
});

test("L'ANNONCE DIT AUSSI COMMENT SORTIR, ET JUSQU'À QUAND", () => {
  // « Carte obligatoire mais non débitée » n'a de sens que si l'on dit
  // dans la foulée qu'on peut arrêter avant.
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: true, cycle: "monthly" });
  const a = annoncerEssai(plan, MONTANTS);

  assert.notEqual(a.sortie, null);
  assert.match(a.sortie ?? "", /avant le 6 octobre 2026/);
});

test("SANS ESSAI, l'annonce ne promet aucune gratuité et ne parle pas de sortie", () => {
  const plan = planifierEssai({ souscritLe: "2026-09-06", avecEssai: false, cycle: "monthly" });
  const a = annoncerEssai(plan, MONTANTS);

  assert.doesNotMatch(a.phrase, /gratuit/i);
  assert.match(a.carte, /débitée aujourd'hui, 6 septembre 2026/);
  assert.equal(a.sortie, null, "il n'y a rien à arrêter avant : le débit est aujourd'hui");
});

test("LE « 31 DE CHAQUE MOIS » N'EXISTE PAS, ET LA PHRASE LE DIT", () => {
  // Le taire serait promettre une date qui manquera quatre fois par an.
  const plan = planifierEssai({ souscritLe: "2026-01-31", avecEssai: true, cycle: "monthly" });
  const a = annoncerEssai(plan, MONTANTS);

  assert.match(a.prelevement, /le 31 de chaque mois \(ou le dernier jour du mois/);

  // …et on ne charge pas la phrase quand la question ne se pose pas.
  const simple = planifierEssai({ souscritLe: "2026-09-06", avecEssai: true, cycle: "monthly" });
  assert.match(annoncerEssai(simple, MONTANTS).prelevement, /puis le 6 de chaque mois\./);
});

// ══════════════════════════════════════════════════════════════════
// CE QUI PART AU PRESTATAIRE
// ══════════════════════════════════════════════════════════════════

test("L'HORODATAGE DE FIN D'ESSAI TOMBE LE MÊME JOUR À PARIS ET EN UTC", () => {
  // ══════════════════════════════════════════════════════════════
  // POURQUOI SIX HEURES, ET PAS MINUIT
  // ══════════════════════════════════════════════════════════════
  //
  // Le prestataire veut un instant, pas un jour — et l'instant décide
  // de la date qui figurera sur le relevé. Minuit UTC tombe la veille à
  // Paris en hiver ; 23 h tombe le lendemain en UTC l'été. 06:00 UTC
  // est le même jour civil des deux côtés, toute l'année.
  const horodatage = horodatageFinEssai("2026-10-06");
  const instant = new Date(horodatage * 1000);

  assert.equal(instant.toISOString(), "2026-10-06T06:00:00.000Z");

  const aParis = new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  assert.equal(aParis, "2026-10-06", "le même jour à Paris qu'en UTC");

  // Et en plein hiver, quand Paris est à UTC+1 seulement.
  const hiver = new Date(horodatageFinEssai("2027-01-31") * 1000);
  assert.equal(hiver.toISOString(), "2027-01-31T06:00:00.000Z");
  assert.equal(
    new Intl.DateTimeFormat("fr-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(hiver),
    "2027-01-31",
  );
});

test("l'horodatage est en SECONDES entières, jamais en millisecondes", () => {
  // Une erreur de facteur mille placerait la fin d'essai en 1970 : la
  // carte serait débitée dans la seconde qui suit la souscription.
  const horodatage = horodatageFinEssai("2026-10-06");
  assert.ok(Number.isInteger(horodatage));
  assert.ok(horodatage > 1_700_000_000, "un horodatage en secondes, pas en millisecondes");
  assert.ok(horodatage < 100_000_000_000);
});
