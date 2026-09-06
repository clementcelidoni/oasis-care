import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clefLieu,
  estRenseigne,
  indexerLieux,
  plantulesDansLeLieu,
  rapprochements,
  resumerLieu,
  type MatiereLieux,
} from "./lieux.ts";

/**
 * CE QUE CE FICHIER ÉPROUVE, ET POURQUOI CHACUN DE CES CAS A ÉTÉ CHOISI.
 *
 * L'index des lieux est fabriqué à partir de QUATRE COLONNES DE TEXTE
 * LIBRE : il n'a aucune clé étrangère pour le rattraper. Toutes ses
 * façons de se tromper sont donc silencieuses — il ne plante pas, il
 * compte faux, et un chef de culture prend une décision sur ce comptage.
 *
 * Les trois cas ci-dessous ne sont pas imaginés : ils sont MESURÉS sur
 * la base de production.
 */

const VIDE: MatiereLieux = {
  bioreacteurs: [],
  acclimatations: [],
  solutions: [],
  racks: [],
};

function bioreacteur(id: string, location: string | null) {
  return {
    id,
    code: id.toUpperCase(),
    name: `Bioréacteur ${id}`,
    status: "idle",
    location,
    current_batch_id: null,
    updated_at: "2026-09-01T10:00:00Z",
  };
}

// ==================================================================
// 1. LA CHAÎNE VIDE N'EST PAS UN LIEU
// ==================================================================

/**
 * MESURÉ EN PRODUCTION : l'unique bioréacteur porte `location = ''`.
 *
 * C'est le bogue le plus probable de tout ce fichier, et le plus
 * discret. Un test `location !== null` le laisserait passer, et l'écran
 * afficherait un lieu sans nom contenant un appareil — pendant que la
 * ligne « sans emplacement noté », celle qui aurait dit la vérité,
 * resterait vide.
 */
test("un emplacement vide ou blanc n'est pas un lieu", () => {
  assert.equal(estRenseigne(""), false);
  assert.equal(estRenseigne("   "), false);
  assert.equal(estRenseigne(null), false);
  assert.equal(estRenseigne(undefined), false);
  assert.equal(estRenseigne("Salle A"), true);
});

test("la chaîne vide range l'appareil dans « sans emplacement », pas dans un lieu anonyme", () => {
  const index = indexerLieux({
    ...VIDE,
    bioreacteurs: [bioreacteur("br1", ""), bioreacteur("br2", "Salle A")],
  });

  assert.equal(index.lieux.length, 1, "un seul lieu : « Salle A »");
  assert.equal(index.lieux[0].nom, "Salle A");
  assert.equal(index.situes, 1);
  assert.equal(index.nonSitues, 1);
  assert.deepEqual(
    index.sansEmplacement.bioreacteurs.map((b) => b.id),
    ["br1"],
  );
});

// ==================================================================
// 2. UN LIEU MAL ORTHOGRAPHIÉ RESTE UN SEUL LIEU
// ==================================================================

test("la casse, les accents et les espaces multiples ne font pas deux lieux", () => {
  assert.equal(clefLieu("Salle A"), clefLieu("salle a"));
  assert.equal(clefLieu("Salle  A"), clefLieu("Salle A"));
  assert.equal(clefLieu("  Réserve "), clefLieu("reserve"));
  // Mais deux lieux réellement différents le restent.
  assert.notEqual(clefLieu("Rack A"), clefLieu("Rack B"));
  // On ne supprime pas les espaces : « RackA » peut être un autre nom.
  assert.notEqual(clefLieu("Rack A"), clefLieu("RackA"));
});

test("les graphies fusionnent, et c'est la plus fréquente qui s'affiche", () => {
  const index = indexerLieux({
    ...VIDE,
    bioreacteurs: [
      bioreacteur("br1", "salle a"),
      bioreacteur("br2", "Salle A"),
      bioreacteur("br3", "Salle A"),
    ],
  });

  assert.equal(index.lieux.length, 1);
  assert.equal(index.lieux[0].nom, "Salle A", "la graphie majoritaire");
  assert.deepEqual(index.lieux[0].variantes, ["salle a"]);
  assert.equal(index.lieux[0].occupants, 3);
});

// ==================================================================
// 3. UNE ÉTIQUETTE DE RACK N'EST PAS UN OCCUPANT
// ==================================================================

/**
 * Une étiquette de rack ne porte AUCUN lien vers un lot — le module
 * mobile le dit lui-même (`RackTagCreationView` : « elle n'ouvre aucune
 * fiche »). La compter comme un occupant transformerait un inventaire
 * d'autocollants en inventaire de matériel, et laisserait croire qu'on
 * sait ce qu'il y a sur le rack. On ne le sait pas.
 */
test("un rack étiqueté n'ajoute aucun occupant", () => {
  const index = indexerLieux({
    ...VIDE,
    racks: [
      { id: "t1", rack_label: "Rack A3", type: "qr", active: true, last_scanned_at: null },
    ],
  });

  assert.equal(index.lieux.length, 1);
  assert.equal(index.lieux[0].nom, "Rack A3");
  assert.equal(index.lieux[0].occupants, 0, "une étiquette n'occupe rien");
  assert.equal(index.lieux[0].racks.length, 1);
  assert.equal(index.situes, 0);
  assert.equal(resumerLieu(index.lieux[0]), "", "rien à résumer : l'écran dira autre chose");
});

test("une étiquette dont le nom coïncide avec un emplacement se range dessous", () => {
  const index = indexerLieux({
    ...VIDE,
    bioreacteurs: [bioreacteur("br1", "Rack A3")],
    racks: [
      { id: "t1", rack_label: "rack a3", type: "qr", active: true, last_scanned_at: null },
    ],
  });

  assert.equal(index.lieux.length, 1, "le rack et l'emplacement sont le même endroit");
  assert.equal(index.lieux[0].occupants, 1);
  assert.equal(index.lieux[0].racks.length, 1);
});

// ==================================================================
// 4. LE RAPPROCHEMENT NE DOIT JAMAIS CONFONDRE DEUX VRAIS LIEUX
// ==================================================================

/**
 * MESURÉ EN PRODUCTION : les deux seules étiquettes de rack s'appellent
 * « BIO1 » et « Bio ».
 *
 * Le rapprochement existe pour ce cas. Mais s'il se mettait à
 * rapprocher « Rack A » et « Rack B », il ferait fusionner mentalement
 * les deux endroits qu'il ne faut jamais confondre — et il rendrait
 * toutes ses autres remarques suspectes. C'est pour cela que la règle
 * est un PRÉFIXE et rien d'autre.
 */
test("« Bio » et « BIO1 » sont rapprochés", () => {
  const index = indexerLieux({
    ...VIDE,
    racks: [
      { id: "t1", rack_label: "BIO1", type: "qr", active: true, last_scanned_at: null },
      { id: "t2", rack_label: "Bio", type: "qr", active: true, last_scanned_at: null },
    ],
  });

  const paires = rapprochements(index.lieux);
  assert.equal(paires.length, 1);
  assert.deepEqual(paires[0], { a: "Bio", b: "BIO1" }, "le plus court en premier");
});

test("« Rack A » et « Rack B » ne sont JAMAIS rapprochés", () => {
  const index = indexerLieux({
    ...VIDE,
    bioreacteurs: [bioreacteur("br1", "Rack A"), bioreacteur("br2", "Rack B")],
  });

  assert.deepEqual(rapprochements(index.lieux), []);
});

test("un nom d'une seule lettre ne rapproche rien", () => {
  const index = indexerLieux({
    ...VIDE,
    bioreacteurs: [bioreacteur("br1", "A"), bioreacteur("br2", "Atelier")],
  });

  assert.deepEqual(
    rapprochements(index.lieux),
    [],
    "« A » est trop court pour être le début de quoi que ce soit",
  );
});

// ==================================================================
// 5. LE COMPTAGE ET LE RÉSUMÉ
// ==================================================================

test("l'index compte les trois familles d'occupants, jamais les racks", () => {
  const index = indexerLieux({
    bioreacteurs: [bioreacteur("br1", "Salle A")],
    acclimatations: [
      {
        id: "ac1",
        location: "Salle A",
        status: "active",
        current_survivor_count: 40,
        initial_plantlet_count: 50,
        lot_code: "A-2026-001",
      },
    ],
    solutions: [
      {
        id: "so1",
        name: "BAP 1 mM",
        storage_location: "Salle A",
        expires_at: null,
        remaining_volume_liters: 0.5,
      },
    ],
    racks: [{ id: "t1", rack_label: "Salle A", type: "qr", active: true, last_scanned_at: null }],
  });

  const lieu = index.lieux[0];
  assert.equal(lieu.occupants, 3);
  assert.equal(index.situes, 3);
  assert.equal(index.nonSitues, 0);
  assert.equal(resumerLieu(lieu), "1 bioréacteur · 1 acclimatation en cours · 1 solution mère");
  assert.equal(plantulesDansLeLieu(lieu), 40, "les survivantes, pas les initiales");
});

test("les lieux sont triés du plus occupé au moins occupé", () => {
  const index = indexerLieux({
    ...VIDE,
    bioreacteurs: [
      bioreacteur("br1", "Petite salle"),
      bioreacteur("br2", "Grande salle"),
      bioreacteur("br3", "Grande salle"),
    ],
  });

  assert.deepEqual(
    index.lieux.map((lieu) => lieu.nom),
    ["Grande salle", "Petite salle"],
  );
});

test("un laboratoire sans aucun emplacement noté ne fabrique aucun lieu", () => {
  const index = indexerLieux({
    ...VIDE,
    bioreacteurs: [bioreacteur("br1", null), bioreacteur("br2", "")],
  });

  assert.deepEqual(index.lieux, []);
  assert.equal(index.nonSitues, 2);
  assert.equal(index.situes, 0);
});
