import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ESCALADES,
  ModelEscalationService,
  SEUIL_IMPACT_ESCALADE_CENTIMES,
  tauxEscalade,
} from "./escalation.ts";
import type { Confiance, SortieModele } from "./types.ts";

/**
 * §11V — L'ESCALADE (spec p. 7).
 *
 * Ce que ce fichier défend, dans l'ordre d'importance :
 *
 *   1. « Éviter Luna → Terra → Sol sur chaque demande. » C'est la seule
 *      phrase de la page 7 qui protège de l'argent, et elle se vérifie
 *      par ce qui N'ESCALADE PAS.
 *   2. « Données insuffisantes » n'escalade jamais.
 *   3. Le plafond gagne toujours.
 */

function sortie(confiance: Confiance, ambigu = false): SortieModele {
  return {
    texte: null,
    donnees: null,
    confiance,
    ambigu,
    jetonsEntree: 1_000,
    jetonsSortie: 200,
    appelsOutils: 0,
  };
}

const service = new ModelEscalationService();

// ==================================================================
// 1. LE BARREAU BAS : economy → standard
// ==================================================================

test("economy + confiance faible → standard (p. 7, « confidence insufficient »)", () => {
  const decision = service.decider({ niveauActuel: "economy", sortie: sortie("low") });
  assert.equal(decision.escalader, true);
  if (!decision.escalader) return;
  assert.equal(decision.versNiveau, "standard");
  assert.equal(decision.etape.declencheur, "confiance_insuffisante");
});

test("economy + confiance moyenne SEULE n'escalade pas", () => {
  // Une classification « moyenne » est un résultat acceptable : c'est
  // le régime normal du petit modèle. Escalader dessus ferait monter
  // la moitié d'un corpus de mille éléments.
  const decision = service.decider({ niveauActuel: "economy", sortie: sortie("medium") });
  assert.equal(decision.escalader, false);
});

test("economy + confiance élevée n'escalade pas", () => {
  assert.equal(service.decider({ niveauActuel: "economy", sortie: sortie("high") }).escalader, false);
});

// ==================================================================
// 2. LE BARREAU HAUT : standard → advanced, ET IL EST PLUS EXIGEANT
// ==================================================================

test("standard + confiance FAIBLE seule n'escalade PAS — c'est le cœur du contrôle de coût", () => {
  const decision = service.decider({ niveauActuel: "standard", sortie: sortie("low") });
  assert.equal(
    decision.escalader,
    false,
    "Terra est le moteur de tous les agents métier : escalader sur une simple confiance " +
      "faible enverrait la moitié des demandes ordinaires sur le modèle le plus cher.",
  );
});

test("standard + ambiguïté DÉCLARÉE → advanced (p. 7, « still ambiguous »)", () => {
  const decision = service.decider({ niveauActuel: "standard", sortie: sortie("medium", true) });
  assert.equal(decision.escalader, true);
  if (!decision.escalader) return;
  assert.equal(decision.versNiveau, "advanced");
  assert.equal(decision.etape.declencheur, "ambiguite_declaree");
});

test("standard + fort impact financier → advanced (p. 7, « high impact »)", () => {
  const decision = service.decider({
    niveauActuel: "standard",
    sortie: sortie("medium"),
    impactFinancierCents: SEUIL_IMPACT_ESCALADE_CENTIMES,
  });
  assert.equal(decision.escalader, true);
  if (!decision.escalader) return;
  assert.equal(decision.etape.declencheur, "impact_financier");
});

test("standard + impact JUSTE en dessous du seuil n'escalade pas", () => {
  const decision = service.decider({
    niveauActuel: "standard",
    sortie: sortie("low"),
    impactFinancierCents: SEUIL_IMPACT_ESCALADE_CENTIMES - 1,
  });
  assert.equal(decision.escalader, false);
});

test("standard + risque critique → advanced", () => {
  const decision = service.decider({
    niveauActuel: "standard",
    sortie: sortie("medium"),
    risque: "critical",
  });
  assert.equal(decision.escalader, true);
  if (!decision.escalader) return;
  assert.equal(decision.etape.declencheur, "risque_eleve");
});

// ==================================================================
// 3. « DONNÉES INSUFFISANTES » N'ESCALADE JAMAIS
// ==================================================================

test("insufficient_data n'escalade pas, même avec un impact énorme et une ambiguïté", () => {
  for (const niveau of ["economy", "standard"] as const) {
    const decision = service.decider({
      niveauActuel: niveau,
      sortie: sortie("insufficient_data", true),
      impactFinancierCents: 10_000_000,
      risque: "critical",
    });
    assert.equal(
      decision.escalader,
      false,
      `depuis « ${niveau} » : un modèle plus cher relirait la même donnée absente`,
    );
    if (decision.escalader) return;
    assert.match(decision.raison, /donnée/i);
  }
});

// ==================================================================
// 4. LES BORNES
// ==================================================================

test("advanced n'escalade pas : il n'y a rien au-dessus", () => {
  const decision = service.decider({ niveauActuel: "advanced", sortie: sortie("low", true) });
  assert.equal(decision.escalader, false);
});

test("le plafond de l'organisation gagne sur le déclencheur", () => {
  const decision = service.decider({
    niveauActuel: "standard",
    sortie: sortie("low", true),
    plafond: "standard",
  });
  assert.equal(decision.escalader, false);
  if (decision.escalader) return;
  assert.match(decision.raison, /plafond/i);
});

test("deux escalades au maximum", () => {
  const decision = service.decider({
    niveauActuel: "standard",
    sortie: sortie("low", true),
    escaladesDejaFaites: MAX_ESCALADES,
  });
  assert.equal(decision.escalader, false);
});

test("un niveau déjà essayé n'est pas rappelé", () => {
  const decision = service.decider({
    niveauActuel: "standard",
    sortie: sortie("low", true),
    niveauxDejaEssayes: ["advanced", "standard"],
  });
  assert.equal(decision.escalader, false);
  if (decision.escalader) return;
  assert.match(decision.raison, /déjà été essayé/);
});

// ==================================================================
// 5. LE MONTANT ILLISIBLE LÈVE — il ne devient pas zéro
// ==================================================================

test("un impact NaN lève au lieu de valoir zéro", () => {
  assert.throws(
    () =>
      service.decider({
        niveauActuel: "standard",
        sortie: sortie("low"),
        impactFinancierCents: Number.NaN,
      }),
    TypeError,
  );
});

test("un impact flottant lève : les montants sont des centimes entiers", () => {
  assert.throws(
    () =>
      service.decider({
        niveauActuel: "standard",
        sortie: sortie("low"),
        impactFinancierCents: 384.5,
      }),
    TypeError,
  );
});

test("un impact absent (null) n'est pas un impact nul", () => {
  // `null` ne doit pas lever, et ne doit pas non plus déclencher
  // l'escalade « fort impact ».
  const decision = service.decider({
    niveauActuel: "standard",
    sortie: sortie("low"),
    impactFinancierCents: null,
  });
  assert.equal(decision.escalader, false);
});

// ==================================================================
// 6. LE CHEMIN COMPLET DE LA PAGE 7, MAIS SEULEMENT QUAND IL EST DÛ
// ==================================================================

test("Luna → Terra → Sol est possible, en deux déclencheurs distincts", () => {
  const premier = service.decider({ niveauActuel: "economy", sortie: sortie("low") });
  assert.equal(premier.escalader, true);
  if (!premier.escalader) return;
  assert.equal(premier.versNiveau, "standard");

  const second = service.decider({
    niveauActuel: "standard",
    sortie: sortie("medium", true),
    escaladesDejaFaites: 1,
    niveauxDejaEssayes: ["economy", "standard"],
  });
  assert.equal(second.escalader, true);
  if (!second.escalader) return;
  assert.equal(second.versNiveau, "advanced");
});

test("… mais une demande ordinaire ne parcourt pas la chaîne", () => {
  // Le scénario que la page 7 interdit : le petit modèle rend une
  // réponse faible sur une question sans enjeu. Il monte d'un cran, et
  // s'arrête là.
  const premier = service.decider({ niveauActuel: "economy", sortie: sortie("low") });
  assert.equal(premier.escalader, true);

  const second = service.decider({
    niveauActuel: "standard",
    sortie: sortie("low"),
    escaladesDejaFaites: 1,
  });
  assert.equal(second.escalader, false, "la chaîne complète doit rester exceptionnelle");
});

// ==================================================================
// 7. LE DÉPART, ET LA MESURE
// ==================================================================

test("un agent configuré standard démarre sur standard, pas sur economy", () => {
  assert.equal(service.niveauDeDepart("standard"), "standard");
});

test("le plafond rabaisse le niveau de départ", () => {
  assert.equal(service.niveauDeDepart("advanced", "standard"), "standard");
});

test("le taux d'escalade rend null quand il n'y a rien à mesurer", () => {
  assert.equal(tauxEscalade(0, 0), null, "0 % se lirait « tout va bien »");
  assert.equal(tauxEscalade(200, 7), 3.5);
});
