import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PONDERATION_PAR_DEFAUT,
  comparerProtocoles,
  grouperProtocolesParRecette,
  performanceDesProtocoles,
  scorerProtocoles,
} from "./protocoles.ts";
import type { LigneRecette, LigneVersion } from "./recettes.ts";
import type { LigneAcclimatation, LigneInspection, LigneLot } from "./statistiques.ts";

/**
 * CE QUE CE FICHIER PROTÈGE : LE CLASSEMENT DES PROTOCOLES.
 *
 * C'est l'écran sur lequel on décide de changer de recette — la
 * décision la plus coûteuse du métier. Quatre façons de le fausser :
 *
 *   1. FAIRE FIGURER UNE RECETTE JAMAIS EMPLOYÉE. Elle afficherait 0 %
 *      de contamination et trônerait en tête du classement.
 *   2. SACRER UN PROTOCOLE SEUL. Sans rien contre quoi le comparer, un
 *      score de 100 le déclarerait meilleur du laboratoire par le seul
 *      fait d'être unique.
 *   3. COMPTER UN INDICATEUR MANQUANT COMME ZÉRO. Un protocole sans
 *      acclimatation enregistrée n'est pas un protocole dont les
 *      plantules meurent.
 *   4. PRÉSENTER UN RÉSULTAT SUR DEUX LOTS COMME UNE TENDANCE.
 */

function version(partiel: Partial<LigneVersion> & { id: string; version_number: number }): LigneVersion {
  return {
    recipe_id: "r1",
    target_ph: 5.8,
    measured_ph: null,
    components: [],
    change_reason: "",
    parent_version_id: null,
    notes: "",
    created_at: "2026-01-01T00:00:00Z",
    ...partiel,
  };
}

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

const RECETTES: LigneRecette[] = [
  { id: "r1", name: "MS Alocasia", species_name: "Alocasia scalprum", notes: "", created_at: "", updated_at: null },
];

// ==================================================================
// 1. Seules les versions employées ont une performance
// ==================================================================

test("une version que personne n'a employée n'apparaît pas — elle n'a pas une performance de zéro", () => {
  const performances = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 }), version({ id: "v2", version_number: 2 })],
    RECETTES,
    [lot({ id: "a", medium_recipe_version_id: "v1" })],
    [],
    [],
  );
  assert.deepEqual(performances.map((p) => p.version.id), ["v1"]);
});

test("l'intitulé nomme la recette et la version, comme un opérateur les nomme", () => {
  const [performance] = performanceDesProtocoles(
    [version({ id: "v3", version_number: 3 })],
    RECETTES,
    [lot({ id: "a", medium_recipe_version_id: "v3" })],
    [],
    [],
  );
  assert.equal(performance.intitule, "MS Alocasia · V3");
});

test("les espèces listées sont celles des lots qui ont VRAIMENT reçu ce protocole", () => {
  const [performance] = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 })],
    RECETTES,
    [
      lot({ id: "a", medium_recipe_version_id: "v1", species_name: "Alocasia scalprum" }),
      lot({ id: "b", medium_recipe_version_id: "v1", species_name: "Anthurium warocqueanum" }),
      lot({ id: "c", medium_recipe_version_id: "autre", species_name: "Philodendron" }),
    ],
    [],
    [],
  );
  assert.deepEqual(performance.especes, ["Alocasia scalprum", "Anthurium warocqueanum"]);
});

test("un protocole éprouvé sur moins de cinq lots n'est pas « solide »", () => {
  const lots = (n: number) =>
    Array.from({ length: n }, (_, i) => lot({ id: `l${i}`, medium_recipe_version_id: "v1" }));
  const maigre = performanceDesProtocoles([version({ id: "v1", version_number: 1 })], RECETTES, lots(4), [], []);
  const suffisant = performanceDesProtocoles([version({ id: "v1", version_number: 1 })], RECETTES, lots(5), [], []);
  assert.equal(maigre[0].solide, false);
  assert.equal(suffisant[0].solide, true);
});

// ==================================================================
// 2. Le score
// ==================================================================

test("un protocole seul n'a pas de score", () => {
  const performances = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 })],
    RECETTES,
    [lot({ id: "a", medium_recipe_version_id: "v1" })],
    [],
    [],
  );
  assert.deepEqual(scorerProtocoles(performances).map((s) => s.score), [null]);
});

test("entre deux protocoles, le moins contaminé l'emporte", () => {
  const lots = [
    lot({ id: "a", medium_recipe_version_id: "v1" }),
    lot({ id: "b", medium_recipe_version_id: "v2" }),
  ];
  const inspections = [
    inspection({ id: "i", culture_batch_id: "b", contamination_status: "confirmed" }),
  ];
  const performances = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 }), version({ id: "v2", version_number: 2 })],
    RECETTES,
    lots,
    inspections,
    [],
  );
  const scores = new Map(scorerProtocoles(performances).map((s) => [s.versionId, s.score]));
  assert.ok((scores.get("v1") ?? 0) > (scores.get("v2") ?? 0), "le protocole contaminé doit être derrière");
});

test("un indicateur absent ne compte pas comme zéro : il sort du calcul, son poids avec lui", () => {
  // Deux protocoles identiques en tout point mesuré ; l'un n'a
  // simplement aucune acclimatation enregistrée. Il ne doit pas être
  // pénalisé pour une donnée qui n'existe pas.
  const lots = [
    lot({ id: "a", medium_recipe_version_id: "v1" }),
    lot({ id: "b", medium_recipe_version_id: "v2" }),
  ];
  const acclimatations: LigneAcclimatation[] = [
    { id: "x", culture_batch_id: "a", initial_plantlet_count: 100, current_survivor_count: 90 },
  ];
  const performances = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 }), version({ id: "v2", version_number: 2 })],
    RECETTES,
    lots,
    [],
    acclimatations,
  );
  const scores = new Map(scorerProtocoles(performances).map((s) => [s.versionId, s.score]));
  // v1 a une survie connue et v2 non : tous les autres indicateurs
  // étant identiques, les deux scores restent à égalité neutre.
  assert.equal(scores.get("v1"), scores.get("v2"));
});

test("des protocoles rigoureusement identiques ne sont pas départagés arbitrairement", () => {
  const performances = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 }), version({ id: "v2", version_number: 2 })],
    RECETTES,
    [lot({ id: "a", medium_recipe_version_id: "v1" }), lot({ id: "b", medium_recipe_version_id: "v2" })],
    [],
    [],
  );
  const scores = scorerProtocoles(performances).map((s) => s.score);
  assert.equal(scores[0], scores[1]);
  assert.equal(scores[0], 50, "à égalité, la normalisation rend un milieu neutre, pas 0 ni 100");
});

test("la pondération reprend celle du téléphone, pour que les deux faces classent pareil", () => {
  // Un désaccord ici ferait dire au web et à l'iPhone deux « meilleurs
  // protocoles » différents pour le même laboratoire.
  assert.deepEqual(PONDERATION_PAR_DEFAUT, {
    multiplication: 0.4,
    enracinement: 0.2,
    hyperhydricite: 0.15,
    contamination: 0.15,
    survie: 0.1,
  });
  const somme = Object.values(PONDERATION_PAR_DEFAUT).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(somme - 1) < 1e-9, "les poids doivent totaliser 1");
});

// ==================================================================
// 3. La comparaison
// ==================================================================

test("la comparaison signale ce qui diffère, et rien de plus", () => {
  const v1 = version({
    id: "v1",
    version_number: 1,
    target_ph: 5.8,
    components: [{ type: "basalMedium", name: "MS", amount: 4.4, unit: "gramsPerLiter" }],
  });
  const v2 = version({
    id: "v2",
    version_number: 2,
    target_ph: 5.6,
    components: [{ type: "basalMedium", name: "MS", amount: 4.4, unit: "gramsPerLiter" }],
  });
  const performances = performanceDesProtocoles(
    [v1, v2],
    RECETTES,
    [lot({ id: "a", medium_recipe_version_id: "v1" }), lot({ id: "b", medium_recipe_version_id: "v2" })],
    [],
    [],
  );
  const comparaison = comparerProtocoles(performances);
  assert.ok(comparaison.champsDifferents.includes("pH cible"));
  assert.ok(
    !comparaison.champsDifferents.includes("Milieu de base"),
    "un milieu de base identique ne doit pas être signalé comme une différence",
  );
  assert.deepEqual(comparaison.intitules, ["MS Alocasia · V1", "MS Alocasia · V2"]);
});

test("un indicateur inconnu s'écrit « Non disponible » dans la comparaison, jamais 0 %", () => {
  const performances = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 })],
    RECETTES,
    [lot({ id: "a", medium_recipe_version_id: "v1" })],
    [],
    [],
  );
  const survie = comparerProtocoles(performances).lignes.find((l) => l.champ === "Survie en acclimatation");
  assert.deepEqual(survie?.valeurs, ["Non disponible"]);
});

test("« Basé sur » dit toujours le nombre de lots, à côté de chaque taux", () => {
  // §26 du module : « Basé sur N lots ». Un taux sans son effectif est
  // une affirmation qu'on ne peut pas peser.
  const performances = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 })],
    RECETTES,
    [lot({ id: "a", medium_recipe_version_id: "v1" }), lot({ id: "b", medium_recipe_version_id: "v1" })],
    [],
    [],
  );
  const base = comparerProtocoles(performances).lignes.find((l) => l.champ === "Basé sur");
  assert.deepEqual(base?.valeurs, ["2 lots"]);
});

test("sous le seuil, la comparaison rend les faits bruts et pas un pourcentage", () => {
  const performances = performanceDesProtocoles(
    [version({ id: "v1", version_number: 1 })],
    RECETTES,
    [
      lot({ id: "a", medium_recipe_version_id: "v1" }),
      lot({ id: "b", medium_recipe_version_id: "v1" }),
    ],
    [inspection({ id: "i", culture_batch_id: "a", contamination_status: "confirmed" })],
    [],
  );
  const contamination = comparerProtocoles(performances).lignes.find(
    (l) => l.champ === "Contamination confirmée",
  );
  assert.deepEqual(contamination?.valeurs, ["1 sur 2"]);
});

// ==================================================================
// 5. ON NE CLASSE QUE CE QUI EST COMPARABLE
// ==================================================================
//
// Le moteur d'analyse du téléphone documente son score en toutes
// lettres : « never an absolute, portable, or comparable-across-species
// number ». Ses deux appelants regroupent donc avant de scorer. Le web
// scorait tout le laboratoire d'un coup — une recette d'Alocasia contre
// une recette de Monstera —, ce qui ne veut rien dire et fabriquait un
// gagnant sans signification.

const DEUX_RECETTES: LigneRecette[] = [
  { id: "r1", name: "MS Alocasia", species_name: "Alocasia scalprum", notes: "", created_at: "", updated_at: null },
  { id: "r2", name: "MS Monstera", species_name: "Monstera obliqua", notes: "", created_at: "", updated_at: null },
];

function deuxRecettesEmployees() {
  return performanceDesProtocoles(
    [
      version({ id: "v1", version_number: 1, recipe_id: "r1" }),
      version({ id: "v2", version_number: 2, recipe_id: "r1" }),
      version({ id: "v9", version_number: 1, recipe_id: "r2" }),
    ],
    DEUX_RECETTES,
    [
      lot({ id: "a", medium_recipe_version_id: "v1" }),
      lot({ id: "b", medium_recipe_version_id: "v2", current_count: 10 }),
      lot({ id: "c", medium_recipe_version_id: "v9", species_name: "Monstera obliqua" }),
    ],
    [],
    [],
  );
}

test("deux recettes différentes ne sont jamais classées l'une contre l'autre", () => {
  const groupes = grouperProtocolesParRecette(deuxRecettesEmployees());
  assert.deepEqual(
    groupes.map((g) => g.intitule).sort(),
    ["MS Alocasia", "MS Monstera"],
  );
  // Deux groupes, donc deux classements séparés : aucun score ne
  // traverse la frontière.
  const alocasia = groupes.find((g) => g.intitule === "MS Alocasia")!;
  assert.equal(alocasia.performances.length, 2);
});

test("une recette à une seule version n'a ni score ni comparaison", () => {
  const groupes = grouperProtocolesParRecette(deuxRecettesEmployees());
  const monstera = groupes.find((g) => g.intitule === "MS Monstera")!;
  assert.equal(monstera.comparaison, null);
  assert.equal(monstera.scores.get("v9")?.score, null);
});

test("à l'intérieur d'une recette, les versions se comparent et se classent", () => {
  const groupes = grouperProtocolesParRecette(deuxRecettesEmployees());
  const alocasia = groupes.find((g) => g.intitule === "MS Alocasia")!;
  assert.notEqual(alocasia.comparaison, null);
  assert.deepEqual(alocasia.comparaison!.intitules, ["MS Alocasia · V1", "MS Alocasia · V2"]);
  // Les deux versions ont bien un score, et ils ne sont pas nuls : il y
  // a deux choses à comparer.
  assert.notEqual(alocasia.scores.get("v1")?.score, null);
  assert.notEqual(alocasia.scores.get("v2")?.score, null);
});

test("le groupe dit les espèces réellement rencontrées, sans les mélanger", () => {
  const groupes = grouperProtocolesParRecette(deuxRecettesEmployees());
  assert.deepEqual(
    groupes.find((g) => g.intitule === "MS Alocasia")!.especes,
    ["Alocasia scalprum"],
  );
  assert.deepEqual(
    groupes.find((g) => g.intitule === "MS Monstera")!.especes,
    ["Monstera obliqua"],
  );
});

test("une version dont la recette a disparu ne se mélange pas aux autres", () => {
  // Sa recette vit peut-être dans un autre espace : on ne sait pas de
  // quoi elle est une variante, donc on ne la compare à rien.
  const performances = performanceDesProtocoles(
    [version({ id: "vx", version_number: 1, recipe_id: "inconnue" })],
    DEUX_RECETTES,
    [lot({ id: "z", medium_recipe_version_id: "vx" })],
    [],
    [],
  );
  const groupes = grouperProtocolesParRecette(performances);
  assert.equal(groupes.length, 1);
  assert.equal(groupes[0].comparaison, null);
});
