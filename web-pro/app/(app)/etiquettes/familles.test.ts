import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  GISEMENTS,
  SOURCES,
  dateCourte,
  estSource,
  gisement,
  gisementsDeFamille,
  libelleObjet,
  referenceCourte,
  valeursDe,
  type SourceEtiquette,
} from "./familles.ts";
import { FAMILLES } from "./familles.ts";

/**
 * LE CATALOGUE, TENU CONTRE LA MIGRATION ELLE-MÊME.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA DÉRIVE QUE CE FICHIER EMPÊCHE
 * ══════════════════════════════════════════════════════════════════
 *
 * `etiquette_creer()` (0090 § 7) refuse toute famille d'élément hors
 * d'une liste de quinze. Le catalogue de `familles.ts` recopie cette
 * liste — et une copie diverge toujours. Les deux dérives sont muettes
 * et coûteuses :
 *
 *   • UNE CLÉ ICI QUE LA BASE REFUSE — l'écran liste les objets,
 *     propose de les étiqueter, et lève une exception au clic. Le
 *     paysagiste a coché quarante lignes pour rien.
 *   • UNE CLÉ EN BASE ABSENTE D'ICI — une famille entière du § 13
 *     devient inétiquetable sans que rien ne le signale. C'est
 *     exactement ce qui s'est passé pour les vingt-neuf entrées que
 *     `smart_tags` ne savait pas désigner avant 0090.
 *
 * On relit donc la migration, comme `lib/auth/permissions.test.ts`
 * relit les siennes : le TypeScript ne peut pas interroger Postgres,
 * mais il peut lire le fichier qui le programme.
 *
 * AUCUN APPEL RÉSEAU ICI, ni dans aucun test de ce module.
 */

const MIGRATION = join(process.cwd(), "..", "supabase", "migrations", "0090_etiquettes.sql");

function sqlMigration(): string {
  return readFileSync(MIGRATION, "utf8");
}

/**
 * Les familles d'éléments que `etiquette_creer` accepte, lues dans son
 * `not in (…)`. C'est la liste faisant autorité : c'est elle qui lève.
 */
function famillesAccepteesParLaBase(): Set<string> {
  const sql = sqlMigration();
  const debut = sql.indexOf("if v_kind not in (");
  assert.notEqual(debut, -1, "Le garde-fou de etiquette_creer a changé de forme : ce test ne prouve plus rien.");
  const fin = sql.indexOf(")", debut + "if v_kind not in (".length);
  const bloc = sql.slice(debut, fin);
  return new Set([...bloc.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));
}

test("la lecture de la migration fonctionne — sinon rien n'est prouvé", () => {
  const familles = famillesAccepteesParLaBase();
  assert.ok(
    familles.size >= 10,
    `Seulement ${familles.size} familles lues dans 0090 : la lecture a échoué, pas la synchronisation.`,
  );
});

test("chaque gisement correspond à une famille que la base accepte", () => {
  const acceptees = famillesAccepteesParLaBase();
  for (const cle of SOURCES) {
    assert.ok(
      acceptees.has(cle),
      `Le gisement « ${cle} » n'est pas dans la liste de etiquette_creer : l'écran proposerait de poser une étiquette que la base refuserait.`,
    );
  }
});

test("aucune famille acceptée par la base n'est oubliée, sauf « rack » qui n'a rien à lister", () => {
  const acceptees = famillesAccepteesParLaBase();
  const manquantes = [...acceptees].filter((c) => !(SOURCES as readonly string[]).includes(c));
  assert.deepEqual(
    manquantes,
    [],
    "Une famille d'éléments existe en base et n'a pas de gisement : elle est inétiquetable depuis le web, en silence.",
  );
});

test("« rack » est bien absent des gisements, et pour la bonne raison", () => {
  // `entity_kind` compte seize valeurs en base ; la seizième vient d'un
  // `rack_label`, un libellé libre écrit sur l'iPhone. Aucune table de
  // rack n'existe : il n'y a rien à lister ni à cocher.
  assert.equal(estSource("rack"), false);
  assert.ok(
    sqlMigration().includes("then 'rack'"),
    "La colonne calculée entity_kind ne produit plus 'rack' : la raison de son absence a changé.",
  );
});

test("chaque gisement déclare un axe, une table et un tri", () => {
  for (const cle of SOURCES) {
    const g = gisement(cle);
    assert.ok(g.table.length > 0, `${cle} sans table`);
    assert.ok(g.colonnes.includes("id"), `${cle} n'aspire pas la colonne id`);
    assert.ok(g.colonnes.includes(g.tri.split(",")[0]), `${cle} trie sur une colonne qu'il ne lit pas`);
    assert.ok(["workspace", "organisation"].includes(g.axe));
    assert.ok((FAMILLES as readonly string[]).includes(g.famille));
  }
});

test("les trois familles couvrent tous les gisements, sans doublon", () => {
  const vus = FAMILLES.flatMap((f) => gisementsDeFamille(f).map((g) => g.cle));
  assert.equal(vus.length, SOURCES.length);
  assert.deepEqual([...vus].sort(), [...SOURCES].sort());
});

/**
 * LES QUATRE TABLES BIOLAB N'ONT AUCUNE SUPPRESSION DOUCE — mesuré sur
 * information_schema, pas supposé. L'absence de filtre dans ces
 * gisements est donc exacte. Si quelqu'un ajoute un `deleted_at` à
 * `culture_batches` un jour, ce test ne le verra pas ; mais il empêche
 * au moins qu'on écrive ici un filtre sur une colonne qui n'existe pas,
 * ce qui ferait échouer la requête entière.
 */
test("les gisements BioLab ne filtrent aucune suppression douce", () => {
  for (const cle of [
    "cultureBatch",
    "bioreactor",
    "mediumRecipeVersion",
    "acclimatizationBatch",
  ] as SourceEtiquette[]) {
    assert.equal(GISEMENTS[cle].suppressionDouce, null, `${cle} filtre une colonne inexistante`);
  }
});

test("les onze autres gisements filtrent bien leur suppression douce", () => {
  const sansFiltre = SOURCES.filter(
    (cle) =>
      GISEMENTS[cle].suppressionDouce === null &&
      !["cultureBatch", "bioreactor", "mediumRecipeVersion", "acclimatizationBatch"].includes(cle),
  );
  assert.deepEqual(sansFiltre, [], "Un gisement laisserait passer des éléments supprimés.");
});

// ══════════════════════════════════════════════════════════════════
// LES VALEURS IMPRIMÉES
// ══════════════════════════════════════════════════════════════════

test("un lot de pépinière imprime son code de lot, pas son identifiant", () => {
  const valeurs = valeursDe("nurseryLot", {
    id: "3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6071",
    lot_code: "LOT-2026-004",
    species_name: "Trachycarpus fortunei",
    cultivar: "Wagnerianus",
    current_quantity: 120,
    created_at: "2026-08-17T09:12:00+00:00",
    status: "growing",
    nursery_locations: { code: "S2-B3", name: "Serre 2 — B3" },
  });

  assert.equal(valeurs.numeroLot, "LOT-2026-004");
  assert.equal(valeurs.nom, "Trachycarpus fortunei");
  assert.equal(valeurs.cultivar, "Wagnerianus");
  assert.equal(valeurs.quantite, "120 u");
  assert.equal(valeurs.emplacement, "Serre 2 — B3");
  assert.equal(valeurs.date, "17/08/2026");
  // AUCUN PRIX, AUCUNE MARGE, AUCUN CLIENT. Une étiquette est collée
  // sur un pot : tout ce qu'elle porte est public par construction.
  assert.equal(Object.keys(valeurs).some((c) => /prix|cout|marge|client/i.test(c)), false);
});

test("une plante préfère le nom donné par le jardinier au nom du référentiel", () => {
  const valeurs = valeursDe("plant", {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    custom_name: "Le grand palmier de l'entrée",
    common_name: "Palmier de Chine",
    scientific_name: "Trachycarpus fortunei",
    gardens: { name: "Villa des Roches" },
  });
  assert.equal(valeurs.nom, "Le grand palmier de l'entrée");
  assert.equal(valeurs.nomScientifique, "Trachycarpus fortunei");
  assert.equal(valeurs.emplacement, "Villa des Roches");
});

test("un nom vide n'écrase pas le suivant — « ?? » ne suffirait pas", () => {
  // `custom_name: ""` est une valeur PRÉSENTE : `??` la garderait et
  // l'étiquette sortirait sans nom.
  const valeurs = valeursDe("plant", {
    id: "1",
    custom_name: "   ",
    common_name: "Olivier",
  });
  assert.equal(valeurs.nom, "Olivier");
});

test("PostgREST rend parfois un tableau pour une relation vers un : les deux formes sont lues", () => {
  const objet = valeursDe("plant", { id: "1", common_name: "Chêne", gardens: { name: "Parc" } });
  const tableau = valeursDe("plant", { id: "1", common_name: "Chêne", gardens: [{ name: "Parc" }] });
  assert.equal(objet.emplacement, "Parc");
  assert.equal(tableau.emplacement, "Parc");
});

test("un lot de culture traduit son stade au lieu d'imprimer une clé anglaise", () => {
  const valeurs = valeursDe("cultureBatch", {
    id: "1",
    batch_code: "CB-004",
    species_name: "Musa acuminata",
    culture_stage: "multiplication",
    current_count: 48,
    started_at: "2026-07-01T00:00:00Z",
  });
  assert.equal(valeurs.stade, "Multiplication");
  assert.equal(valeurs.quantite, "48 u");
  assert.equal(valeurs.date, "01/07/2026");
});

test("un lot d'acclimatation, qui n'a aucune colonne de code, en reçoit un lisible", () => {
  const avecParent = valeursDe("acclimatizationBatch", {
    id: "9f8e7d6c-5b4a-3928-1706-abcdefabcdef",
    started_at: "2026-06-15T00:00:00Z",
    culture_batches: { batch_code: "CB-004", species_name: "Musa acuminata" },
  });
  assert.equal(avecParent.numeroLot, "CB-004");
  assert.equal(avecParent.nom, "Musa acuminata");

  const orphelin = valeursDe("acclimatizationBatch", {
    id: "9f8e7d6c-5b4a-3928-1706-abcdefabcdef",
    started_at: "2026-06-15T00:00:00Z",
  });
  // Sans code, deux bacs voisins porteraient deux autocollants
  // indiscernables. On fabrique une référence courte et UNIQUE.
  assert.equal(orphelin.numeroLot, "ACC-9F8E7D6C");
  assert.notEqual(orphelin.numeroLot, avecParent.numeroLot);
});

test("le matériel cite son numéro interne avant son numéro de série", () => {
  assert.equal(
    valeursDe("equipment", { id: "1", name: "Tondeuse", internal_number: "M-018", serial_number: "SN-9931" })
      .numeroLot,
    "M-018",
  );
  assert.equal(
    valeursDe("equipment", { id: "1", name: "Tondeuse", serial_number: "SN-9931" }).numeroLot,
    "SN-9931",
  );
});

test("une date se lit sans passer par un fuseau horaire", () => {
  // Le piège : `toLocaleDateString` sur « 2026-01-01T00:30:00Z » écrit
  // 2025 dans un fuseau à l'ouest. Sur une étiquette de pépinière,
  // c'est une année de production fausse.
  assert.equal(dateCourte("2026-01-01T00:30:00Z"), "01/01/2026");
  assert.equal(dateCourte("2026-12-31T23:59:59+02:00"), "31/12/2026");
  assert.equal(dateCourte("2026-09-05"), "05/09/2026");
  assert.equal(dateCourte(null), null);
  assert.equal(dateCourte("pas une date"), null);
});

test("une référence courte est stable et sans tirets", () => {
  assert.equal(referenceCourte("9f8e7d6c-5b4a-3928-1706-abcdefabcdef", "REC"), "REC-9F8E7D6C");
  assert.equal(referenceCourte(null, "REC"), null);
});

test("le libellé de sélection est plus bavard que le nom imprimé, et sans doublon", () => {
  const libelle = libelleObjet("nurseryLot", {
    id: "1",
    lot_code: "LOT-1",
    species_name: "Olea europaea",
    cultivar: "Olea europaea",
  });
  // Le cultivar répète l'espèce : on ne l'imprime pas deux fois.
  assert.equal(libelle, "LOT-1 — Olea europaea");
});

test("un objet sans aucun nom ne rend pas une chaîne vide", () => {
  assert.equal(libelleObjet("garden", { id: "1" }), "Jardin");
  assert.equal(libelleObjet("pond", {}), "Bassin");
});
