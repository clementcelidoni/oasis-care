import test from "node:test";
import assert from "node:assert/strict";

import {
  appliquerRemise,
  etatAbonnement,
  joursRestants,
  libelleEvenement,
  prixContractuel,
  remiseEnCours,
} from "./abonnement.ts";
import type { LigneAbonnement, LigneRemise } from "./types.ts";

/**
 * ==================================================================
 * DEUX SUJETS, ET LES DEUX SE PAIENT EN ARGENT RÉEL
 * ==================================================================
 *
 * 1. ANNULER À L'ÉCHÉANCE N'EST PAS ANNULER. Pendant qu'une annulation
 *    à l'échéance court, `status` vaut encore 'active' : un écran qui
 *    lirait le seul statut annoncerait « actif » à un client qui part,
 *    et personne ne le rappellerait avant l'échéance.
 *
 * 2. LA REMISE FONDATEUR SUR UN ABONNEMENT ANNUEL N'EST PAS DÉCIDABLE.
 *    « 29,90 € par mois pendant douze mois » posé sur un abonnement
 *    annuel : vaut-il douze fois ce prix, ou dix comme les offres
 *    annuelles de la grille ? Personne ne l'a dit. La base rend une
 *    ligne bloquante ; ce module rend `null`. Les deux doivent rester
 *    d'accord — sinon l'écran promet un prix que la facture refuse.
 */

function abonnement(partiel: Partial<LigneAbonnement>): LigneAbonnement {
  return {
    organization_id: "11111111-1111-1111-1111-111111111111",
    plan: "team",
    provider: "manual",
    status: "active",
    started_at: "2026-01-01T00:00:00Z",
    current_period_end: "2026-10-01T00:00:00Z",
    cancelled_at: null,
    external_reference: null,
    updated_at: null,
    billing_cycle: "monthly",
    negotiated_monthly_price_cents: null,
    negotiated_yearly_price_cents: null,
    billable_extra_seats: 0,
    trial_ends_at: null,
    cancel_at_period_end: false,
    currency: "EUR",
    note: null,
    managed_by: null,
    ...partiel,
  };
}

function remise(partiel: Partial<LigneRemise>): LigneRemise {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    organization_id: "11111111-1111-1111-1111-111111111111",
    code: "FONDATEUR",
    label: "Tarif fondateur",
    kind: "fixedMonthlyPrice",
    value_cents: 2990,
    percent: null,
    starts_on: "2026-01-01",
    ends_on: "2027-01-01",
    reason: "Client fondateur",
    cancelled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partiel,
  };
}

const MAINTENANT = new Date("2026-09-05T12:00:00Z");

// ------------------------------------------------------------------
// L'état réel
// ------------------------------------------------------------------

test("une annulation à l'échéance prime sur « actif » : c'est l'information décisive", () => {
  const etat = etatAbonnement(
    abonnement({ status: "active", cancel_at_period_end: true, cancelled_at: "2026-09-01T00:00:00Z" }),
    MAINTENANT,
  );
  assert.equal(etat.etat, "partALEcheance");
});

test("un essai dont la date est passée est signalé : rien ne le fait basculer en base", () => {
  const etat = etatAbonnement(
    abonnement({ status: "trialing", trial_ends_at: "2026-08-01T00:00:00Z" }),
    MAINTENANT,
  );
  assert.equal(etat.etat, "essai");
  assert.equal(etat.etat === "essai" ? etat.expire : null, true);
});

test("un essai encore devant n'est pas expiré", () => {
  const etat = etatAbonnement(
    abonnement({ status: "trialing", trial_ends_at: "2026-10-01T00:00:00Z" }),
    MAINTENANT,
  );
  assert.equal(etat.etat === "essai" ? etat.expire : null, false);
});

test("un abonnement annulé reste annulé, même avec cancel_at_period_end", () => {
  const etat = etatAbonnement(
    abonnement({ status: "cancelled", cancel_at_period_end: true, cancelled_at: "2026-05-05T00:00:00Z" }),
    MAINTENANT,
  );
  assert.equal(etat.etat, "annule");
});

// ------------------------------------------------------------------
// Les remises
// ------------------------------------------------------------------

test("la remise en vigueur est celle d'AUJOURD'HUI, bornes [début, fin(", () => {
  const finie = remise({ id: "a", starts_on: "2025-01-01", ends_on: "2026-01-01" });
  const aVenir = remise({ id: "b", starts_on: "2026-12-01", ends_on: "2027-12-01" });
  const enCours = remise({ id: "c", starts_on: "2026-06-01", ends_on: "2027-06-01" });

  assert.equal(remiseEnCours([finie, aVenir], MAINTENANT), null);
  assert.equal(remiseEnCours([finie, aVenir, enCours], MAINTENANT)?.id, "c");
});

test("une remise annulée n'est plus en vigueur", () => {
  const annulee = remise({ starts_on: "2026-06-01", ends_on: "2027-06-01", cancelled_at: "2026-07-01T00:00:00Z" });
  assert.equal(remiseEnCours([annulee], MAINTENANT), null);
});

test("le jour de la date de fin, la remise ne s'applique plus", () => {
  const finitAujourdhui = remise({ starts_on: "2025-09-05", ends_on: "2026-09-05" });
  assert.equal(remiseEnCours([finitAujourdhui], MAINTENANT), null);
});

test("le tarif fondateur impose 29,90 € et ne peut jamais augmenter la facture", () => {
  assert.equal(appliquerRemise(7990, remise({}), false), 2990);
  // Sur une offre déjà moins chère que la remise, le prix ne monte pas.
  assert.equal(appliquerRemise(1990, remise({}), false), 1990);
});

test("le tarif fondateur sur un abonnement ANNUEL est indécidable — et rend null", () => {
  assert.equal(appliquerRemise(79900, remise({}), true), null);
});

test("une remise en pourcentage arrondit au centime, comme la base", () => {
  assert.equal(appliquerRemise(7990, remise({ kind: "percentOff", value_cents: null, percent: 15 }), false), 7990 - 1199);
});

test("une remise en montant ne fait jamais descendre sous zéro", () => {
  assert.equal(appliquerRemise(1000, remise({ kind: "amountOff", value_cents: 5000 }), false), 0);
});

// ------------------------------------------------------------------
// Le prix contractuel
// ------------------------------------------------------------------

test("sans prix dans la grille, le prix contractuel est INCONNU et dit pourquoi", () => {
  const resultat = prixContractuel(abonnement({}), null, false, null);
  assert.equal(resultat.etat, "inconnu");
});

test("une offre sur devis sans prix négocié est INCONNUE, pas gratuite", () => {
  const resultat = prixContractuel(
    abonnement({ plan: "enterprise", negotiated_monthly_price_cents: null }),
    null,
    true,
    null,
  );
  assert.equal(resultat.etat, "inconnu");
  assert.match(resultat.etat === "inconnu" ? resultat.raison : "", /négocié/i);
});

test("une offre sur devis prend son prix NÉGOCIÉ, pas celui de la grille", () => {
  const resultat = prixContractuel(
    abonnement({ plan: "enterprise", negotiated_monthly_price_cents: 39000 }),
    7990,
    true,
    null,
  );
  assert.deepEqual(resultat, { etat: "prix", cents: 39000, remise: null });
});

test("la remise en cours descend le prix affiché ET porte sa date de fin", () => {
  const resultat = prixContractuel(abonnement({}), 7990, false, remise({}));
  assert.equal(resultat.etat, "prix");
  assert.equal(resultat.etat === "prix" ? resultat.cents : null, 2990);
  assert.equal(resultat.etat === "prix" ? resultat.remise?.finLe : null, "2027-01-01");
});

test("le cas indécidable remonte jusqu'au prix contractuel, il ne s'y perd pas", () => {
  const resultat = prixContractuel(abonnement({ billing_cycle: "yearly" }), 79900, false, remise({}));
  assert.equal(resultat.etat, "inconnu");
});

// ------------------------------------------------------------------
// Divers
// ------------------------------------------------------------------

test("les jours restants comptent depuis la date, et rendent null sans date", () => {
  assert.equal(joursRestants(null, MAINTENANT), null);
  assert.equal(joursRestants("pas une date", MAINTENANT), null);
  assert.equal(joursRestants("2026-09-15T12:00:00Z", MAINTENANT), 10);
});

test("un événement inconnu s'affiche tel quel plutôt que « autre »", () => {
  assert.equal(libelleEvenement("planChanged"), "Changement d'offre");
  assert.equal(libelleEvenement("quelqueChoseDeNeuf"), "quelqueChoseDeNeuf");
});
