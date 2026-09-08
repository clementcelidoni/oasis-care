import { test } from "node:test";
import assert from "node:assert/strict";

import { etapeParDefaut, installationARappeler, type EtatDuTunnel } from "./aiguillage.ts";

function etat(patch: Partial<EtatDuTunnel> = {}): EtatDuTunnel {
  return {
    demandee: null,
    organisationExiste: false,
    abonnementExiste: false,
    paiementEnCours: false,
    ...patch,
  };
}

// ------------------------------------------------------------------
// L'ÉTAPE DEMANDÉE PRIME — c'est ce qui permet de revenir corriger
// ------------------------------------------------------------------

test("une étape explicite prime sur l'état réel", () => {
  assert.equal(
    etapeParDefaut(etat({ demandee: "societe", organisationExiste: true, abonnementExiste: true })),
    "societe",
  );
  assert.equal(
    etapeParDefaut(etat({ demandee: "offre", organisationExiste: true, abonnementExiste: true })),
    "offre",
  );
});

test("une étape inventée ne détourne pas le parcours", () => {
  assert.equal(etapeParDefaut(etat({ demandee: "paiement" })), "societe");
  assert.equal(etapeParDefaut(etat({ demandee: "" })), "societe");
  assert.equal(etapeParDefaut(etat({ demandee: "  offre  ", organisationExiste: true })), "offre");
});

// ------------------------------------------------------------------
// LE COMPTE NEUF — la porte du péage, et rien d'autre
// ------------------------------------------------------------------

test("un compte sans entreprise commence par la société", () => {
  assert.equal(etapeParDefaut(etat()), "societe");
});

test("une entreprise sans abonnement tombe sur la grille des offres", () => {
  assert.equal(etapeParDefaut(etat({ organisationExiste: true })), "offre");
});

// ------------------------------------------------------------------
// L'ABANDON, ET LE RETOUR DU PRESTATAIRE
// ------------------------------------------------------------------

test("celui qui a fermé l'onglet après avoir créé sa société revient sur l'offre", () => {
  // C'est le cas mesuré en production : entreprise créée, aucune ligne
  // d'abonnement, aucun profil fiscal. L'écran qui rattrape est la
  // grille, jamais le formulaire société déjà rempli.
  assert.equal(
    etapeParDefaut(etat({ organisationExiste: true, abonnementExiste: false })),
    "offre",
  );
});

test("le retour du prestataire tombe sur la confirmation même sans ligne en base", () => {
  // LE CAS QUI COMPTE : le navigateur revient avant l'événement signé.
  // Renvoyer cette personne sur la grille des offres, quelques secondes
  // après qu'elle a donné sa carte, serait le pire écran possible.
  assert.equal(
    etapeParDefaut(etat({ organisationExiste: true, paiementEnCours: true })),
    "confirmation",
  );
});

test("un abonnement existant mène à la confirmation, pas à la grille", () => {
  assert.equal(
    etapeParDefaut(etat({ organisationExiste: true, abonnementExiste: true })),
    "confirmation",
  );
});

test("un abonnement résilié compte comme existant", () => {
  // `saas_start_subscription` refuse toute entreprise portant déjà une
  // ligne, résiliée comprise : la grille lui promettrait un bouton qui
  // échoue. L'aiguillage ne connaît que l'existence de la ligne, ce qui
  // rend cette confusion impossible.
  assert.equal(
    etapeParDefaut(etat({ organisationExiste: true, abonnementExiste: true })),
    "confirmation",
  );
});

test("sans entreprise, ni le cookie ni l'abonnement ne sautent l'étape société", () => {
  assert.equal(
    etapeParDefaut(etat({ paiementEnCours: true, abonnementExiste: true })),
    "societe",
  );
});

// ------------------------------------------------------------------
// L'INSTALLATION DU LOGICIEL — rappelée, jamais imposée
// ------------------------------------------------------------------

test("une installation terminée ne se rappelle plus", () => {
  assert.equal(
    installationARappeler({ onboardingStep: 5, onboardingCompletedAt: "2026-09-01T10:00:00Z" }),
    false,
  );
});

test("une installation commencée et laissée en plan se rappelle", () => {
  assert.equal(installationARappeler({ onboardingStep: 3, onboardingCompletedAt: null }), true);
  assert.equal(installationARappeler({ onboardingStep: 7, onboardingCompletedAt: null }), true);
});

test("une entreprise née avant ce parcours ne se voit rien proposer", () => {
  // `onboarding_step` vaut zéro par défaut (migration 0060). Proposer
  // d'installer son espace à quelqu'un qui travaille depuis six mois
  // serait pire qu'inutile.
  assert.equal(installationARappeler({ onboardingStep: 0, onboardingCompletedAt: null }), false);
  assert.equal(installationARappeler({ onboardingStep: null, onboardingCompletedAt: null }), false);
});
