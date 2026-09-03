import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysIso, chargeDuJour, estUnJourIso, formatDuree, formatWeekRange,
  groupByDay, interventionDaysIso, mondayIsoOf, moveToDayParis,
  overlapHours, parisAtHour, parisDay, parisMidnight,
  verdictDeNote, weekDaysIso, NOTE_LONGUEUR_MAX,
  type Intervention,
} from "./types.ts";

/**
 * LE PLANNING SE JOUE À PARIS.
 *
 * Ces tests s'exécutent quel que soit le fuseau de la machine — c'est
 * tout leur intérêt. Le serveur tourne en UTC, le navigateur du
 * paysagiste à Paris, et l'intégration continue Dieu sait où : les
 * trois doivent ranger une intervention dans la même colonne.
 */

function intervention(patch: Partial<Intervention> = {}): Intervention {
  return {
    id: "a", kind: "work", title: "Chantier", status: "scheduled",
    instructions: null, notes: null,
    scheduled_start: null, scheduled_end: null,
    actual_start: null, actual_end: null,
    team_id: null, project_id: null, customer_id: null, site_id: null,
    signed_by_name: null, signed_at: null,
    ...patch,
  };
}

/** Ce que la carte AFFICHE : l'heure de Paris, pas celle de la machine. */
const HEURE_PARIS = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
});
function heureParis(iso: string): string {
  return HEURE_PARIS.format(new Date(iso));
}

// --- Le jour de Paris -------------------------------------------

test("minuit trente à Paris est encore la veille en UTC, et c'est bien le nouveau jour", () => {
  // 15 juin 2026 à 22 h 30 UTC = mardi 16 juin à 00 h 30 à Paris.
  // L'ancien code répondait « 15 » et rangeait la carte au lundi.
  assert.equal(parisDay(new Date("2026-06-15T22:30:00Z")), "2026-06-16");
});

test("vingt-trois heures trente à Paris reste le même jour", () => {
  // Le symétrique : 21 h 30 UTC = lundi 23 h 30 à Paris.
  assert.equal(parisDay(new Date("2026-06-15T21:30:00Z")), "2026-06-15");
});

test("minuit à Paris tombe à 22 h UTC en été et 23 h en hiver", () => {
  assert.equal(parisMidnight("2026-06-16").toISOString(), "2026-06-15T22:00:00.000Z");
  assert.equal(parisMidnight("2026-01-16").toISOString(), "2026-01-15T23:00:00.000Z");
});

test("le dimanche du changement d'heure ne décale pas l'heure de rendez-vous", () => {
  // 29 mars 2026 : la France passe à l'heure d'été à 2 h du matin. Sans
  // la seconde passe du calcul, 8 h aurait été rendu comme 9 h.
  assert.equal(parisDay(new Date(parisAtHour("2026-03-29", 8))), "2026-03-29");
  const heureLue = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  }).format(new Date(parisAtHour("2026-03-29", 8)));
  assert.equal(heureLue, "08:00");
});

test("minuit pile appartient au jour qui commence, pas à celui qui finit", () => {
  assert.equal(parisDay(parisMidnight("2026-06-16")), "2026-06-16");
});

// --- Les jours de la semaine ------------------------------------

test("la semaine commence un lundi, y compris quand on demande un dimanche", () => {
  // Un dimanche, `getDay()` vaut 0 et la naïveté renverrait ce
  // dimanche-là : toute la semaine serait décalée d'un jour.
  assert.equal(mondayIsoOf("2026-08-30"), "2026-08-24");
});

test("un lundi est son propre lundi", () => {
  assert.equal(mondayIsoOf("2026-08-24"), "2026-08-24");
});

test("la semaine fait sept jours, du lundi au dimanche", () => {
  const jours = weekDaysIso("2026-08-31");
  assert.equal(jours.length, 7);
  assert.equal(jours[0], "2026-08-31");
  assert.equal(jours[6], "2026-09-06");
});

test("l'arithmétique des jours traverse les mois et les années", () => {
  assert.equal(addDaysIso("2026-08-31", 1), "2026-09-01");
  assert.equal(addDaysIso("2027-01-01", -1), "2026-12-31");
  assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29");
});

test("une semaine à cheval sur deux mois s'annonce en toutes lettres", () => {
  assert.equal(formatWeekRange("2026-09-01"), "1 – 7 septembre 2026");
  assert.equal(formatWeekRange("2026-08-31"), "31 août – 6 septembre 2026");
  assert.equal(formatWeekRange("2026-12-28"), "28 décembre 2026 – 3 janvier 2027");
});

test("un paramètre de semaine fantaisiste est refusé plutôt qu'interprété", () => {
  assert.equal(estUnJourIso("2026-09-01"), true);
  assert.equal(estUnJourIso("2026-13-01"), false);
  assert.equal(estUnJourIso("la semaine prochaine"), false);
  assert.equal(estUnJourIso(undefined), false);
  assert.equal(estUnJourIso(["2026-09-01"]), false);
});

// --- Le regroupement par jour -----------------------------------

const semaine = weekDaysIso("2026-08-24");

test("une intervention d'un jour occupe une seule colonne", () => {
  const iv = intervention({
    scheduled_start: "2026-08-25T06:00:00Z", // 08 h à Paris
    scheduled_end: "2026-08-25T14:00:00Z",   // 16 h à Paris
  });
  assert.deepEqual(interventionDaysIso(iv, semaine), ["2026-08-25"]);
});

test("un chantier de soixante-dix heures occupe QUATRE colonnes", () => {
  // Le mensonge de l'ancien écran, sur les données réelles : cette
  // intervention n'apparaissait que le lundi, et le mercredi paraissait
  // libre alors que l'équipe y était mobilisée.
  const iv = intervention({
    scheduled_start: "2026-08-24T12:00:00Z",
    scheduled_end: "2026-08-27T10:00:00Z",
  });
  assert.deepEqual(
    interventionDaysIso(iv, semaine),
    ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"],
  );
});

test("une fin à minuit pile n'occupe pas le jour suivant", () => {
  const iv = intervention({
    scheduled_start: "2026-08-24T12:00:00Z",
    // Minuit à Paris entre le 25 et le 26.
    scheduled_end: "2026-08-25T22:00:00Z",
  });
  assert.deepEqual(interventionDaysIso(iv, semaine), ["2026-08-24", "2026-08-25"]);
});

test("une intervention sans fin n'occupe que son jour de début", () => {
  const iv = intervention({ scheduled_start: "2026-08-26T06:00:00Z" });
  assert.deepEqual(interventionDaysIso(iv, semaine), ["2026-08-26"]);
});

test("une intervention sans date n'occupe aucune colonne", () => {
  assert.deepEqual(interventionDaysIso(intervention(), semaine), []);
});

test("le chantier annonce son rang sur SA durée, pas sur la fenêtre affichée", () => {
  // Commencé le samedi 22, il déborde sur la semaine du 24. La carte du
  // lundi est le jour 3 sur 5, pas le jour 1 sur 3.
  const iv = intervention({
    id: "long",
    scheduled_start: "2026-08-22T06:00:00Z",
    scheduled_end: "2026-08-26T14:00:00Z",
  });
  const parJour = groupByDay([iv], semaine);
  const lundi = parJour.get("2026-08-24")!;
  assert.equal(lundi.length, 1);
  assert.equal(lundi[0].rang, 3);
  assert.equal(lundi[0].jours, 5);
  assert.equal(lundi[0].premier, false);
  assert.equal(parJour.get("2026-08-26")![0].dernier, true);
});

test("les cartes d'un jour sont triées par heure, puis par équipe", () => {
  const tot = intervention({ id: "tot", team_id: "b", scheduled_start: "2026-08-25T05:00:00Z" });
  const tard = intervention({ id: "tard", team_id: "a", scheduled_start: "2026-08-25T09:00:00Z" });
  const memeHeureA = intervention({ id: "x", team_id: "a", scheduled_start: "2026-08-25T05:00:00Z" });

  const noms: Record<string, string> = { a: "ÉQUIPE 1", b: "ÉQUIPE 2" };
  const parJour = groupByDay(
    [tard, tot, memeHeureA], semaine,
    (id) => (id ? noms[id] ?? "" : ""),
  );
  assert.deepEqual(
    parJour.get("2026-08-25")!.map((c) => c.intervention.id),
    ["x", "tot", "tard"],
  );
});

test("chaque jour de la semaine existe dans le regroupement, même vide", () => {
  const parJour = groupByDay([], semaine);
  assert.equal(parJour.size, 7);
  for (const jour of semaine) assert.deepEqual(parJour.get(jour), []);
});

// --- La charge d'une journée ------------------------------------

test("une journée additionne les heures RÉELLEMENT passées ce jour-là", () => {
  const iv = intervention({
    scheduled_start: "2026-08-24T12:00:00Z", // lundi 14 h à Paris
    scheduled_end: "2026-08-27T10:00:00Z",   // jeudi 12 h à Paris
  });
  // Le lundi : de 14 h à minuit, dix heures. Pas soixante-dix.
  assert.equal(overlapHours(iv, "2026-08-24"), 10);
  // Le mardi : la journée entière.
  assert.equal(overlapHours(iv, "2026-08-25"), 24);
  // Le jeudi : de minuit à 12 h.
  assert.equal(overlapHours(iv, "2026-08-27"), 12);
  // Le vendredi : rien du tout, et « rien » n'est pas « zéro heure ».
  assert.equal(overlapHours(iv, "2026-08-28"), null);
});

test("une durée inconnue reste inconnue, elle ne devient jamais zéro", () => {
  const sansFin = intervention({ id: "s", scheduled_start: "2026-08-25T06:00:00Z" });
  assert.equal(overlapHours(sansFin, "2026-08-25"), null);

  const parJour = groupByDay([sansFin], semaine);
  const charge = chargeDuJour(parJour.get("2026-08-25")!, "2026-08-25");
  assert.equal(charge.compte, 1);
  assert.equal(charge.heures, null, "surtout pas 0 : la journée n'est pas vide");
  assert.equal(charge.incomplet, true);
});

test("une journée mêlant durées connues et inconnues annonce un minorant", () => {
  const connue = intervention({
    id: "c",
    scheduled_start: "2026-08-25T06:00:00Z",
    scheduled_end: "2026-08-25T14:00:00Z",
  });
  const inconnue = intervention({ id: "i", scheduled_start: "2026-08-25T07:00:00Z" });
  const parJour = groupByDay([connue, inconnue], semaine);
  const charge = chargeDuJour(parJour.get("2026-08-25")!, "2026-08-25");
  assert.equal(charge.compte, 2);
  assert.equal(charge.heures, 8);
  assert.equal(charge.incomplet, true);
});

test("un chantier de plusieurs jours ne fait peser aucune heure sur la journée", () => {
  // Le défaut corrigé : le recouvrement CALENDAIRE d'un jour
  // intermédiaire vaut vingt-quatre heures, et le mardi s'annonçait
  // « 2 · 32 h » sur les seules données réelles du produit. Personne
  // ne travaille de minuit à minuit.
  const chantier = intervention({
    id: "ch",
    scheduled_start: "2026-08-24T12:00:00Z", // lundi 14 h à Paris
    scheduled_end: "2026-08-27T10:00:00Z",   // jeudi 12 h à Paris
  });
  const parJour = groupByDay([chantier], semaine);

  const mardi = chargeDuJour(parJour.get("2026-08-25")!, "2026-08-25");
  assert.equal(mardi.compte, 1);
  assert.equal(mardi.heures, null, "surtout pas 24 : ce n'est pas une journée de travail");
  assert.equal(mardi.incomplet, true);

  // Le lundi non plus, alors qu'il porte le vrai début : dix heures de
  // recouvrement de 14 h à minuit ne sont pas dix heures de chantier.
  const lundi = chargeDuJour(parJour.get("2026-08-24")!, "2026-08-24");
  assert.equal(lundi.heures, null);
  assert.equal(lundi.incomplet, true);
});

test("le chantier de plusieurs jours n'efface pas les heures de ses voisines", () => {
  const chantier = intervention({
    id: "ch",
    scheduled_start: "2026-08-24T12:00:00Z",
    scheduled_end: "2026-08-27T10:00:00Z",
  });
  const journee = intervention({
    id: "j",
    scheduled_start: "2026-08-25T06:00:00Z", // mardi 8 h – 16 h à Paris
    scheduled_end: "2026-08-25T14:00:00Z",
  });
  const parJour = groupByDay([chantier, journee], semaine);
  const mardi = chargeDuJour(parJour.get("2026-08-25")!, "2026-08-25");

  assert.equal(mardi.compte, 2);
  // Huit heures sûres, et le « + » qui dit qu'il y a plus.
  assert.equal(mardi.heures, 8);
  assert.equal(mardi.incomplet, true);
});

test("une journée vide ne prétend pas peser zéro heure", () => {
  const charge = chargeDuJour([], "2026-08-29");
  assert.equal(charge.compte, 0);
  assert.equal(charge.heures, null);
  assert.equal(charge.incomplet, false);
});

test("les heures s'écrivent en heures et minutes, jamais en décimales", () => {
  assert.equal(formatDuree(8), "8 h");
  assert.equal(formatDuree(7.5), "7 h 30");
  assert.equal(formatDuree(1.25), "1 h 15");
  assert.equal(formatDuree(0.5), "0 h 30");
});

// --- Le déplacement conserve l'heure et la durée ----------------

test("déplacer du mardi au jeudi ne fait pas commencer à minuit", () => {
  // Le point le plus fragile de l'écran, et le premier à casser.
  const depart = "2026-08-25T06:00:00Z"; // mardi 08 h à Paris
  const arrivee = moveToDayParis(depart, "2026-08-27");
  assert.equal(arrivee, "2026-08-27T06:00:00.000Z");
  assert.equal(parisDay(new Date(arrivee)), "2026-08-27");
});

test("une intervention de 00 h 30 ne recule pas d'un jour", () => {
  // Le bogue silencieux de l'ancien `setFullYear` : 22 h 30 UTC est un
  // instant de la veille, réécrire sa date UTC déposait la carte un
  // jour trop tôt — et pour ces cartes-là seulement.
  const depart = "2026-06-15T22:30:00Z"; // mardi 16 juin, 00 h 30 à Paris
  const arrivee = moveToDayParis(depart, "2026-06-18");
  assert.equal(parisDay(new Date(arrivee)), "2026-06-18");
  assert.equal(arrivee, "2026-06-17T22:30:00.000Z");
});

test("l'heure de Paris est conservée d'un fuseau d'hiver à un fuseau d'été", () => {
  // 8 h le 15 janvier reste 8 h le 15 juillet, alors que l'écart à UTC
  // change d'une heure entre les deux.
  const janvier = parisAtHour("2026-01-15", 8);
  const juillet = moveToDayParis(janvier, "2026-07-15");
  const heure = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
  });
  assert.equal(heure.format(new Date(juillet)), "08:00");
  assert.equal(parisDay(new Date(juillet)), "2026-07-15");
});

test("déposer une carte SUR le dimanche de bascule ne lui vole pas une heure", () => {
  // Le 25 octobre 2026, l'horloge de Paris recule : cette journée-là
  // fait vingt-cinq heures. Reporter l'ÉCART À MINUIT y posait la
  // carte à 7 h. C'est le chiffre affiché — « 08:00 » — qu'il faut
  // conserver, pas une durée depuis minuit.
  const depart = parisAtHour("2026-06-16", 8);
  assert.equal(heureParis(moveToDayParis(depart, "2026-10-25")), "08:00");
});

test("l'en retirer ne lui en ajoute pas une non plus", () => {
  // Le trajet inverse, et c'est le plus fréquent : une carte du
  // dimanche repoussée au lundi. L'écart à minuit valait vingt-cinq
  // heures et la déposait à 9 h.
  const surBascule = parisAtHour("2026-10-25", 8);
  assert.equal(heureParis(moveToDayParis(surBascule, "2026-10-26")), "08:00");
});

test("le dimanche de printemps, une heure n'existe pas — on décale du saut, pas du jour", () => {
  // Le 29 mars 2026, l'horloge saute de 2 h à 3 h. Une carte de 8 h
  // reste à 8 h. Une carte de 2 h 30 n'a aucun instant ce jour-là :
  // elle se pose à 3 h 30, décalée du saut lui-même — mais au bon
  // JOUR, et c'est ce qui compte pour un planning.
  assert.equal(heureParis(moveToDayParis(parisAtHour("2026-06-16", 8), "2026-03-29")), "08:00");

  const deuxHeuresTrente = new Date(
    Date.parse(parisAtHour("2026-06-16", 2)) + 30 * 60_000,
  ).toISOString();
  const pose = moveToDayParis(deuxHeuresTrente, "2026-03-29");
  assert.equal(heureParis(pose), "03:30");
  assert.equal(parisDay(new Date(pose)), "2026-03-29");
});

test("une intervention sans date déposée sur un jour commence à 8 h", () => {
  const arrivee = moveToDayParis(null, "2026-08-27");
  assert.equal(arrivee, parisAtHour("2026-08-27", 8));
});

test("la durée est conservée par le calcul de l'appelant, y compris à cheval", () => {
  // `moveIntervention` ajoute la durée d'origine au nouveau début. On
  // vérifie ici que la reconstruction rend bien les mêmes 70 heures.
  const debut = "2026-08-24T12:00:00Z";
  const fin = "2026-08-27T10:00:00Z";
  const dureeMs = Date.parse(fin) - Date.parse(debut);

  const nouveauDebut = moveToDayParis(debut, "2026-09-07");
  const nouvelleFin = new Date(Date.parse(nouveauDebut) + dureeMs).toISOString();
  assert.equal(Date.parse(nouvelleFin) - Date.parse(nouveauDebut), dureeMs);
  assert.equal(parisDay(new Date(nouveauDebut)), "2026-09-07");
});

// --- Le bornage des notes ---------------------------------------

test("une note vide est une suppression, pas une erreur", () => {
  // Sans ce verdict, effacer le texte et valider renverrait le nom de
  // la contrainte SQL `planning_day_notes_body_bounded`.
  assert.deepEqual(verdictDeNote(""), { action: "vide" });
  assert.deepEqual(verdictDeNote("   "), { action: "vide" });
  assert.deepEqual(verdictDeNote("\n\t "), { action: "vide" });
});

test("une note est enregistrée débarrassée de ses blancs", () => {
  assert.deepEqual(
    verdictDeNote("  livraison paillage 14 h  "),
    { action: "enregistrer", body: "livraison paillage 14 h" },
  );
});

test("cinq cents caractères passent, cinq cent un sont refusés en français", () => {
  const juste = "a".repeat(NOTE_LONGUEUR_MAX);
  assert.deepEqual(verdictDeNote(juste), { action: "enregistrer", body: juste });

  const trop = verdictDeNote("a".repeat(NOTE_LONGUEUR_MAX + 1));
  assert.equal(trop.action, "refuser");
  assert.match(trop.action === "refuser" ? trop.raison : "", /501/);
});

test("le bornage se juge APRÈS avoir retiré les blancs", () => {
  // Cinq cents caractères entourés d'espaces tiennent en base : c'est
  // le texte nettoyé qui y est écrit.
  const verdict = verdictDeNote(`  ${"a".repeat(NOTE_LONGUEUR_MAX)}  `);
  assert.equal(verdict.action, "enregistrer");
});

test("le plafond du web est plus sévère que celui de la base, jamais l'inverse", () => {
  // Postgres compte des CARACTÈRES, JavaScript des unités UTF-16 : un
  // émoji pèse deux ici et un là-bas. Ce qui passe ici passe donc en
  // base ; le contraire aurait été le piège.
  const emojis = "🌳".repeat(250); // 500 unités UTF-16, 250 caractères
  assert.equal(emojis.length, NOTE_LONGUEUR_MAX);
  assert.equal(verdictDeNote(emojis).action, "enregistrer");
});
