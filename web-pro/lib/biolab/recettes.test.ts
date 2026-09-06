import { test } from "node:test";
import assert from "node:assert/strict";

import {
  direConcentration,
  direVolume,
  ecartEntreVersions,
  ecartsDePreparation,
  genealogieDesVersions,
  lireComposants,
  lirePesees,
  resumerComposition,
  trierComposants,
  type Composant,
  type LignePreparation,
  type LigneVersion,
} from "./recettes.ts";

/**
 * CE QUE CE FICHIER PROTÈGE : LA PROMESSE DU VERSIONNEMENT.
 *
 * « On doit pouvoir dire quelle version a servi à quel lot, des mois
 * plus tard. » Trois choses peuvent casser cette promesse à l'affichage
 * sans rien casser en base :
 *
 *   1. UNE GÉNÉALOGIE QUI PERD UNE VERSION. Une version orpheline ou
 *      prise dans un cycle disparaîtrait de la fiche — et avec elle, la
 *      trace de ce qu'un lot a reçu.
 *   2. UNE COMPARAISON QUI MENT. Apparier les composants par leur `id`
 *      ferait lire « BAP retiré, BAP ajouté » là où une concentration a
 *      simplement changé.
 *   3. UN VOLUME OU UNE PESÉE CONFONDUS. « Visé » et « réel » ne sont
 *      pas la même colonne, et les confondre fait passer une
 *      préparation ratée pour une préparation conforme.
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

function composant(partiel: Partial<Composant> & { name: string; amount: number }): Composant {
  return { type: "other", unit: "milligramsPerLiter", ...partiel };
}

// ==================================================================
// 1. La généalogie
// ==================================================================

test("la filiation suit parent_version_id, pas le numéro de version", () => {
  // L'exemple de la spec elle-même : V2 donne V3A et V3B. Une lecture
  // séquentielle (« mon parent est le numéro précédent ») ferait de V3B
  // l'enfant de V3A, ce qui est faux et invente une descendance.
  const versions = [
    version({ id: "v1", version_number: 1 }),
    version({ id: "v2", version_number: 2, parent_version_id: "v1" }),
    version({ id: "v3a", version_number: 3, parent_version_id: "v2" }),
    version({ id: "v3b", version_number: 4, parent_version_id: "v2" }),
  ];
  const arbre = genealogieDesVersions(versions);
  assert.deepEqual(
    arbre.map((n) => [n.version.id, n.profondeur]),
    [["v1", 0], ["v2", 1], ["v3a", 2], ["v3b", 2]],
    "les deux branches doivent être au même niveau, sous V2",
  );
});

test("une version dont le parent est absent reste visible, en racine", () => {
  // Le parent peut avoir été supprimé, ou appartenir à une autre
  // recette. La version, elle, a servi à des lots : la faire disparaître
  // de la fiche effacerait la trace de ce qu'ils ont reçu.
  const arbre = genealogieDesVersions([
    version({ id: "v7", version_number: 7, parent_version_id: "disparu" }),
  ]);
  assert.equal(arbre.length, 1);
  assert.equal(arbre[0].racine, true);
});

test("un cycle ne fait pas tourner la descente à l'infini, et ne perd personne", () => {
  // `parent_version_id` est une simple clé étrangère : rien en base
  // n'interdit A → B → A. Sans garde, la page ne répondrait jamais.
  const arbre = genealogieDesVersions([
    version({ id: "a", version_number: 1, parent_version_id: "b" }),
    version({ id: "b", version_number: 2, parent_version_id: "a" }),
  ]);
  assert.equal(arbre.length, 2, "les deux versions du cycle doivent rester affichées");
  assert.deepEqual(new Set(arbre.map((n) => n.version.id)), new Set(["a", "b"]));
});

test("une version qui se déclare son propre parent est traitée en racine", () => {
  const arbre = genealogieDesVersions([version({ id: "seule", version_number: 1, parent_version_id: "seule" })]);
  assert.equal(arbre.length, 1);
  assert.equal(arbre[0].profondeur, 0);
});

// ==================================================================
// 2. Le jsonb, lu sans lui faire confiance
// ==================================================================

test("un composant illisible est compté, pas avalé en silence", () => {
  // Une recette dont un composant a disparu de l'écran est un piège
  // pour un préparateur : la fiche doit pouvoir le signaler.
  const lu = lireComposants([
    { type: "sugar", name: "Saccharose", amount: 30, unit: "gramsPerLiter" },
    { type: "sugar", name: "Sans quantité" },
    "n'importe quoi",
    null,
  ]);
  assert.equal(lu.composants.length, 1);
  assert.equal(lu.illisibles, 3);
});

test("un jsonb qui n'est pas un tableau ne fait pas tomber la page", () => {
  assert.deepEqual(lireComposants(null), { composants: [], illisibles: 0 });
  assert.deepEqual(lireComposants({ type: "sugar" }), { composants: [], illisibles: 0 });
  assert.deepEqual(lirePesees("bruit"), []);
});

test("les composants se lisent dans l'ordre où on les verse", () => {
  const ordonne = trierComposants([
    composant({ name: "Agar", amount: 7, type: "gellingAgent" }),
    composant({ name: "BAP", amount: 2, type: "plantGrowthRegulator" }),
    composant({ name: "MS", amount: 4.4, type: "basalMedium" }),
    composant({ name: "Saccharose", amount: 30, type: "sugar" }),
  ]);
  assert.deepEqual(ordonne.map((c) => c.name), ["MS", "Saccharose", "BAP", "Agar"]);
});

test("le résumé sort le milieu de base et les régulateurs, ce qu'on regarde en premier", () => {
  const resume = resumerComposition([
    composant({ name: "MS", amount: 4.4, type: "basalMedium", unit: "gramsPerLiter" }),
    composant({ name: "BAP", amount: 2, type: "plantGrowthRegulator" }),
    composant({ name: "Saccharose", amount: 30, type: "sugar" }),
  ]);
  assert.deepEqual(resume.milieuxDeBase, ["MS"]);
  assert.deepEqual(resume.regulateurs, ["BAP 2 mg/L"]);
  assert.equal(resume.nombreComposants, 3);
});

test("un régulateur au centième garde ses décimales", () => {
  // Les hormones se dosent au centième de mg/L : arrondir à l'unité
  // effacerait l'écart entre deux versions.
  assert.equal(direConcentration(composant({ name: "IBA", amount: 0.125 })), "0,125 mg/L");
});

// ==================================================================
// 3. Ce qui a changé d'une version à l'autre
// ==================================================================

test("un composant dont la concentration change se lit « modifié », pas « retiré puis ajouté »", () => {
  // Les identifiants d'un composant sont régénérés à chaque version :
  // s'y fier ferait de tout changement une suppression suivie d'un
  // ajout, et le changelog deviendrait illisible.
  const parent = version({
    id: "v1",
    version_number: 1,
    components: [{ id: "aaa", type: "plantGrowthRegulator", name: "BAP", amount: 1, unit: "milligramsPerLiter" }],
  });
  const enfant = version({
    id: "v2",
    version_number: 2,
    parent_version_id: "v1",
    components: [{ id: "bbb", type: "plantGrowthRegulator", name: "BAP", amount: 2, unit: "milligramsPerLiter" }],
  });
  const ecart = ecartEntreVersions(parent, enfant);
  assert.equal(ecart.composants.length, 1);
  assert.equal(ecart.composants[0].nature, "modifie");
  assert.equal(ecart.composants[0].nom, "BAP");
});

test("l'appariement passe par le composé du laboratoire quand il est renseigné", () => {
  // Renommer « BAP » en « 6-benzylaminopurine » ne change pas la
  // molécule : le `compoundId` dit que c'est la même ligne.
  const parent = version({
    id: "v1",
    version_number: 1,
    components: [{ compoundId: "c1", type: "plantGrowthRegulator", name: "BAP", amount: 1, unit: "milligramsPerLiter" }],
  });
  const enfant = version({
    id: "v2",
    version_number: 2,
    components: [
      { compoundId: "c1", type: "plantGrowthRegulator", name: "6-benzylaminopurine", amount: 1, unit: "milligramsPerLiter" },
    ],
  });
  assert.deepEqual(ecartEntreVersions(parent, enfant).composants, [], "même composé, même dose : aucun écart");
});

test("un ajout, un retrait et un changement de pH se voient tous les trois", () => {
  const parent = version({
    id: "v1",
    version_number: 1,
    target_ph: 5.8,
    components: [{ type: "additive", name: "Charbon actif", amount: 1, unit: "gramsPerLiter" }],
  });
  const enfant = version({
    id: "v2",
    version_number: 2,
    target_ph: 5.6,
    components: [{ type: "vitamin", name: "Thiamine", amount: 0.4, unit: "milligramsPerLiter" }],
  });
  const ecart = ecartEntreVersions(parent, enfant);
  assert.deepEqual(ecart.phCible, { avant: 5.8, apres: 5.6 });
  assert.deepEqual(
    ecart.composants.map((e) => [e.nom, e.nature]).sort(),
    [["Charbon actif", "retire"], ["Thiamine", "ajoute"]].sort(),
  );
});

test("un changement d'unité seule compte comme une modification", () => {
  // 1 g/L et 1 mg/L ne sont pas la même chose. Comparer les seules
  // quantités laisserait passer un facteur mille.
  const parent = version({
    id: "v1",
    version_number: 1,
    components: [{ type: "sugar", name: "Saccharose", amount: 30, unit: "gramsPerLiter" }],
  });
  const enfant = version({
    id: "v2",
    version_number: 2,
    components: [{ type: "sugar", name: "Saccharose", amount: 30, unit: "milligramsPerLiter" }],
  });
  assert.equal(ecartEntreVersions(parent, enfant).composants[0].nature, "modifie");
});

// ==================================================================
// 4. Les préparations réelles
// ==================================================================

function preparation(partiel: Partial<LignePreparation> & { id: string }): LignePreparation {
  return {
    code: "MB-001",
    recipe_version_id: "v1",
    volume_liters: 5,
    target_volume_liters: null,
    prepared_at: "2026-08-24T09:00:00Z",
    prepared_by: null,
    measured_ph: null,
    compound_lots: [],
    notes: "",
    ...partiel,
  };
}

test("une pesée non relevée ne rend pas un écart de zéro", () => {
  // « Conforme » et « non relevé » ne se confondent pas : le second
  // n'est pas une bonne nouvelle, c'est une absence de contrôle.
  const ecarts = ecartsDePreparation(
    preparation({ id: "p1", compound_lots: [{ ingredientId: "i1", targetAmount: 4.4, amountUnit: "gram" }] }),
    [],
  );
  assert.equal(ecarts.length, 1);
  assert.equal(ecarts[0].ecartRelatif, null);
});

test("une pesée réelle donne un écart relatif signé, rattaché à sa ligne de recette", () => {
  const ecarts = ecartsDePreparation(
    preparation({
      id: "p1",
      compound_lots: [{ ingredientId: "i1", targetAmount: 4, actualAmount: 5, amountUnit: "gram" }],
    }),
    [composant({ id: "i1", name: "MS", amount: 4.4, type: "basalMedium" })],
  );
  assert.equal(ecarts[0].ecartRelatif, 0.25);
  assert.equal(ecarts[0].composant?.name, "MS");
});

test("une cible à zéro ne provoque pas une division par zéro", () => {
  const ecarts = ecartsDePreparation(
    preparation({
      id: "p1",
      compound_lots: [{ ingredientId: "i1", targetAmount: 0, actualAmount: 1, amountUnit: "gram" }],
    }),
    [],
  );
  assert.equal(ecarts[0].ecartRelatif, null);
});

test("le volume affiché est le volume RÉEL, et le volume visé n'apparaît que s'il diffère", () => {
  assert.equal(direVolume(preparation({ id: "p" })), "5 L");
  assert.equal(direVolume(preparation({ id: "p", target_volume_liters: 5 })), "5 L");
  assert.equal(
    direVolume(preparation({ id: "p", volume_liters: 4.5, target_volume_liters: 5 })),
    "4,5 L (visé 5 L)",
  );
});
