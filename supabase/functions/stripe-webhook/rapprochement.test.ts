// Oasis Care — Chantier Stripe. LES PREUVES SUR LE RAPPROCHEMENT.
//
//     node --test --experimental-strip-types \
//       "supabase/functions/stripe-webhook/rapprochement.test.ts"
//
// C'est le module qui décide SUR QUELLE FACTURE tombe l'argent. Il ne
// fait aucune entrée-sortie, donc il s'éprouve entièrement à la main,
// sans base et sans réseau — et il le mérite : se tromper ici solde une
// dette qui n'était pas due et en laisse une autre impayée, sans qu'une
// seule erreur ne s'affiche nulle part.

import { test } from "node:test";
import assert from "node:assert/strict";

import { rapprocher, type FactureCandidate } from "./rapprochement.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const AUTRE_ORG = "22222222-2222-2222-2222-222222222222";

function facture(surcharge: Partial<FactureCandidate> = {}): FactureCandidate {
  return {
    id: "f-1",
    organizationId: ORG,
    devise: "EUR",
    statut: "issued",
    resteCentimes: 9588,
    ...surcharge,
  };
}

// ==================================================================
// VOIE 1 — LA FACTURE ANNONCÉE PAR LES MÉTADONNÉES
// ==================================================================

test("la facture annoncée est retenue quand tout concorde", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: "f-1",
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [facture()],
  });
  assert.deepEqual(choix, { trouve: true, factureId: "f-1", voie: "metadonnee" });
});

test("UNE MÉTADONNÉE N'EST PAS UNE PREUVE : la facture annoncée doit exister", () => {
  // Les métadonnées d'un objet Stripe se modifient depuis le tableau de
  // bord. Une facture désignée mais absente des candidates — parce
  // qu'elle n'est pas émise, parce qu'elle est annulée, parce qu'elle
  // n'existe pas — ne rapproche rien.
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: "f-inconnue",
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [facture()],
  });
  assert.equal(choix.trouve, false);
  assert.match(choix.motif, /f-inconnue/);
});

test("PAYER LA FACTURE D'UNE AUTRE ENTREPRISE EST REFUSÉ", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: "f-1",
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [facture({ organizationId: AUTRE_ORG })],
  });
  assert.equal(choix.trouve, false);
  assert.match(choix.motif, /Incohérence/);
  assert.match(choix.motif, new RegExp(AUTRE_ORG));
});

test("une devise discordante est refusée", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: "f-1",
    montantCentimes: 9588,
    devise: "USD",
    candidates: [facture({ devise: "EUR" })],
  });
  assert.equal(choix.trouve, false);
  assert.match(choix.motif, /Devise discordante/);
});

test("UN TROP-PERÇU EST REFUSÉ — un reste à payer négatif ne se rattrape pas tout seul", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: "f-1",
    montantCentimes: 9589,
    devise: "EUR",
    candidates: [facture({ resteCentimes: 9588 })],
  });
  assert.equal(choix.trouve, false);
  assert.match(choix.motif, /Trop-perçu/);
});

test("un paiement PARTIEL sur la facture annoncée est accepté — acompte puis solde", () => {
  // `saas_invoice_payments` est une table et non deux colonnes,
  // précisément pour que ce cas existe. Le statut de la facture suivra
  // le solde côté base ; ici, on ne fait qu'accepter le rapprochement.
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: "f-1",
    montantCentimes: 4000,
    devise: "EUR",
    candidates: [facture({ resteCentimes: 9588 })],
  });
  assert.equal(choix.trouve, true);
});

test("un reste à payer INCONNU ne déclenche pas le refus de trop-perçu", () => {
  // On ne compare pas un montant à ce qu'on ne connaît pas. Le `null`
  // ne devient pas zéro parce que ce serait plus simple.
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: "f-1",
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [facture({ resteCentimes: null })],
  });
  assert.equal(choix.trouve, true);
});

test("la facture annoncée est retenue même sans entreprise résolue", () => {
  // Le contrôle d'appartenance ne peut pas se faire, mais la facture
  // existe, est émise, et est dans la bonne devise : c'est le chemin du
  // tout premier paiement, où le tunnel a posé l'identifiant lui-même.
  const choix = rapprocher({
    organisationResolue: null,
    factureDemandee: "f-1",
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [facture()],
  });
  assert.equal(choix.trouve, true);
});

// ==================================================================
// VOIE 2 — LE MONTANT, ET SEULEMENT S'IL EST SANS AMBIGUÏTÉ
// ==================================================================

test("le montant rapproche quand une SEULE facture y correspond", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: null,
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [
      facture({ id: "f-1", resteCentimes: 9588 }),
      facture({ id: "f-2", resteCentimes: 4790 }),
    ],
  });
  assert.deepEqual(choix, { trouve: true, factureId: "f-1", voie: "montantUnique" });
});

test("DEUX FACTURES AU MÊME MONTANT : ON NE DEVINE PAS", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: null,
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [
      facture({ id: "f-1", resteCentimes: 9588 }),
      facture({ id: "f-2", resteCentimes: 9588 }),
    ],
  });
  assert.equal(choix.trouve, false);
  assert.match(choix.motif, /ambigu/);
});

test("le rapprochement par montant est EXACT — un centime d'écart ne passe pas", () => {
  // Volontairement strict. Un « à peu près » ici solderait une facture
  // avec l'argent d'une autre période, et l'écart se découvrirait au
  // bilan, des mois plus tard.
  for (const montant of [9587, 9589]) {
    const choix = rapprocher({
      organisationResolue: ORG,
      factureDemandee: null,
      montantCentimes: montant,
      devise: "EUR",
      candidates: [facture({ resteCentimes: 9588 })],
    });
    assert.equal(choix.trouve, false, `${montant} centimes n'aurait pas dû rapprocher 9588.`);
  }
});

test("une facture d'une AUTRE entreprise n'est jamais éligible au rapprochement par montant", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: null,
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [facture({ id: "f-autre", organizationId: AUTRE_ORG, resteCentimes: 9588 })],
  });
  assert.equal(choix.trouve, false);
  assert.match(choix.motif, /Aucune facture/);
});

test("un reste à payer INCONNU écarte la facture du rapprochement par montant", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: null,
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [facture({ resteCentimes: null })],
  });
  assert.equal(choix.trouve, false);
});

test("SANS ENTREPRISE ET SANS FACTURE ANNONCÉE, RIEN N'EST INVENTÉ", () => {
  const choix = rapprocher({
    organisationResolue: null,
    factureDemandee: null,
    montantCentimes: 9588,
    devise: "EUR",
    candidates: [facture()],
  });
  assert.equal(choix.trouve, false);
  assert.match(choix.motif, /Entreprise inconnue/);
});

test("la devise est comparée pour le rapprochement par montant aussi", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: null,
    montantCentimes: 9588,
    devise: "USD",
    candidates: [facture({ devise: "EUR", resteCentimes: 9588 })],
  });
  assert.equal(choix.trouve, false);
});

test("le rapprochement NE LÈVE JAMAIS, même sans aucune candidate", () => {
  const choix = rapprocher({
    organisationResolue: ORG,
    factureDemandee: null,
    montantCentimes: 1,
    devise: "EUR",
    candidates: [],
  });
  assert.equal(choix.trouve, false);
});
