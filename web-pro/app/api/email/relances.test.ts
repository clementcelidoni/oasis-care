import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calculerRelancesDues, devisEncoreRelancable, envoyerRelancesDues,
  factureEncoreRelancable, rangRelanceDu,
} from "./relances.ts";
import { PortEmailNonBranche } from "./port.ts";
import {
  LecteurDouble, PortEspion, ORGANISATION_DE_TEST, reglagesActifs, unDevis, uneFacture,
} from "./doubles.ts";

/**
 * §EMAILS — LES RELANCES, ÉPROUVÉES SANS ORDONNANCEUR.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CES ÉPREUVES NE PROUVENT PAS, ET IL FAUT LE DIRE D'ABORD
 * ══════════════════════════════════════════════════════════════════
 *
 * Elles ne prouvent pas que les relances PARTENT. Rien ne les
 * déclenche : ce projet n'a ni `pg_cron`, ni `pg_net`, ni cron
 * Supabase, ni cron d'hébergeur. Elles prouvent que le CALCUL est
 * juste, et que le jour où quelqu'un branchera un déclencheur, il
 * n'enverra ni deux fois, ni trop tôt, ni trop.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES QUATRE PROPRIÉTÉS DÉFENDUES
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. ÉTEINTES PAR DÉFAUT. Aucune ligne de réglage ne veut dire aucune
 *      relance — pas « les valeurs par défaut de la colonne ».
 *   2. UNE SEULE PAR PASSAGE ET PAR OBJET. Un mois sans passage ne doit
 *      pas produire trois relances d'un coup au même client.
 *   3. LA CADENCE SE LIT EN BASE, jamais dans le code.
 *   4. ON REGARDE `due_on`, PAS LE STATUT « overdue » — que
 *      `refresh_overdue_invoices` ne pose que si quelqu'un ouvre
 *      l'écran des factures.
 */

const LE_15_SEPTEMBRE = new Date("2026-09-15T10:00:00.000Z");

// ══════════════════════════════════════════════════════════════════
// 1. LA CADENCE, EN PUR CALCUL
// ══════════════════════════════════════════════════════════════════

test("aucune relance avant le délai", () => {
  assert.equal(rangRelanceDu({
    depuis: "2026-09-10T10:00:00.000Z",
    maintenant: LE_15_SEPTEMBRE,
    delaiJours: 7, nombreMaximum: 2, rangsDejaEnvoyes: [],
  }), null);
});

test("le délai atteint ouvre le rang 1", () => {
  assert.equal(rangRelanceDu({
    depuis: "2026-09-08T10:00:00.000Z",
    maintenant: LE_15_SEPTEMBRE,
    delaiJours: 7, nombreMaximum: 2, rangsDejaEnvoyes: [],
  }), 1);
});

test("UNE SEULE PAR PASSAGE : un mois de retard ne produit pas une rafale", () => {
  // Trente-cinq jours à sept jours d'intervalle : cinq relances
  // « méritées », plafonnées à deux. On n'en rend qu'UNE, la première
  // qui manque. Le passage suivant rendra la seconde.
  const premier = rangRelanceDu({
    depuis: "2026-08-11T10:00:00.000Z",
    maintenant: LE_15_SEPTEMBRE,
    delaiJours: 7, nombreMaximum: 2, rangsDejaEnvoyes: [],
  });
  assert.equal(premier, 1);

  const suivant = rangRelanceDu({
    depuis: "2026-08-11T10:00:00.000Z",
    maintenant: LE_15_SEPTEMBRE,
    delaiJours: 7, nombreMaximum: 2, rangsDejaEnvoyes: [1],
  });
  assert.equal(suivant, 2);

  // Et le plafond tient : rien après le rang 2.
  assert.equal(rangRelanceDu({
    depuis: "2026-08-11T10:00:00.000Z",
    maintenant: LE_15_SEPTEMBRE,
    delaiJours: 7, nombreMaximum: 2, rangsDejaEnvoyes: [1, 2],
  }), null);
});

test("un plafond à zéro éteint les relances aussi sûrement qu'un interrupteur", () => {
  assert.equal(rangRelanceDu({
    depuis: "2026-01-01T10:00:00.000Z",
    maintenant: LE_15_SEPTEMBRE,
    delaiJours: 7, nombreMaximum: 0, rangsDejaEnvoyes: [],
  }), null);
});

test("le délai vient du réglage, il n'est pas codé en dur", () => {
  const dixJours = { depuis: "2026-09-07T10:00:00.000Z", maintenant: LE_15_SEPTEMBRE, nombreMaximum: 2, rangsDejaEnvoyes: [] };
  assert.equal(rangRelanceDu({ ...dixJours, delaiJours: 7 }), 1, "sept jours : c'est dû");
  assert.equal(rangRelanceDu({ ...dixJours, delaiJours: 30 }), null, "trente jours : ce ne l'est pas");
});

test("une date de départ absente ou illisible ne déclenche rien", () => {
  const base = { maintenant: LE_15_SEPTEMBRE, delaiJours: 7, nombreMaximum: 2, rangsDejaEnvoyes: [] };
  assert.equal(rangRelanceDu({ ...base, depuis: null }), null);
  assert.equal(rangRelanceDu({ ...base, depuis: "pas une date" }), null);
});

// ══════════════════════════════════════════════════════════════════
// 2. « Y A-T-IL ENCORE LIEU DE RELANCER ? »
// ══════════════════════════════════════════════════════════════════

test("un devis décidé ne se relance plus", () => {
  assert.equal(devisEncoreRelancable(
    unDevis({ decideLe: "2026-09-10T10:00:00.000Z", statut: "accepted" }), LE_15_SEPTEMBRE,
  ), false);
});

test("un devis dont la validité est passée ne se relance plus", () => {
  // Relancer sur une offre périmée oblige à refaire le devis, et donne
  // au client l'impression qu'on ne suit pas ses dossiers.
  assert.equal(devisEncoreRelancable(
    unDevis({ valableJusquau: "2026-09-01" }), LE_15_SEPTEMBRE,
  ), false);
  assert.equal(devisEncoreRelancable(
    unDevis({ valableJusquau: null }), LE_15_SEPTEMBRE,
  ), true, "sans date de validité, le devis reste relançable");
});

test("un devis consulté par le client reste relançable", () => {
  assert.equal(devisEncoreRelancable(unDevis({ statut: "viewed" }), LE_15_SEPTEMBRE), true);
  assert.equal(devisEncoreRelancable(unDevis({ statut: "draft" }), LE_15_SEPTEMBRE), false);
  assert.equal(devisEncoreRelancable(unDevis({ statut: "cancelled" }), LE_15_SEPTEMBRE), false);
});

test("UNE FACTURE SE JUGE SUR SON ÉCHÉANCE, PAS SUR SON STATUT", () => {
  // Le piège du chantier : `refresh_overdue_invoices` ne bascule en
  // « overdue » que si quelqu'un ouvre l'écran. Une facture échue
  // depuis trois semaines peut donc être restée « issued ».
  assert.equal(factureEncoreRelancable(
    uneFacture({ statut: "issued", echeanceLe: "2026-08-31" }), LE_15_SEPTEMBRE,
  ), true, "échue et encore « issued » : elle se relance quand même");

  assert.equal(factureEncoreRelancable(
    uneFacture({ statut: "overdue", echeanceLe: "2026-09-30" }), LE_15_SEPTEMBRE,
  ), false, "marquée « overdue » mais pas encore échue : on ne relance pas");
});

test("une facture soldée ou créditée ne se relance pas", () => {
  // `resteDuCents` vient d'`invoice_balance`, qui déduit les avoirs.
  // Relancer un client pour une facture qu'on lui a créditée coûte la
  // relation.
  assert.equal(factureEncoreRelancable(uneFacture({ resteDuCents: 0 }), LE_15_SEPTEMBRE), false);
  assert.equal(
    factureEncoreRelancable(uneFacture({ resteDuCents: null }), LE_15_SEPTEMBRE), false,
    "un solde inconnu ne vaut pas un solde dû",
  );
  assert.equal(
    factureEncoreRelancable(uneFacture({ statut: "credited" }), LE_15_SEPTEMBRE), false,
  );
});

// ══════════════════════════════════════════════════════════════════
// 3. LE PASSAGE COMPLET
// ══════════════════════════════════════════════════════════════════

function scene() {
  const lecteur = new LecteurDouble();
  const port = new PortEspion();
  const devis = unDevis({ envoyeLe: "2026-08-25T10:00:00.000Z", valableJusquau: "2026-10-01" });
  const facture = uneFacture({ echeanceLe: "2026-08-31" });
  lecteur.devis.set(devis.id, devis);
  lecteur.factures.set(facture.id, facture);
  return { lecteur, port, devis, facture, deps: { lecteur, port } };
}

test("ÉTEINTES PAR DÉFAUT : sans ligne de réglage, aucune relance", async () => {
  const { deps, port } = scene();
  const bilan = await envoyerRelancesDues(deps, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });

  assert.equal(bilan.misEnFile, 0);
  assert.equal(port.demandes.length, 0);
  assert.match(bilan.raisonInactive ?? "", /ne sont pas activées/);
});

test("activées, le passage relance le devis et la facture, chacun une fois", async () => {
  const { deps, port, lecteur } = scene();
  lecteur.reglages.set(ORGANISATION_DE_TEST, reglagesActifs());

  const bilan = await envoyerRelancesDues(deps, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });

  assert.equal(bilan.misEnFile, 2);
  // Chacun au rang 1 : le temps a rendu plusieurs relances légitimes,
  // mais on ne rattrape qu'un rang par passage (règle 4).
  assert.deepEqual(
    port.demandes.map((d) => `${d.gabarit}:${d.occurrence}`).sort(),
    ["devisRelance:1", "factureRelance:1"],
  );
});

test("les deux relances portent bien leur propre rang", async () => {
  const { deps, port, lecteur, devis, facture } = scene();
  lecteur.reglages.set(ORGANISATION_DE_TEST, reglagesActifs());

  await envoyerRelancesDues(deps, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });

  const pourDevis = port.demandes.find((d) => d.objetId === devis.id);
  const pourFacture = port.demandes.find((d) => d.objetId === facture.id);

  // Devis envoyé le 25 août, relancé le 15 septembre : vingt et un
  // jours, trois périodes de sept, plafonné à deux — on rend le rang 1.
  assert.equal(pourDevis?.gabarit, "devisRelance");
  assert.equal(pourDevis?.occurrence, 1);

  // Facture échue le 31 août : quinze jours, deux périodes — rang 1
  // également, puisque rien n'est encore parti.
  assert.equal(pourFacture?.gabarit, "factureRelance");
  assert.equal(pourFacture?.occurrence, 1);
});

test("le rejeu d'un passage n'envoie rien de neuf", async () => {
  const { deps, port, lecteur } = scene();
  lecteur.reglages.set(ORGANISATION_DE_TEST, reglagesActifs());

  const premier = await envoyerRelancesDues(deps, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });
  assert.equal(premier.misEnFile, 2);

  // Le second passage, à la même seconde, sans que le journal ait été
  // relu : c'est la clé d'idempotence qui refuse, pas nous.
  const second = await envoyerRelancesDues(deps, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });
  assert.equal(second.misEnFile, 0);
  assert.equal(second.dejaParti, 2);
  assert.equal(port.demandes.length, 4);
});

test("le rang déjà inscrit au journal est sauté, pas renvoyé", async () => {
  const { deps, port, lecteur, devis } = scene();
  lecteur.reglages.set(ORGANISATION_DE_TEST, reglagesActifs());
  lecteur.rangs.set(`quote:${devis.id}:devisRelance`, [1]);

  await envoyerRelancesDues(deps, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });

  const pourDevis = port.demandes.find((d) => d.objetId === devis.id);
  assert.equal(pourDevis?.occurrence, 2, "on passe au suivant, on ne rejoue pas le premier");
});

test("une entreprise suspendue ne prépare aucune relance", async () => {
  const { deps, port, lecteur } = scene();
  lecteur.reglages.set(ORGANISATION_DE_TEST, reglagesActifs({
    suspendueLe: "2026-09-01T00:00:00.000Z",
    motifSuspension: "Taux de plaintes au-dessus du seuil",
  }));

  const bilan = await envoyerRelancesDues(deps, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });

  assert.equal(port.demandes.length, 0);
  // L'entreprise LIT pourquoi elle est coupée. C'est la condition qui
  // rend la suspension acceptable, puisqu'elle arrête aussi le
  // transactionnel.
  assert.match(bilan.raisonInactive ?? "", /Taux de plaintes/);
});

test("le transporteur indisponible rend un bilan, jamais une exception", async () => {
  const { lecteur } = scene();
  lecteur.reglages.set(ORGANISATION_DE_TEST, reglagesActifs());
  const port = new PortEmailNonBranche("Aucun transporteur n'est branché sur ce serveur.");

  const bilan = await envoyerRelancesDues({ lecteur, port }, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });

  assert.equal(bilan.indisponible, 2);
  assert.equal(bilan.misEnFile, 0);
});

test("un devis d'une autre entreprise n'entre jamais dans le passage", async () => {
  const { lecteur, port } = scene();
  lecteur.reglages.set(ORGANISATION_DE_TEST, reglagesActifs());
  const etranger = unDevis({
    id: "55555555-5555-4555-8555-555555555555",
    organizationId: "99999999-9999-4999-8999-999999999999",
    envoyeLe: "2026-08-01T10:00:00.000Z",
  });
  lecteur.devis.set(etranger.id, etranger);

  await envoyerRelancesDues({ lecteur, port }, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });

  assert.equal(
    port.demandes.some((d) => d.objetId === etranger.id), false,
    "le cloisonnement tient même quand la ligne est là, sous le nez du lecteur",
  );
});

test("calculerRelancesDues ne rend que des rangs et jamais d'adresse", async () => {
  const { lecteur } = scene();
  lecteur.reglages.set(ORGANISATION_DE_TEST, reglagesActifs());

  const { relances } = await calculerRelancesDues({ lecteur }, {
    organizationId: ORGANISATION_DE_TEST, maintenant: LE_15_SEPTEMBRE,
  });

  assert.equal(relances.length, 2);
  assert.ok(!JSON.stringify(relances).includes("@"));
});
