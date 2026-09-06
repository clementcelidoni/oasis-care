import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chaineDeTracabilite,
  maillonsRenseignes,
  premiereRupture,
  type LigneVente,
  type MatiereChaine,
} from "./tracabilite.ts";
import type { Acclimatation, FicheLot } from "./lots.ts";

/**
 * §27 — CE QUE CE FICHIER ÉPROUVE, ET C'EST UNE SEULE CHOSE.
 *
 * Qu'une chaîne incomplète SE DÉCLARE incomplète.
 *
 * C'est le seul bogue qui compte ici, et c'est un bogue invisible :
 * un écran qui affiche neuf maillons verts alors que trois d'entre eux
 * ne sont adossés à aucune colonne ne plante pas, ne prévient personne,
 * et fait répondre « oui, on sait d'où elle vient » à un producteur qui
 * ne le sait pas. Une traçabilité qui se trompe sur elle-même est pire
 * qu'une absence de traçabilité : la seconde fait chercher ailleurs.
 *
 * Les trois ruptures énoncées ici ont été MESURÉES sur la base, clé
 * étrangère par clé étrangère. Les tests les figent, pour qu'aucune ne
 * puisse être « réparée » à l'écran sans l'être en base.
 */

const LOT: FicheLot = {
  id: "lot-1",
  batch_code: "A-2026-001",
  species_name: "Alocasia scalprum",
  cultivar: null,
  culture_stage: "elongation",
  status: "active",
  started_at: "2026-01-10T00:00:00Z",
  expected_end_at: null,
  initial_explant_count: 10,
  current_count: 34,
  parent_batch_id: null,
  mother_plant_id: null,
  explant_type: null,
  culture_system: null,
  notes: null,
  medium_recipe_version_id: null,
  plants: null,
  medium_recipe_versions: null,
};

const RIEN: MatiereChaine = {
  lot: LOT,
  planteMere: null,
  planteMereHorsPortee: false,
  sousLots: [],
  acclimatations: [],
  plantesIssues: [],
  lotsPepiniere: [],
  lignesVente: [],
};

function passage(id: string): Acclimatation {
  return {
    id,
    culture_batch_id: "lot-1",
    started_at: "2026-06-01T00:00:00Z",
    initial_plantlet_count: 100,
    current_survivor_count: 82,
    substrate: "tourbe / perlite",
    humidity_program: null,
    temperature: null,
    location: "serre 2",
    status: "active",
    plants_created: false,
    notes: null,
  };
}

function vente(avecChantier: boolean, avecJardin: boolean): LigneVente {
  return {
    id: "ligne-1",
    quantity: 40,
    lot_id: "np-1",
    sales_orders: {
      id: "cmd-1",
      number: "CV-2026-004",
      status: "confirmed",
      ordered_on: "2026-08-01",
      project_id: avecChantier ? "ch-1" : null,
      crm_customers: { id: "c-1", display_name: "Jardins du Sud" },
      projects: avecChantier
        ? { id: "ch-1", name: "Terrasse Lambert", garden_id: avecJardin ? "j-1" : null }
        : null,
    },
  };
}

// ==================================================================
// 1. LA FORME DE LA CHAÎNE
// ==================================================================

test("la chaîne a les neuf maillons du §27, dans l'ordre du §27", () => {
  const maillons = chaineDeTracabilite(RIEN);
  assert.deepEqual(
    maillons.map((m) => m.clef),
    [
      "mere",
      "lot",
      "multiplication",
      "acclimatation",
      "plantes",
      "pepiniere",
      "vente",
      "jardin",
      "suivi",
    ],
  );
});

test("chaque maillon porte un état et un résumé, jamais un vide", () => {
  for (const maillon of chaineDeTracabilite(RIEN)) {
    assert.ok(maillon.titre.length > 0, maillon.clef);
    assert.ok(maillon.resume.length > 0, maillon.clef);
    assert.ok(["present", "vide", "horsPortee", "rompu"].includes(maillon.etat), maillon.clef);
  }
});

test("un lot nu ne renseigne qu'un seul maillon : lui-même", () => {
  const maillons = chaineDeTracabilite(RIEN);
  assert.equal(maillonsRenseignes(maillons), 1);
  assert.equal(maillons.find((m) => m.etat === "present")?.clef, "lot");
});

// ==================================================================
// 2. LE DERNIER MAILLON EST TOUJOURS ROMPU — ET C'EST LE POINT
// ==================================================================

test("« suivi de la plante » est rompu même quand tout le reste est là", () => {
  // Aucune plante de jardin ne référence le lot de pépinière vendu ni
  // la ligne de commande : la base ne porte pas la colonne. Un écran
  // qui marquerait ce maillon comme renseigné mentirait, et c'est
  // précisément ce que ce test interdit de faire un jour par
  // inadvertance.
  const complet: MatiereChaine = {
    ...RIEN,
    planteMere: {
      id: "p-1",
      custom_name: "Pied mère",
      common_name: null,
      scientific_name: "Alocasia scalprum",
      garden_id: null,
      is_archived: false,
    },
    sousLots: [
      { id: "l-2", batch_code: "A-2026-001-1", culture_stage: "multiplication", current_count: 20 },
    ],
    acclimatations: [passage("acc-1")],
    plantesIssues: [
      {
        id: "pl-1",
        custom_name: null,
        common_name: "Alocasia",
        scientific_name: null,
        garden_id: "j-1",
        is_archived: false,
      },
    ],
    lotsPepiniere: [
      {
        id: "np-1",
        lot_code: "NP-001",
        species_name: "Alocasia scalprum",
        current_quantity: 60,
        status: "available",
        source_biolab_batch_id: "lot-1",
      },
    ],
    lignesVente: [vente(true, true)],
  };

  const maillons = chaineDeTracabilite(complet);
  const suivi = maillons.find((m) => m.clef === "suivi");
  assert.ok(suivi);
  assert.equal(suivi.etat, "rompu");
  assert.ok(suivi.limite);

  // Huit maillons sur neuf sont renseignés, et le neuvième se déclare.
  assert.equal(maillonsRenseignes(maillons), 8);
  assert.equal(premiereRupture(maillons)?.clef, "suivi");
});

// ==================================================================
// 3. LES TROIS RUPTURES, UNE PAR UNE
// ==================================================================

test("RUPTURE 1 — la pépinière dit elle-même qu'elle enjambe l'acclimatation", () => {
  const maillons = chaineDeTracabilite({
    ...RIEN,
    acclimatations: [passage("acc-1"), passage("acc-2")],
    lotsPepiniere: [
      {
        id: "np-1",
        lot_code: "NP-001",
        species_name: "Alocasia scalprum",
        current_quantity: 60,
        status: "available",
        source_biolab_batch_id: "lot-1",
      },
    ],
  });

  const pepiniere = maillons.find((m) => m.clef === "pepiniere");
  assert.ok(pepiniere);
  assert.equal(pepiniere.etat, "present");
  // Le maillon est bien là — le lien EXISTE — mais il ne relie pas ce
  // que le §27 demande qu'il relie. La nuance doit être écrite.
  assert.ok(pepiniere.limite?.includes("RUPTURE"), pepiniere.limite);
  assert.ok(pepiniere.limite?.includes("acclimatation"), pepiniere.limite);

  // Et le maillon d'acclimatation prévient, lui aussi, que deux
  // passages seront indiscernables en aval.
  const acclimatation = maillons.find((m) => m.clef === "acclimatation");
  assert.equal(acclimatation?.etat, "present");
  assert.ok(acclimatation?.limite);
});

test("RUPTURE 2 — vendu sans chantier : le jardin est ROMPU, pas « vide »", () => {
  // La distinction est tout l'enjeu. « Vide » veut dire « saisissez-le
  // et ce sera réparé » ; « rompu » veut dire « aucune saisie ne le
  // réparera ». Ici les plantes sont bel et bien parties : dire
  // « à saisir » enverrait chercher un champ qui n'existe pas.
  const maillons = chaineDeTracabilite({
    ...RIEN,
    lotsPepiniere: [
      {
        id: "np-1",
        lot_code: "NP-001",
        species_name: "Alocasia scalprum",
        current_quantity: 60,
        status: "sold",
        source_biolab_batch_id: "lot-1",
      },
    ],
    lignesVente: [vente(false, false)],
  });

  const jardin = maillons.find((m) => m.clef === "jardin");
  assert.ok(jardin);
  assert.equal(jardin.etat, "rompu");
  assert.ok(jardin.limite?.includes("RUPTURE"));
  assert.equal(premiereRupture(maillons)?.clef, "jardin");
});

test("RUPTURE 2 bis — un chantier sans jardin ne suffit pas non plus", () => {
  const maillons = chaineDeTracabilite({
    ...RIEN,
    lotsPepiniere: [
      {
        id: "np-1",
        lot_code: "NP-001",
        species_name: "A",
        current_quantity: 1,
        status: "sold",
        source_biolab_batch_id: "lot-1",
      },
    ],
    lignesVente: [vente(true, false)],
  });
  assert.equal(maillons.find((m) => m.clef === "jardin")?.etat, "rompu");
});

test("RUPTURE 2 ter — avec un jardin, le maillon tient mais garde sa réserve", () => {
  const maillons = chaineDeTracabilite({
    ...RIEN,
    lotsPepiniere: [
      {
        id: "np-1",
        lot_code: "NP-001",
        species_name: "A",
        current_quantity: 1,
        status: "sold",
        source_biolab_batch_id: "lot-1",
      },
    ],
    lignesVente: [vente(true, true)],
  });
  const jardin = maillons.find((m) => m.clef === "jardin");
  assert.equal(jardin?.etat, "present");
  // Le jardin est DÉDUIT du chantier, pas enregistré à la livraison. Le
  // taire ferait prendre une déduction pour un fait.
  assert.ok(jardin?.limite?.includes("déduit"), jardin?.limite);
});

test("sans vente du tout, le jardin est « vide » et non « rompu »", () => {
  // Rien n'est parti : il n'y a pas de destination à chercher, donc
  // rien de cassé. Marquer « rompu » ici crierait au loup.
  const maillons = chaineDeTracabilite(RIEN);
  assert.equal(maillons.find((m) => m.clef === "jardin")?.etat, "vide");
});

// ==================================================================
// 4. LA FRONTIÈRE DE PROPRIÉTÉ
// ==================================================================

test("une plante mère référencée mais illisible est « hors de portée », pas « absente »", () => {
  // La plante EXISTE. Afficher « aucune plante mère » serait faux, et
  // enverrait quelqu'un la ressaisir alors qu'elle est déjà là, dans un
  // autre espace de travail.
  const maillons = chaineDeTracabilite({
    ...RIEN,
    lot: { ...LOT, mother_plant_id: "p-invisible" },
    planteMereHorsPortee: true,
  });
  const mere = maillons.find((m) => m.clef === "mere");
  assert.equal(mere?.etat, "horsPortee");
  assert.ok(mere?.limite?.includes("frontière de propriété"), mere?.limite);
  assert.equal(premiereRupture(maillons)?.clef, "mere");
});

test("aucune plante mère du tout : « à saisir », avec le geste à faire", () => {
  const mere = chaineDeTracabilite(RIEN).find((m) => m.clef === "mere");
  assert.equal(mere?.etat, "vide");
  assert.ok(mere?.limite?.includes("téléphone"), mere?.limite);
});

test("une plante mère lisible ouvre bien la chaîne", () => {
  const maillons = chaineDeTracabilite({
    ...RIEN,
    planteMere: {
      id: "p-1",
      custom_name: null,
      common_name: null,
      scientific_name: "Alocasia scalprum",
      garden_id: "j-1",
      is_archived: false,
    },
  });
  const mere = maillons.find((m) => m.clef === "mere");
  assert.equal(mere?.etat, "present");
  assert.equal(mere?.elements[0].libelle, "Alocasia scalprum");
});

// ==================================================================
// 5. QUELQUES DÉTAILS QUI SE VOIENT
// ==================================================================

test("une ligne de commande orpheline n'est pas comptée comme une vente", () => {
  // PostgREST peut rendre `sales_orders: null` quand la RLS a écarté la
  // commande. Compter la ligne quand même annoncerait une vente dont on
  // ne saurait rien dire.
  const maillons = chaineDeTracabilite({
    ...RIEN,
    lotsPepiniere: [
      {
        id: "np-1",
        lot_code: "NP-001",
        species_name: "A",
        current_quantity: 1,
        status: "available",
        source_biolab_batch_id: "lot-1",
      },
    ],
    lignesVente: [{ id: "l1", quantity: 5, lot_id: "np-1", sales_orders: null }],
  });
  assert.equal(maillons.find((m) => m.clef === "vente")?.etat, "vide");
  assert.equal(maillons.find((m) => m.clef === "jardin")?.etat, "vide");
});

test("le maillon du lot pointe vers sa fiche, avec ses deux comptes", () => {
  const lot = chaineDeTracabilite(RIEN).find((m) => m.clef === "lot");
  assert.equal(lot?.etat, "present");
  assert.equal(lot?.elements[0].href, "/biolab/lots/lot-1");
  assert.ok(lot?.elements[0].sousTitre?.includes("34"));
  assert.ok(lot?.elements[0].sousTitre?.includes("10"));
});

test("les sous-lots renvoient chacun vers leur propre fiche", () => {
  const maillons = chaineDeTracabilite({
    ...RIEN,
    sousLots: [
      { id: "l-2", batch_code: "A-1", culture_stage: "multiplication", current_count: 20 },
      { id: "l-3", batch_code: "A-2", culture_stage: "multiplication", current_count: 18 },
    ],
  });
  const multiplication = maillons.find((m) => m.clef === "multiplication");
  assert.equal(multiplication?.etat, "present");
  assert.deepEqual(
    multiplication?.elements.map((e) => e.href),
    ["/biolab/lots/l-2", "/biolab/lots/l-3"],
  );
});

test("premiereRupture rend null quand rien n'est cassé en amont du dernier maillon", () => {
  // Le neuvième maillon est toujours rompu ; la fonction doit donc
  // toujours rendre quelque chose sur une chaîne complète — c'est le
  // comportement attendu, et c'est ce qui empêche l'écran de conclure
  // « chaîne intacte ».
  assert.notEqual(premiereRupture(chaineDeTracabilite(RIEN)), null);
  assert.equal(premiereRupture([]), null);
});
