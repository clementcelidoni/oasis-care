import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEUIL_IMPACT_NON_DEGRADABLE_CENTIMES,
  avertissementRepli,
  classerPanne,
  deciderRepli,
} from "./fallback.ts";
import { MESSAGE_INDISPONIBLE, MOTIFS_PANNE, PANNES_FOURNISSEUR } from "./types.ts";

/**
 * §11V — LE REPLI (spec p. 23).
 *
 * Le test qui compte le plus est celui qui vérifie qu'on NE REPLIE PAS.
 * Un repli qui marche est facile à écrire ; un repli qui refuse de
 * dégrader une décision critique est ce que la page 23 demande, et
 * c'est ce qu'on oublie.
 */

// ==================================================================
// 1. RECONNAÎTRE LA PANNE — les quatre motifs de la page 23
// ==================================================================

test("une limite de débit se reconnaît par le statut 429", () => {
  assert.equal(classerPanne(Object.assign(new Error("boom"), { status: 429 })), "rate_limit");
});

test("une limite de débit se reconnaît aussi par le texte", () => {
  assert.equal(classerPanne(new Error("Rate limit reached for requests")), "rate_limit");
});

test("un modèle inexistant se reconnaît par le 404 et par le texte", () => {
  assert.equal(
    classerPanne(Object.assign(new Error("nope"), { status: 404 })),
    "model_unavailable",
  );
  assert.equal(
    classerPanne(new Error("The model `quelquechose` does not exist")),
    "model_unavailable",
  );
});

test("un abandon de requête est un délai dépassé", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(classerPanne(abort), "timeout");
  assert.equal(classerPanne(new Error("request timed out")), "timeout");
});

test("un 5xx et une panne réseau sont des erreurs de fournisseur", () => {
  assert.equal(classerPanne(Object.assign(new Error("x"), { status: 503 })), "provider_error");
  assert.equal(classerPanne(new Error("fetch failed")), "provider_error");
});

test("une erreur non identifiée reste « other » et n'est pas rangée d'office", () => {
  // La ranger en « provider_error » enverrait chercher la panne chez le
  // fournisseur alors qu'il s'agit peut-être d'un bug chez nous.
  assert.equal(classerPanne(new Error("undefined is not a function")), "other");
  assert.equal(classerPanne(null), "other");
});

test("tous les motifs rendus appartiennent au vocabulaire fermé de 0076", () => {
  const echantillons: unknown[] = [
    Object.assign(new Error("a"), { status: 429 }),
    Object.assign(new Error("b"), { status: 404 }),
    Object.assign(new Error("c"), { status: 500 }),
    new Error("timed out"),
    new Error("n'importe quoi"),
    undefined,
  ];
  for (const echantillon of echantillons) {
    assert.ok(
      (MOTIFS_PANNE as readonly string[]).includes(classerPanne(echantillon)),
      "un motif hors liste ferait échouer l'insertion du journal d'usage",
    );
  }
});

test("le motif ne transporte aucun fragment du message d'origine", () => {
  // Un corps de réponse d'API peut contenir une clé ou un identifiant.
  const motif = classerPanne(new Error("Incorrect API key provided: sk-proj-SECRET123"));
  assert.equal(typeof motif, "string");
  assert.ok(!motif.includes("SECRET"), "le motif est un membre d'énumération, jamais un texte");
});

// ==================================================================
// 2. ON DÉGRADE — mais seulement ce qui peut l'être
// ==================================================================

test("advanced indisponible → standard pour une tâche ordinaire (p. 23)", () => {
  const decision = deciderRepli({
    motif: "model_unavailable",
    niveauActuel: "advanced",
    modeleActuel: "modele-avance",
    criticite: "ordinaire",
  });
  assert.equal(decision.replier, true);
  if (!decision.replier) return;
  assert.equal(decision.versNiveau, "standard");

  const info = decision.construireInfo("modele-standard");
  assert.equal(info.deModele, "modele-avance");
  assert.equal(info.versModele, "modele-standard");
  assert.equal(info.motif, "model_unavailable");
});

test("le repli produit un avertissement destiné à l'écran — jamais silencieux", () => {
  const decision = deciderRepli({
    motif: "timeout",
    niveauActuel: "standard",
    modeleActuel: "modele-standard",
    criticite: "ordinaire",
  });
  assert.equal(decision.replier, true);
  if (!decision.replier) return;
  const phrase = avertissementRepli(decision.construireInfo("modele-economique"));
  assert.match(phrase, /dégradée/i);
  assert.match(phrase, /Relisez-la/i);
});

// ==================================================================
// 3. ON NE DÉGRADE PAS — les quatre refus
// ==================================================================

test("une décision déclarée CRITIQUE ne se dégrade jamais", () => {
  const decision = deciderRepli({
    motif: "model_unavailable",
    niveauActuel: "advanced",
    modeleActuel: "modele-avance",
    criticite: "critique",
  });
  assert.equal(decision.replier, false);
  if (decision.replier) return;
  assert.equal(
    decision.message,
    MESSAGE_INDISPONIBLE,
    "la page 23 donne la phrase exacte à afficher",
  );
});

test("un risque élevé ne se dégrade pas", () => {
  const decision = deciderRepli({
    motif: "rate_limit",
    niveauActuel: "advanced",
    modeleActuel: "modele-avance",
    criticite: "ordinaire",
    risque: "high",
  });
  assert.equal(decision.replier, false);
});

test("un fort impact financier ne se dégrade pas", () => {
  const decision = deciderRepli({
    motif: "provider_error",
    niveauActuel: "advanced",
    modeleActuel: "modele-avance",
    criticite: "ordinaire",
    impactFinancierCents: SEUIL_IMPACT_NON_DEGRADABLE_CENTIMES,
  });
  assert.equal(decision.replier, false);
  if (decision.replier) return;
  assert.equal(decision.message, MESSAGE_INDISPONIBLE);
});

test("un impact ANNONCÉ mais illisible ne se dégrade pas non plus", () => {
  // Le réflexe habituel serait `?? 0`, donc « en dessous du seuil »,
  // donc dégradation. Ici le doute protège l'utilisateur.
  const decision = deciderRepli({
    motif: "timeout",
    niveauActuel: "advanced",
    modeleActuel: "modele-avance",
    criticite: "ordinaire",
    impactFinancierCents: Number.NaN,
  });
  assert.equal(decision.replier, false);
  if (decision.replier) return;
  assert.match(decision.raison, /illisible/);
});

test("un impact non annoncé (undefined ou null) reste dégradable", () => {
  // La plupart des appels n'ont aucun montant à annoncer. Si l'absence
  // de montant bloquait le repli, le repli n'aurait jamais lieu — et
  // `run.ts` passe précisément `financialImpact ?? null`.
  for (const impactFinancierCents of [undefined, null]) {
    const decision = deciderRepli({
      motif: "timeout",
      niveauActuel: "advanced",
      modeleActuel: "modele-avance",
      criticite: "ordinaire",
      impactFinancierCents,
    });
    assert.equal(decision.replier, true, `impact = ${String(impactFinancierCents)}`);
  }
});

test("le niveau le plus bas n'a nulle part où se replier", () => {
  const decision = deciderRepli({
    motif: "model_unavailable",
    niveauActuel: "economy",
    modeleActuel: "modele-economique",
    criticite: "ordinaire",
  });
  assert.equal(decision.replier, false);
  if (decision.replier) return;
  assert.equal(decision.message, MESSAGE_INDISPONIBLE);
});

test("un niveau déjà en échec dans cet appel n'est pas rappelé", () => {
  const decision = deciderRepli({
    motif: "provider_error",
    niveauActuel: "advanced",
    modeleActuel: "modele-avance",
    criticite: "ordinaire",
    niveauxDejaEssayes: ["standard", "advanced"],
  });
  assert.equal(decision.replier, false);
});

test("un plancher explicite empêche de descendre plus bas", () => {
  const decision = deciderRepli({
    motif: "timeout",
    niveauActuel: "standard",
    modeleActuel: "modele-standard",
    criticite: "ordinaire",
    plancher: "standard",
  });
  assert.equal(decision.replier, false);
});

// ==================================================================
// 4. LE PLAFOND DE DÉPENSE N'EST PAS UNE PANNE
// ==================================================================

test("un plafond atteint ne déclenche PAS un repli vers un modèle moins cher", () => {
  const decision = deciderRepli({
    motif: "budget_exceeded",
    niveauActuel: "advanced",
    modeleActuel: "modele-avance",
    criticite: "ordinaire",
  });
  assert.equal(decision.replier, false, "un modèle moins cher dépense quand même");
  if (decision.replier) return;
  assert.match(decision.message, /plafond/i);
  assert.notEqual(
    decision.message,
    MESSAGE_INDISPONIBLE,
    "un plafond n'est pas une panne : le message doit dire quoi faire",
  );
});

// ==================================================================
// 5. UN BUG CHEZ NOUS N'EST PAS UNE PANNE DU FOURNISSEUR
// ==================================================================

test("« other » ne déclenche PAS de repli : un autre modèle échouerait pareil", () => {
  // `classerPanne` rend « other » quand elle n'a rien reconnu, et son
  // commentaire dit pourquoi : c'est peut-être un bug chez nous. Une
  // sortie qui ne colle pas au schéma, un outil qui lève, un
  // `undefined is not a function` en sont — et ces pannes-là sont
  // DÉTERMINISTES. Replier paierait un second appel complet pour
  // obtenir la même erreur, et inscrirait au grand livre un
  // `fallback_from_model` qui ferait chercher une panne de fournisseur
  // là où il y a un défaut de code.
  const decision = deciderRepli({
    motif: "other",
    niveauActuel: "advanced",
    modeleActuel: "modele-avance",
    criticite: "ordinaire",
  });

  assert.equal(decision.replier, false);
  if (decision.replier) return;
  assert.equal(decision.message, MESSAGE_INDISPONIBLE);
  assert.match(decision.raison, /pas une panne du fournisseur/);
});

test("les quatre pannes de la page 23, elles, replient bien", () => {
  for (const motif of PANNES_FOURNISSEUR) {
    const decision = deciderRepli({
      motif,
      niveauActuel: "advanced",
      modeleActuel: "modele-avance",
      criticite: "ordinaire",
    });
    assert.equal(decision.replier, true, `« ${motif} » est une panne du fournisseur (p. 23)`);
  }
});
