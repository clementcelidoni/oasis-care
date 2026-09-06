import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  AXES,
  SEAU_PHOTOS,
  axeValide,
  foyers,
  nommeurDeBioreacteur,
  nommeurDeVersion,
  suspicions,
  troublesObserves,
  ventiler,
} from "./contaminations.ts";
import { direTaux } from "./referentiel.ts";
import type { LigneInspection, LigneLot } from "./statistiques.ts";
import type { LigneRecette, LigneVersion } from "./recettes.ts";

/**
 * CE QUE CE FICHIER PROTÈGE.
 *
 * L'écran des contaminations répond à trois questions — quoi, où,
 * depuis quand — et chacune a sa façon d'être fausse :
 *
 *   • QUOI : compter une suspicion comme une contamination.
 *   • OÙ : promettre un axe qui n'existe pas dans les données. Ce
 *     fichier vérifie donc aussi qu'on n'a PAS ajouté « par rack », «
 *     par salle » ou « par opérateur » — trois axes que la base ne
 *     porte pas (voir le commentaire d'en-tête de `contaminations.ts`
 *     pour la mesure).
 *   • DEPUIS QUAND : prendre la DERNIÈRE confirmation pour la
 *     première, ce qui rajeunirait un foyer installé depuis six
 *     semaines.
 */

const ICI = dirname(fileURLToPath(import.meta.url));

function lot(partiel: Partial<LigneLot> & { id: string }): LigneLot {
  return {
    batch_code: `L-${partiel.id}`,
    species_name: "Alocasia scalprum",
    cultivar: null,
    status: "active",
    culture_stage: "multiplication",
    initial_explant_count: 10,
    current_count: 40,
    medium_recipe_version_id: null,
    started_at: null,
    ...partiel,
  };
}

function inspection(partiel: Partial<LigneInspection> & { id: string }): LigneInspection {
  return {
    culture_batch_id: null,
    bioreactor_id: null,
    date: "2026-09-01T10:00:00Z",
    culture_appearance: "",
    contamination_status: "noneObserved",
    hyperhydricity_status: "none",
    necrosis_status: "none",
    browning_status: "none",
    growth_status: "",
    estimated_count: null,
    notes: "",
    ...partiel,
  };
}

const NOMMER = { version: (id: string) => `Milieu ${id}`, bioreacteur: (id: string) => `Cuve ${id}` };

// ==================================================================
// 1. Le foyer, et son « depuis quand »
// ==================================================================

test("« depuis quand » est la PREMIÈRE confirmation, pas la dernière", () => {
  // Prendre la dernière rajeunirait un foyer installé depuis six
  // semaines et ferait croire à un incident du jour.
  const inspections = [
    inspection({ id: "i2", culture_batch_id: "a", contamination_status: "confirmed", date: "2026-09-01T10:00:00Z" }),
    inspection({ id: "i1", culture_batch_id: "a", contamination_status: "confirmed", date: "2026-07-20T10:00:00Z" }),
  ];
  const [foyer] = foyers([lot({ id: "a" })], inspections);
  assert.equal(foyer.confirmeeLe, "2026-07-20T10:00:00Z");
  assert.equal(foyer.derniereConfirmationLe, "2026-09-01T10:00:00Z");
  assert.equal(foyer.confirmations, 2, "une récidive n'est pas un accident : elle se compte");
});

test("un lot seulement suspecté n'est pas un foyer, mais il est listé à part", () => {
  const lots = [lot({ id: "a" }), lot({ id: "b" })];
  const inspections = [
    inspection({ id: "i1", culture_batch_id: "a", contamination_status: "suspected" }),
    inspection({ id: "i2", culture_batch_id: "b", contamination_status: "confirmed" }),
  ];
  assert.deepEqual(foyers(lots, inspections).map((f) => f.lot.id), ["b"]);
  assert.deepEqual(suspicions(lots, inspections).map((s) => s.lot.id), ["a"]);
});

test("un lot confirmé ne réapparaît pas dans les suspicions", () => {
  // Le compter deux fois doublerait l'alarme pour un seul problème.
  const lots = [lot({ id: "a" })];
  const inspections = [
    inspection({ id: "i1", culture_batch_id: "a", contamination_status: "suspected", date: "2026-07-01T10:00:00Z" }),
    inspection({ id: "i2", culture_batch_id: "a", contamination_status: "confirmed", date: "2026-07-05T10:00:00Z" }),
  ];
  assert.equal(foyers(lots, inspections).length, 1);
  assert.equal(suspicions(lots, inspections).length, 0);
});

test("une inspection orpheline, sans lot rattaché, n'invente pas un foyer", () => {
  assert.deepEqual(
    foyers([lot({ id: "a" })], [inspection({ id: "i", culture_batch_id: null, contamination_status: "confirmed" })]),
    [],
  );
});

test("les foyers les plus récents sont en tête : c'est ce qui appelle une action aujourd'hui", () => {
  const lots = [lot({ id: "vieux" }), lot({ id: "recent" })];
  const inspections = [
    inspection({ id: "i1", culture_batch_id: "vieux", contamination_status: "confirmed", date: "2026-05-01T10:00:00Z" }),
    inspection({ id: "i2", culture_batch_id: "recent", contamination_status: "confirmed", date: "2026-09-01T10:00:00Z" }),
  ];
  assert.deepEqual(foyers(lots, inspections).map((f) => f.lot.id), ["recent", "vieux"]);
});

// ==================================================================
// 2. Les axes
// ==================================================================

test("les seuls axes proposés sont ceux que la base porte réellement", () => {
  // Mesure faite : il n'existe aucune table de salle, aucun lien
  // lot↔rack (une étiquette `smart_tags` ne porte qu'un seul
  // rattachement à la fois), et `bioreactor_inspections` n'a pas de
  // colonne d'auteur. Ces trois axes rendraient une seule ligne
  // fourre-tout, ou accuseraient quelqu'un sur une déduction.
  assert.deepEqual([...AXES], ["espece", "milieu", "bioreacteur", "stade"]);
  for (const interdit of ["rack", "salle", "operateur", "etagere"]) {
    assert.ok(!(AXES as readonly string[]).includes(interdit), `l'axe « ${interdit} » n'a aucune donnée derrière lui`);
  }
});

test("un axe inconnu dans l'URL retombe sur l'espèce plutôt que de casser la page", () => {
  assert.equal(axeValide("milieu"), "milieu");
  assert.equal(axeValide("rack"), "espece");
  assert.equal(axeValide(undefined), "espece");
});

test("l'axe « par milieu » range les lots sur la version de recette qu'ils ont reçue", () => {
  const lots = [
    lot({ id: "a", medium_recipe_version_id: "v1" }),
    lot({ id: "b", medium_recipe_version_id: "v1" }),
    lot({ id: "c", medium_recipe_version_id: null }),
  ];
  const inspections = [inspection({ id: "i", culture_batch_id: "a", contamination_status: "confirmed" })];
  const lignes = ventiler("milieu", lots, inspections, NOMMER);

  const milieu = lignes.find((l) => l.cle === "v1");
  assert.equal(milieu?.taux.effectif, 2);
  assert.equal(milieu?.taux.touches, 1);
  const sansMilieu = lignes.find((l) => l.cle === "—");
  assert.equal(sansMilieu?.libelle, "Aucun milieu renseigné", "un lot sans milieu se dit, il ne disparaît pas");
});

test("l'axe « par bioréacteur » compte les lots INSPECTÉS dans la cuve, pas tous les lots", () => {
  // Le seul lien lot↔bioréacteur que le produit enregistre est
  // l'inspection. Prendre tous les lots comme dénominateur ferait
  // paraître propre une cuve où l'on n'a presque rien inspecté.
  const lots = [lot({ id: "a" }), lot({ id: "b" }), lot({ id: "jamais-inspecte" })];
  const inspections = [
    inspection({ id: "i1", culture_batch_id: "a", bioreactor_id: "br1", contamination_status: "confirmed" }),
    inspection({ id: "i2", culture_batch_id: "b", bioreactor_id: "br1" }),
  ];
  const [ligne] = ventiler("bioreacteur", lots, inspections, NOMMER);
  assert.equal(ligne.cle, "br1");
  assert.equal(ligne.libelle, "Cuve br1");
  assert.equal(ligne.taux.effectif, 2, "seuls les deux lots inspectés dans cette cuve comptent");
  assert.equal(ligne.taux.touches, 1);
});

test("une inspection sans bioréacteur se range sous « hors bioréacteur », elle ne se perd pas", () => {
  const lignes = ventiler(
    "bioreacteur",
    [lot({ id: "a" })],
    [inspection({ id: "i", culture_batch_id: "a", contamination_status: "confirmed" })],
    NOMMER,
  );
  assert.equal(lignes[0].libelle, "Hors bioréacteur");
});

test("l'axe « par stade » suit l'ordre du cycle, pas le classement des taux", () => {
  // On lit un cycle de culture dans son ordre : initiation,
  // multiplication, enracinement. Le trier par gravité rendrait la
  // progression illisible.
  const lots = [
    lot({ id: "a", culture_stage: "rooting" }),
    lot({ id: "b", culture_stage: "initiation" }),
    lot({ id: "c", culture_stage: "multiplication" }),
  ];
  assert.deepEqual(
    ventiler("stade", lots, [], NOMMER).map((l) => l.cle),
    ["initiation", "multiplication", "rooting"],
  );
});

test("les autres axes se classent par gravité, le pire en tête", () => {
  const lots = [
    lot({ id: "a", species_name: "Saine" }),
    lot({ id: "b", species_name: "Touchée" }),
  ];
  const inspections = [inspection({ id: "i", culture_batch_id: "b", contamination_status: "confirmed" })];
  assert.deepEqual(
    ventiler("espece", lots, inspections, NOMMER).map((l) => l.libelle),
    ["Touchée", "Saine"],
  );
});

test("un groupe sous le seuil se classe à sa vraie place mais n'affiche pas de pourcentage", () => {
  // Ce qui est caché, c'est la prétention du chiffre, pas le chiffre :
  // l'ordre du tableau reste juste.
  const lots = [
    lot({ id: "a", species_name: "Rare" }),
    lot({ id: "b", species_name: "Rare" }),
    ...Array.from({ length: 10 }, (_, i) => lot({ id: `c${i}`, species_name: "Courante" })),
  ];
  const inspections = [inspection({ id: "i", culture_batch_id: "a", contamination_status: "confirmed" })];
  const lignes = ventiler("espece", lots, inspections, NOMMER);
  assert.equal(lignes[0].libelle, "Rare", "50 % passe devant 0 %, même sur deux lots");
  assert.equal(direTaux(lignes[0].taux), "1 sur 2");
  assert.equal(direTaux(lignes[1].taux), "0 %");
});

test("la ventilation retient les dates du groupe, la plus ancienne et la plus récente", () => {
  const lots = [lot({ id: "a" }), lot({ id: "b" })];
  const inspections = [
    inspection({ id: "i1", culture_batch_id: "a", contamination_status: "confirmed", date: "2026-06-01T10:00:00Z" }),
    inspection({ id: "i2", culture_batch_id: "b", contamination_status: "confirmed", date: "2026-08-15T10:00:00Z" }),
  ];
  const [ligne] = ventiler("espece", lots, inspections, NOMMER);
  assert.equal(ligne.premiereConfirmation, "2026-06-01T10:00:00Z");
  assert.equal(ligne.derniereConfirmation, "2026-08-15T10:00:00Z");
});

// ==================================================================
// 3. Les quatre troubles
// ==================================================================

test("les quatre troubles se comptent séparément, jamais fondus en un seul incident", () => {
  // Hyperhydricité, nécrose et brunissement n'ont ni la même cause ni
  // le même remède. Les additionner effacerait ce qui dit quoi corriger.
  const lots = [lot({ id: "a" }), lot({ id: "b" }), lot({ id: "c" }), lot({ id: "d" })];
  const inspections = [
    inspection({ id: "i1", culture_batch_id: "a", contamination_status: "confirmed" }),
    inspection({ id: "i2", culture_batch_id: "b", hyperhydricity_status: "severe" }),
    inspection({ id: "i3", culture_batch_id: "c", necrosis_status: "mild" }),
    inspection({ id: "i4", culture_batch_id: "d", browning_status: "moderate" }),
  ];
  const troubles = troublesObserves(lots, inspections);
  assert.equal(troubles.contamination.touches, 1);
  assert.equal(troubles.hyperhydricite.touches, 1);
  assert.equal(troubles.necrose.touches, 1);
  assert.equal(troubles.brunissement.touches, 1);
  assert.equal(troubles.contamination.effectif, 4);
});

test("une sévérité « inconnue » ne fait pas d'un lot un lot atteint", () => {
  const troubles = troublesObserves(
    [lot({ id: "a" })],
    [inspection({ id: "i", culture_batch_id: "a", necrosis_status: "unknown", browning_status: "unknown" })],
  );
  assert.equal(troubles.necrose.touches, 0);
  assert.equal(troubles.brunissement.touches, 0);
});

// ==================================================================
// 4. Les noms et les photos
// ==================================================================

test("un milieu inconnu se nomme, il ne rend pas une case vide", () => {
  const versions: LigneVersion[] = [
    {
      id: "v1", recipe_id: "r1", version_number: 3, target_ph: 5.8, measured_ph: null,
      components: [], change_reason: "", parent_version_id: null, notes: "", created_at: "",
    },
  ];
  const recettes: LigneRecette[] = [
    { id: "r1", name: "MS Alocasia", species_name: "", notes: "", created_at: "", updated_at: null },
  ];
  const nommer = nommeurDeVersion(versions, recettes);
  assert.equal(nommer("v1"), "MS Alocasia · V3");
  assert.equal(nommer("disparu"), "Milieu inconnu");

  const nommerCuve = nommeurDeBioreacteur([{ id: "br1", code: "BR04", name: "Immersion 4" }]);
  assert.equal(nommerCuve("br1"), "BR04 — Immersion 4");
  assert.equal(nommerCuve("autre"), "Bioréacteur inconnu");
});

test("les photos passent par le seau que le téléphone emploie déjà", () => {
  // Un second seau rendrait invisibles toutes les photos déjà prises,
  // et §6 interdit précisément ce doublon. Le chemin est mesuré dans
  // `SyncEngine.pushBioLabInspectionPhotos`.
  assert.equal(SEAU_PHOTOS, "plant-photos");

  const sync = readFileSync(
    join(ICI, "..", "..", "..", "OasisCare", "Services", "Sync", "SyncEngine.swift"),
    "utf8",
  );
  assert.ok(
    sync.includes('private static let photoBucket = "plant-photos"'),
    "le téléphone a changé de seau : les photos d'inspection ne s'afficheraient plus",
  );
  assert.ok(
    sync.includes('"\\(workspaceID)/biolab/\\(inspectionID)/\\(photo.id).jpg"'),
    "le chemin des photos d'inspection a changé de forme",
  );
});
