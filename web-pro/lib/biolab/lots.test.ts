import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRI_PAR_DEFAUT,
  arbreDeLignee,
  construireLien,
  facteurDeMultiplication,
  filtreActif,
  lireParametres,
  nomDePlante,
  tailleDeLignee,
  tauxDeSurvie,
  type Acclimatation,
  type LigneGenealogie,
  type ParametresListe,
} from "./lots.ts";

/**
 * §37 / §7 — CE QUE CE FICHIER ÉPROUVE.
 *
 * Trois familles de bogues silencieux, chacune déjà rencontrée
 * ailleurs dans ce produit :
 *
 *   1. UN PARAMÈTRE D'URL INVENTÉ QUI DESCEND DANS UNE REQUÊTE. Un
 *      `?stade=n-importe-quoi` doit donner la liste entière, pas une
 *      erreur ni un filtre que personne n'a demandé.
 *
 *   2. UN LIEN DE FILTRE QUI N'EST PAS ÉGAL À LUI-MÊME. `FilterBar`
 *      compare des CHAÎNES pour savoir quelle pastille est allumée : si
 *      deux appels décrivant le même état produisaient deux chaînes,
 *      aucune pastille ne s'allumerait, et personne ne saurait dire
 *      pourquoi.
 *
 *   3. UNE LIGNÉE QUI PERD UNE BRANCHE. La récursion de la base est
 *      bornée à 64 niveaux et un parent peut vivre dans un autre espace
 *      de travail : un lot dont le parent manque doit devenir une racine
 *      de l'affichage, jamais disparaître.
 */

const VIDE: ParametresListe = {
  q: "",
  stade: "",
  statut: "",
  lignee: "",
  echeance: "",
  contamination: "",
  inspection: "",
  tri: TRI_PAR_DEFAUT,
  page: 1,
};

// ==================================================================
// 1. CE QUE L'URL PORTE
// ==================================================================

test("des paramètres absents donnent la liste entière", () => {
  assert.deepEqual(lireParametres({}), VIDE);
  assert.equal(filtreActif(VIDE), false);
});

test("une valeur inventée dans l'URL est ignorée, pas propagée", () => {
  const p = lireParametres({
    stade: "callogenese",
    statut: "zombie",
    lignee: "peu-importe",
    echeance: "jamais",
    contamination: "oui",
    inspection: "parfois",
    tri: "prix",
  });
  assert.deepEqual(p, VIDE);
});

test("les valeurs réelles, elles, passent", () => {
  const p = lireParametres({
    q: "  Alocasia  ",
    stade: "multiplication",
    statut: "active",
    lignee: "sous-lots",
    echeance: "depassee",
    contamination: "confirmee",
    inspection: "jamais",
    tri: "code",
    page: "3",
  });
  assert.equal(p.q, "Alocasia");
  assert.equal(p.stade, "multiplication");
  assert.equal(p.statut, "active");
  assert.equal(p.lignee, "sous-lots");
  assert.equal(p.echeance, "depassee");
  assert.equal(p.contamination, "confirmee");
  assert.equal(p.inspection, "jamais");
  assert.equal(p.tri, "code");
  assert.equal(p.page, 3);
  assert.equal(filtreActif(p), true);
});

test("un paramètre répété ne garde que sa première valeur", () => {
  // `?stade=rooting&stade=discarded` ne doit pas produire un filtre
  // composite que la requête ne saurait pas poser.
  assert.equal(lireParametres({ stade: ["rooting", "discarded"] }).stade, "rooting");
});

test("une page absurde retombe sur la première", () => {
  assert.equal(lireParametres({ page: "0" }).page, 1);
  assert.equal(lireParametres({ page: "-4" }).page, 1);
  assert.equal(lireParametres({ page: "bonjour" }).page, 1);
});

test("le lien d'un état sans filtre est l'URL nue", () => {
  assert.equal(construireLien(VIDE), "/biolab/lots");
});

test("deux appels décrivant le même état produisent la même chaîne", () => {
  // C'est ce dont dépend `FilterBar` pour allumer la bonne pastille.
  const a = construireLien({ ...VIDE, stade: "rooting" });
  const b = construireLien(VIDE, { stade: "rooting" });
  assert.equal(a, b);
  assert.equal(a, "/biolab/lots?stade=rooting");
});

test("le tri par défaut n'encombre pas l'URL", () => {
  assert.equal(construireLien({ ...VIDE, tri: TRI_PAR_DEFAUT }), "/biolab/lots");
  assert.equal(construireLien({ ...VIDE, tri: "espece" }), "/biolab/lots?tri=espece");
});

test("changer de filtre remet à la première page", () => {
  // Sinon on atterrit sur la page 4 d'une liste qui n'en a plus que
  // deux, et l'écran paraît vide alors qu'il ne l'est pas.
  const lien = construireLien({ ...VIDE, page: 4, stade: "rooting" }, { stade: "initiation" });
  assert.equal(lien, "/biolab/lots?stade=initiation");
  assert.ok(!lien.includes("page="));
});

test("la pagination, elle, reporte bien les filtres en cours", () => {
  const lien = construireLien({ ...VIDE, q: "Alocasia", stade: "rooting" }, { page: "2" });
  assert.equal(lien, "/biolab/lots?q=Alocasia&stade=rooting&page=2");
});

test("retirer un filtre le fait disparaître de l'URL", () => {
  const lien = construireLien(
    { ...VIDE, echeance: "depassee", contamination: "confirmee", inspection: "jamais" },
    { echeance: "", contamination: "", inspection: "" },
  );
  assert.equal(lien, "/biolab/lots");
});

test("une recherche est encodée, pas recopiée telle quelle", () => {
  const lien = construireLien({ ...VIDE, q: "Alocasia 'Scalprum' & co" });
  assert.ok(!lien.includes(" "));
  assert.equal(new URL(lien, "https://x").searchParams.get("q"), "Alocasia 'Scalprum' & co");
});

// ==================================================================
// 2. LA LIGNÉE
// ==================================================================

function noeud(
  id: string,
  code: string,
  parent: string | null,
  profondeur: number,
): LigneGenealogie {
  return {
    lot_id: id,
    code,
    espece: "Alocasia scalprum",
    stade: "multiplication",
    statut: "active",
    explants: 10,
    parent_id: parent,
    profondeur,
    est_racine: parent === null,
  };
}

test("une lignée plate devient un arbre emboîté", () => {
  const arbre = arbreDeLignee([
    noeud("r", "A-000", null, 0),
    noeud("b", "A-002", "r", 1),
    noeud("a", "A-001", "r", 1),
    noeud("c", "A-001-1", "a", 2),
  ]);

  assert.equal(arbre.length, 1);
  assert.equal(arbre[0].code, "A-000");
  // Trié sur le code, comme le téléphone (`childBatches.sorted`), pour
  // que les deux montrent le même arbre dans le même ordre.
  assert.deepEqual(
    arbre[0].enfants.map((n) => n.code),
    ["A-001", "A-002"],
  );
  assert.equal(arbre[0].enfants[0].enfants[0].code, "A-001-1");
  assert.equal(tailleDeLignee(arbre), 4);
});

test("un lot dont le parent manque devient une racine, il ne disparaît pas", () => {
  // Le parent peut vivre dans un autre espace de travail, ou la
  // récursion bornée à 64 niveaux peut l'avoir laissé dehors. Perdre la
  // branche silencieusement serait le pire des deux comportements.
  const arbre = arbreDeLignee([
    noeud("a", "A-001", "parent-invisible", 0),
    noeud("b", "A-001-1", "a", 1),
  ]);
  assert.equal(arbre.length, 1);
  assert.equal(arbre[0].code, "A-001");
  assert.equal(arbre[0].enfants.length, 1);
  assert.equal(tailleDeLignee(arbre), 2);
});

test("deux racines coexistent et restent triées", () => {
  const arbre = arbreDeLignee([noeud("z", "B-001", null, 0), noeud("a", "A-001", null, 0)]);
  assert.deepEqual(
    arbre.map((n) => n.code),
    ["A-001", "B-001"],
  );
});

test("un identifiant rendu deux fois n'apparaît qu'une fois", () => {
  const arbre = arbreDeLignee([
    noeud("r", "A-000", null, 0),
    noeud("a", "A-001", "r", 1),
    noeud("a", "A-001", "r", 1),
  ]);
  assert.equal(tailleDeLignee(arbre), 2);
});

test("un lot qui serait son propre parent ne fait pas boucler l'affichage", () => {
  // La base borne sa récursion à 64 niveaux précisément parce que
  // `parent_batch_id` n'interdit pas un cycle. La mise en arbre doit
  // tenir le même coup : ici le lot devient une racine plutôt que son
  // propre enfant.
  const arbre = arbreDeLignee([noeud("a", "A-001", "a", 0)]);
  assert.equal(arbre.length, 1);
  assert.equal(arbre[0].enfants.length, 0);
  assert.equal(tailleDeLignee(arbre), 1);
});

test("une lignée vide ne produit pas d'arbre fantôme", () => {
  assert.deepEqual(arbreDeLignee([]), []);
  assert.equal(tailleDeLignee([]), 0);
});

// ==================================================================
// 3. LES DEUX RAPPORTS LIGNE À LIGNE
// ==================================================================

function passage(entrees: number, survivantes: number): Acclimatation {
  return {
    id: "x",
    culture_batch_id: "l",
    started_at: "2026-09-01T00:00:00Z",
    initial_plantlet_count: entrees,
    current_survivor_count: survivantes,
    substrate: null,
    humidity_program: null,
    temperature: null,
    location: null,
    status: "active",
    plants_created: false,
    notes: null,
  };
}

test("un taux de survie sans plantule entrée est NULL, pas zéro", () => {
  // « 0 % de survie » accuserait un protocole ; « aucune plantule
  // n'est entrée » ne dit rien de lui. `AcclimatizationBatch.survivalRate`
  // fait la même distinction sur le téléphone.
  assert.equal(tauxDeSurvie(passage(0, 0)), null);
  assert.equal(tauxDeSurvie(passage(100, 0)), 0);
  assert.equal(tauxDeSurvie(passage(100, 82)), 0.82);
});

test("un rendement sans explant de départ est NULL, pas zéro", () => {
  assert.equal(facteurDeMultiplication({ initial_explant_count: 0, current_count: 40 }), null);
  assert.equal(facteurDeMultiplication({ initial_explant_count: 10, current_count: 34 }), 3.4);
  assert.equal(facteurDeMultiplication({ initial_explant_count: 10, current_count: 0 }), 0);
});

// ==================================================================
// 4. LE NOM D'UNE PLANTE
// ==================================================================

test("une plante est nommée par ce que son propriétaire lui a donné, sinon par la botanique", () => {
  assert.equal(
    nomDePlante({
      id: "1",
      custom_name: "La grande",
      common_name: "Alocasia",
      scientific_name: "Alocasia scalprum",
      garden_id: null,
      is_archived: false,
    }),
    "La grande",
  );
  assert.equal(
    nomDePlante({
      id: "1",
      custom_name: "   ",
      common_name: "Alocasia",
      scientific_name: "Alocasia scalprum",
      garden_id: null,
      is_archived: false,
    }),
    "Alocasia",
  );
  assert.equal(
    nomDePlante({
      id: "1",
      custom_name: null,
      common_name: null,
      scientific_name: "Alocasia scalprum",
      garden_id: null,
      is_archived: false,
    }),
    "Alocasia scalprum",
  );
  // Jamais une chaîne vide : une ligne sans texte se lirait comme un
  // bogue d'affichage.
  assert.equal(
    nomDePlante({
      id: "1",
      custom_name: null,
      common_name: null,
      scientific_name: null,
      garden_id: null,
      is_archived: false,
    }),
    "Plante sans nom",
  );
});
