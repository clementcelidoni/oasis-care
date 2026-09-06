import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  STADES_ENRACINES,
  estContaminationConfirmee,
  indicateursDuGroupe,
  lotContamine,
  lotHyperhydrique,
  multiplicationMoyenne,
  survieMoyenne,
  type LigneAcclimatation,
  type LigneInspection,
  type LigneLot,
} from "./statistiques.ts";

/**
 * CE FICHIER TIENT DEUX CHOSES, ET LA SECONDE EST LA PLUS IMPORTANTE.
 *
 *   1. LES DÉFINITIONS. Ce que « contaminé », « hyperhydrique »,
 *      « enraciné » veulent dire, et ce qu'on rend quand on ne sait pas.
 *
 *   2. L'ACCORD AVEC LE SQL. Ces mêmes définitions vivent aussi dans
 *      `0087_biolab_pro.sql`, parce que le tableau de bord et les
 *      statistiques par espèce sont calculés en base. Le TypeScript ne
 *      peut pas lire une fonction Postgres : on relit donc le fichier
 *      de migration et on échoue si les deux cessent de dire la même
 *      chose. Sans ce test, la dérive serait invisible — deux écrans
 *      afficheraient deux taux de contamination différents pour le
 *      même laboratoire, et personne ne saurait lequel croire.
 */

const ICI = dirname(fileURLToPath(import.meta.url));
const MIGRATION_0087 = join(ICI, "..", "..", "..", "supabase", "migrations", "0087_biolab_pro.sql");

function sql(): string {
  return readFileSync(MIGRATION_0087, "utf8");
}

// ==================================================================
// 1. Les définitions
// ==================================================================

function lot(partiel: Partial<LigneLot> & { id: string }): LigneLot {
  return {
    batch_code: `L-${partiel.id}`,
    species_name: "Alocasia scalprum",
    cultivar: null,
    status: "active",
    culture_stage: "multiplication",
    initial_explant_count: null,
    current_count: null,
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

test("une SUSPICION n'est pas une contamination", () => {
  // La décision la plus lourde du fichier. `ContaminationStatus` du
  // téléphone porte la même règle : une suspicion est une inquiétude,
  // pas un fait, et c'est ce taux qui décide de jeter un lot.
  const inspections = [
    inspection({ id: "i1", culture_batch_id: "a", contamination_status: "suspected" }),
  ];
  assert.equal(lotContamine("a", inspections), false);
  assert.equal(estContaminationConfirmee(inspections[0]), false);

  const confirmee = [inspection({ id: "i2", culture_batch_id: "a", contamination_status: "confirmed" })];
  assert.equal(lotContamine("a", confirmee), true);
});

test("une seule inspection confirmée suffit à marquer le lot, même si les suivantes sont propres", () => {
  // Un lot contaminé ne redevient pas sain parce que l'inspection
  // suivante n'a rien vu : on a jeté ce qui était atteint.
  const inspections = [
    inspection({ id: "i1", culture_batch_id: "a", contamination_status: "confirmed", date: "2026-08-01T10:00:00Z" }),
    inspection({ id: "i2", culture_batch_id: "a", contamination_status: "noneObserved", date: "2026-09-01T10:00:00Z" }),
  ];
  assert.equal(lotContamine("a", inspections), true);
});

test("l'hyperhydricité inconnue ne compte pas, la légère si", () => {
  assert.equal(
    lotHyperhydrique("a", [inspection({ id: "i", culture_batch_id: "a", hyperhydricity_status: "unknown" })]),
    false,
  );
  assert.equal(
    lotHyperhydrique("a", [inspection({ id: "i", culture_batch_id: "a", hyperhydricity_status: "mild" })]),
    true,
  );
});

test("la multiplication moyenne ignore les lots sans compte de départ, et rend null s'il n'en reste aucun", () => {
  assert.equal(multiplicationMoyenne([lot({ id: "a" })]), null, "aucun compte de départ : pas de moyenne");
  assert.equal(
    multiplicationMoyenne([lot({ id: "a", initial_explant_count: 0, current_count: 40 })]),
    null,
    "une division par zéro n'est pas un rendement",
  );
  assert.equal(
    multiplicationMoyenne([
      lot({ id: "a", initial_explant_count: 10, current_count: 40 }),
      lot({ id: "b", initial_explant_count: 10, current_count: 20 }),
      lot({ id: "c" }),
    ]),
    3,
  );
});

test("la survie en acclimatation ne rattache que les acclimatations des lots donnés", () => {
  const acclimatations: LigneAcclimatation[] = [
    { id: "x", culture_batch_id: "a", initial_plantlet_count: 100, current_survivor_count: 80 },
    { id: "y", culture_batch_id: "autre-espece", initial_plantlet_count: 100, current_survivor_count: 10 },
    { id: "z", culture_batch_id: "a", initial_plantlet_count: 0, current_survivor_count: 0 },
  ];
  // 80 % et rien d'autre : le lot d'une autre espèce et l'acclimatation
  // sans plantules de départ n'entrent pas dans la moyenne.
  assert.equal(survieMoyenne([lot({ id: "a" })], acclimatations), 0.8);
  assert.equal(survieMoyenne([lot({ id: "inconnu" })], acclimatations), null);
});

test("l'enracinement se compte sur les lots ENCORE EN JEU, la contamination sur tous", () => {
  // Les deux dénominateurs diffèrent, et c'est voulu : un lot écarté
  // n'avait plus à s'enraciner — l'inclure ferait baisser le taux pour
  // une raison étrangère à l'enracinement. Il a en revanche bel et bien
  // pu être contaminé, et c'est souvent POUR ÇA qu'il a été écarté.
  const lots = [
    lot({ id: "a", culture_stage: "rooting" }),
    lot({ id: "b", culture_stage: "multiplication" }),
    lot({ id: "c", culture_stage: "discarded", status: "discarded" }),
  ];
  const inspections = [
    inspection({ id: "i", culture_batch_id: "c", contamination_status: "confirmed" }),
  ];

  const indicateurs = indicateursDuGroupe(lots, inspections, []);
  assert.equal(indicateurs.enracinement.effectif, 2, "le lot écarté sort du dénominateur d'enracinement");
  assert.equal(indicateurs.enracinement.touches, 1);
  assert.equal(indicateurs.contamination.effectif, 3, "le lot écarté reste dans le dénominateur de contamination");
  assert.equal(indicateurs.contamination.touches, 1);
});

test("tous les stades enracinés et plus loin comptent, pas seulement « rooting »", () => {
  for (const stade of STADES_ENRACINES) {
    const indicateurs = indicateursDuGroupe([lot({ id: "a", culture_stage: stade })], [], []);
    assert.equal(indicateurs.enracinement.touches, 1, `${stade} devrait compter comme enraciné`);
  }
  assert.equal(indicateursDuGroupe([lot({ id: "a", culture_stage: "initiation" })], [], []).enracinement.touches, 0);
});

test("un groupe où TOUS les lots sont écartés ne rend pas 0 % d'enracinement", () => {
  // Dénominateur nul : la question n'a pas de réponse. Zéro
  // accuserait un protocole d'un échec qu'on n'a pas mesuré.
  const indicateurs = indicateursDuGroupe(
    [lot({ id: "a", status: "discarded", culture_stage: "discarded" })],
    [],
    [],
  );
  assert.equal(indicateurs.enracinement.taux, null);
});

// ==================================================================
// 2. L'accord avec 0087 — la vraie garantie
// ==================================================================

test("0087 compte la contamination sur « confirmed », comme ce fichier", () => {
  const texte = sql();
  assert.ok(
    texte.includes("contamination_status = 'confirmed'"),
    "0087 doit compter la contamination CONFIRMÉE ; si le prédicat change en base, ce fichier doit changer avec lui",
  );
  assert.ok(
    !/count\(\*\)\s*filter\s*\(where\s+contamination_status\s*=\s*'suspected'/i.test(texte),
    "0087 ne doit jamais compter une suspicion comme une contamination",
  );
});

test("0087 exclut « none » ET « unknown » de l'hyperhydricité, comme severiteAtteinte", () => {
  assert.ok(
    /hyperhydricity_status\s+not\s+in\s*\(\s*'none'\s*,\s*'unknown'\s*\)/i.test(sql()),
    "le SQL et `severiteAtteinte` doivent exclure les deux mêmes valeurs",
  );
});

test("0087 emploie exactement les mêmes stades enracinés que STADES_ENRACINES", () => {
  const texte = sql();
  for (const stade of STADES_ENRACINES) {
    assert.ok(texte.includes(`'${stade}'`), `le stade ${stade} manque dans 0087`);
  }
  // Et la liste SQL ne doit pas en contenir un de plus : on relit le
  // `in (…)` du taux d'enracinement lui-même.
  const bloc = texte.match(/culture_stage\s+in\s*\(([^)]*)\)/i);
  assert.ok(bloc, "le prédicat d'enracinement de 0087 est introuvable — il a changé de forme");
  const stadesSql = [...bloc[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    stadesSql,
    [...STADES_ENRACINES].sort(),
    "la liste des stades enracinés diffère entre 0087 et le web",
  );
});

test("les trois fonctions SQL appelées par le web existent bien dans 0087, avec les noms d'arguments employés", () => {
  // Un nom d'argument faux ne se voit qu'à l'exécution, sur la page
  // d'un client. PostgREST appelle les fonctions par argument nommé.
  const texte = sql();
  for (const nom of [
    "biolab_tableau_de_bord",
    "biolab_statistiques_especes",
    "biolab_statistiques_bioreacteurs",
  ]) {
    assert.ok(
      texte.includes(`create or replace function public.${nom}(`),
      `la fonction ${nom} n'existe pas dans 0087 — la page qui l'appelle échouerait`,
    );
  }
  assert.ok(texte.includes("p_workspace_id uuid"), "l'argument s'appelle bien p_workspace_id");
});

test("le tableau de bord de 0087 rend NULL, jamais zéro, pour un taux inconnu", () => {
  // La discipline du web ne vaut rien si la base, elle, renvoie zéro.
  const texte = sql();
  assert.ok(
    texte.includes("then null"),
    "0087 doit rendre NULL quand un dénominateur est nul",
  );
  assert.ok(
    /avg\(current_count::numeric \/ initial_explant_count\)/.test(texte),
    "le rendement de multiplication de 0087 doit rester une moyenne de rapports, comme `multiplicationMoyenne`",
  );
});
