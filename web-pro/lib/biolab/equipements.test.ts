import { test } from "node:test";
import assert from "node:assert/strict";

import {
  composantsDe,
  depassement,
  direObjets,
  fraicheurEtat,
  minutesEnHeure,
  resumerProgramme,
  SEUIL_ETAT_ANCIEN_HEURES,
  type Cycle,
  type LigneSupervision,
  type VersionProgramme,
} from "./equipements.ts";

/**
 * CE QUE CE FICHIER ÉPROUVE : QU'UN ÉTAT AFFICHÉ NE MENTE PAS.
 *
 * Un écran de supervision a une seule façon grave de se tromper, et
 * elle ne provoque aucune erreur : affirmer qu'une machine est dans un
 * état alors qu'on n'en sait rien. « Pompe en marche » lu sur une ligne
 * écrite il y a trois semaines est faux, et c'est sur ce mot qu'on
 * décide de ne pas se déplacer jusqu'au laboratoire.
 *
 * Les cas ci-dessous fixent les trois endroits où ce mensonge peut
 * s'installer : la date manquante, le zéro qui n'est pas un zéro, et la
 * durée qu'on ne peut pas comparer.
 */

const MAINTENANT = new Date("2026-09-06T12:00:00Z");

function ligne(partiel: Partial<LigneSupervision> = {}): LigneSupervision {
  return {
    bioreacteur_id: "br1",
    code: "BR1",
    nom: "SCALPRUM",
    type_bioreacteur: "rita",
    emplacement: null,
    statut: "idle",
    automatisation_active: false,
    lot_en_cours_id: null,
    lot_en_cours_code: null,
    programme_actif_id: null,
    programme_actif_libelle: null,
    dernier_cycle_type: null,
    dernier_cycle_statut: null,
    dernier_cycle_fin: null,
    objets_lies: null,
    objets_en_ligne: null,
    derniere_presence_objet: null,
    plus_ancienne_presence_objet: null,
    objets_sans_presence: null,
    etat_connu_le: "2026-09-06T11:00:00Z",
    fraicheur_secondes: 3600,
    ...partiel,
  };
}

// ==================================================================
// 1. LA FRAÎCHEUR — UNE VALEUR SANS DATE EST LE CAS LE MOINS SÛR
// ==================================================================

test("sans date de relevé, l'état est déclaré ancien et non pas frais", () => {
  for (const absente of [null, undefined, "pas une date"]) {
    const fraicheur = fraicheurEtat(absente, MAINTENANT);
    assert.equal(fraicheur.ancien, true, `« ${absente} » doit être traité comme incertain`);
    assert.equal(fraicheur.heures, null);
    assert.equal(fraicheur.texte, "date de relevé inconnue");
  }
});

test("le seuil des vingt-quatre heures sépare le récent de l'ancien", () => {
  const juste = new Date(MAINTENANT.getTime() - (SEUIL_ETAT_ANCIEN_HEURES - 1) * 3_600_000);
  const trop = new Date(MAINTENANT.getTime() - (SEUIL_ETAT_ANCIEN_HEURES + 1) * 3_600_000);

  assert.equal(fraicheurEtat(juste.toISOString(), MAINTENANT).ancien, false);
  assert.equal(fraicheurEtat(trop.toISOString(), MAINTENANT).ancien, true);
});

test("la fraîcheur se dit en minutes, en heures, puis en jours", () => {
  const ilYA30min = new Date(MAINTENANT.getTime() - 30 * 60_000).toISOString();
  const ilYA3h = new Date(MAINTENANT.getTime() - 3 * 3_600_000).toISOString();
  const ilYA5j = new Date(MAINTENANT.getTime() - 5 * 86_400_000).toISOString();

  assert.equal(fraicheurEtat(ilYA30min, MAINTENANT).texte, "connu il y a 30 min");
  assert.equal(fraicheurEtat(ilYA3h, MAINTENANT).texte, "connu il y a 3 h");
  assert.equal(fraicheurEtat(ilYA5j, MAINTENANT).texte, "connu il y a 5 j");
});

test("aucune formulation ne prétend au direct", () => {
  const echantillons = [
    null,
    MAINTENANT.toISOString(),
    new Date(MAINTENANT.getTime() - 40 * 86_400_000).toISOString(),
  ];
  for (const valeur of echantillons) {
    const texte = fraicheurEtat(valeur, MAINTENANT).texte;
    assert.ok(
      !/direct|temps r|live/i.test(texte),
      `« ${texte} » ne doit rien promettre de temps réel`,
    );
  }
});

test("une horloge de téléphone en avance ne devient pas un état très ancien", () => {
  const futur = new Date(MAINTENANT.getTime() + 2 * 3_600_000).toISOString();
  const fraicheur = fraicheurEtat(futur, MAINTENANT);
  assert.equal(fraicheur.ancien, false);
  assert.equal(fraicheur.texte, "connu à l'instant");
});

// ==================================================================
// 2. « AUCUN OBJET LIÉ » N'EST PAS « ZÉRO OBJET EN LIGNE »
// ==================================================================

/**
 * La base rend délibérément NULL — et non 0 — quand aucun objet
 * connecté n'est lié. Confondre les deux ferait afficher « 0 objet
 * joignable » sur un bioréacteur manuel : une panne inventée sur un
 * appareil qui n'a jamais prétendu être connecté.
 */
test("aucun objet lié : on le dit, sans accuser l'appareil", () => {
  const sansLien = direObjets(ligne({ objets_lies: null, objets_en_ligne: null }));
  assert.equal(sansLien.texte, "Aucun objet connecté lié");
  assert.equal(sansLien.ton, "neutral", "ce n'est pas un avertissement");
});

test("tous les objets joignables : rien à signaler", () => {
  const complet = direObjets(ligne({ objets_lies: 3, objets_en_ligne: 3 }));
  assert.equal(complet.ton, "positive");
  assert.match(complet.texte, /tous joignables/);
});

test("un objet manquant est signalé, et seulement celui-là", () => {
  const partiel = direObjets(ligne({ objets_lies: 3, objets_en_ligne: 2 }));
  assert.equal(partiel.ton, "warning");
  assert.equal(partiel.texte, "1 objet sur 3 injoignable");
});

test("tous les objets injoignables reste un avertissement chiffré, pas un silence", () => {
  const aucun = direObjets(ligne({ objets_lies: 2, objets_en_ligne: 0 }));
  assert.equal(aucun.ton, "warning");
  assert.equal(aucun.texte, "2 objets sur 2 injoignables");
});

// ==================================================================
// 3. LE PROGRAMME ACTIF — AFFICHÉ, JAMAIS DÉDUIT
// ==================================================================

function version(partiel: Partial<VersionProgramme> = {}): VersionProgramme {
  return {
    id: "v1",
    version_number: 1,
    immersion_enabled: false,
    immersion_duration_seconds: null,
    immersion_interval_minutes: null,
    aeration_enabled: false,
    aeration_duration_seconds: null,
    aeration_interval_minutes: null,
    photoperiod_enabled: false,
    light_start_minutes: null,
    light_end_minutes: null,
    target_temperature: null,
    notes: null,
    ...partiel,
  };
}

test("sans programme actif, on n'affiche aucune ligne de réglage", () => {
  assert.deepEqual(resumerProgramme(null), []);
});

test("une fonction désactivée n'apparaît pas dans le résumé", () => {
  const lignes = resumerProgramme(
    version({
      immersion_enabled: true,
      immersion_duration_seconds: 60,
      immersion_interval_minutes: 240,
      aeration_enabled: false,
      aeration_duration_seconds: 30,
    }),
  );

  assert.equal(lignes.length, 1, "l'aération est désactivée : elle ne se montre pas");
  assert.equal(lignes[0], "Immersion de 60 s, toutes les 240 min");
});

test("une durée manquante se dit, elle ne se remplace pas par zéro", () => {
  const lignes = resumerProgramme(version({ immersion_enabled: true }));
  assert.equal(lignes[0], "Immersion de durée non renseignée");
});

test("les minutes depuis minuit deviennent une heure lisible", () => {
  assert.equal(minutesEnHeure(0), "00:00");
  assert.equal(minutesEnHeure(480), "08:00");
  assert.equal(minutesEnHeure(1_290), "21:30");
  assert.equal(minutesEnHeure(null), "—");
});

test("la photopériode est rendue en heures, pas en minutes brutes", () => {
  const lignes = resumerProgramme(
    version({ photoperiod_enabled: true, light_start_minutes: 480, light_end_minutes: 1_200 }),
  );
  assert.equal(lignes[0], "Éclairage de 08:00 à 20:00");
});

// ==================================================================
// 4. LE DÉPASSEMENT DE DURÉE — PAS DE COMPARAISON, PAS DE CHIFFRE
// ==================================================================

function cycle(partiel: Partial<Cycle> = {}): Cycle {
  return {
    id: "c1",
    cycle_type: "immersion",
    status: "completed",
    planned_start: null,
    actual_start: null,
    actual_end: null,
    expected_duration_seconds: null,
    actual_duration_seconds: null,
    failure_reason: null,
    ...partiel,
  };
}

test("sans durée prévue, il n'y a pas de dépassement — et surtout pas zéro", () => {
  assert.equal(depassement(cycle({ actual_duration_seconds: 120 })), null);
  assert.equal(
    depassement(cycle({ expected_duration_seconds: 0, actual_duration_seconds: 120 })),
    null,
    "diviser par zéro ne produit pas un dépassement infini",
  );
});

test("sans durée réelle, il n'y a rien à comparer", () => {
  assert.equal(depassement(cycle({ expected_duration_seconds: 60 })), null);
});

test("un cycle deux fois trop long rend bien un dépassement de 100 %", () => {
  const valeur = depassement(
    cycle({ expected_duration_seconds: 60, actual_duration_seconds: 120 }),
  );
  assert.equal(valeur, 1);
});

test("un cycle plus court que prévu rend une valeur négative, pas zéro", () => {
  const valeur = depassement(
    cycle({ expected_duration_seconds: 100, actual_duration_seconds: 50 }),
  );
  assert.equal(valeur, -0.5);
});

// ==================================================================
// 5. LES COMPOSANTS — UN JSONB SANS CONTRAINTE NE FAIT PAS TOMBER L'ÉCRAN
// ==================================================================

test("un jsonb inattendu ne casse pas la fiche", () => {
  assert.deepEqual(composantsDe(["airPump", "cultureVessel"]), ["airPump", "cultureVessel"]);
  assert.deepEqual(composantsDe(null), []);
  assert.deepEqual(composantsDe("airPump"), [], "une chaîne seule n'est pas une liste");
  assert.deepEqual(composantsDe({ airPump: true }), []);
  assert.deepEqual(
    composantsDe(["airPump", 42, null]),
    ["airPump"],
    "on garde ce qui est lisible, on jette le reste sans planter",
  );
});

// ==================================================================
// 5. « TOUS JOIGNABLES » NE SE DIT PAS SANS DATE
// ==================================================================
//
// `connected_devices.online` vaut `false` par défaut mais
// `last_seen_at` est NULLABLE : un objet marqué en ligne une fois et
// jamais revu produisait un badge vert « tous joignables », sans
// aucune date à côté. Le cas le moins sûr s'affichait comme le plus
// sûr, et c'est exactement le mensonge que ce fichier existe pour
// empêcher.

test("un objet annoncé en ligne mais jamais daté n'est pas « joignable »", () => {
  const dit = direObjets(
    ligne({ objets_lies: 1, objets_en_ligne: 1, objets_sans_presence: 1 }),
  );
  assert.equal(dit.ton, "warning");
  assert.match(dit.texte, /sans aucune date de contact/);
  assert.doesNotMatch(dit.texte, /joignable/);
});

test("un groupe partiellement daté le dit, sans passer au vert", () => {
  const dit = direObjets(
    ligne({ objets_lies: 3, objets_en_ligne: 3, objets_sans_presence: 1 }),
  );
  assert.equal(dit.ton, "warning");
  assert.match(dit.texte, /dont 1 sans date de contact/);
});

test("tous en ligne ET tous datés : là, et seulement là, c'est une bonne nouvelle", () => {
  const dit = direObjets(
    ligne({ objets_lies: 2, objets_en_ligne: 2, objets_sans_presence: 0 }),
  );
  assert.equal(dit.ton, "positive");
  assert.match(dit.texte, /tous joignables/);
});
