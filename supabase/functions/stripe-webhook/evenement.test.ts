// Oasis Care — Chantier Stripe. LES PREUVES SUR LA LECTURE D'ÉVÉNEMENT.
//
//     node --test "supabase/functions/stripe-webhook/evenement.test.ts"

import { test } from "node:test";
import assert from "node:assert/strict";

import { CLE_FACTURE, CLE_ORGANISATION, chercherMetadonnee, lireEvenement } from "./evenement.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const FACTURE = "22222222-2222-4222-8222-222222222222";

function facturePayee(extra: Record<string, unknown> = {}): unknown {
  return {
    id: "evt_1",
    type: "invoice.paid",
    api_version: "2026-03-25.dahlia",
    created: 1_780_000_000,
    livemode: false,
    data: {
      object: {
        object: "invoice",
        id: "in_1ABC",
        customer: "cus_1ABC",
        currency: "eur",
        amount_paid: 9588,
        amount_due: 9588,
        status: "paid",
        ...extra,
      },
    },
  };
}

function attendreOk(brut: unknown) {
  const lecture = lireEvenement(brut);
  assert.equal(lecture.ok, true, lecture.ok === false ? lecture.motif : "");
  if (!lecture.ok) throw new Error("inatteignable");
  return lecture;
}

// ==================================================================
// LA NORMALISATION
// ==================================================================

test("un événement bien formé est normalisé", () => {
  const { evenement } = attendreOk(facturePayee());
  assert.equal(evenement.id, "evt_1");
  assert.equal(evenement.type, "invoice.paid");
  assert.equal(evenement.apiVersion, "2026-03-25.dahlia");
  assert.equal(evenement.dateEvenement, new Date(1_780_000_000 * 1000).toISOString());
  assert.equal(evenement.enDirect, false);
});

test("UN LIVEMODE ABSENT VAUT « DIRECT »", () => {
  // Sinon un corps tronqué se ferait passer pour un événement d'essai et
  // l'encaissement d'un vrai client atterrirait dans la mauvaise moitié
  // de la base. On penche du côté qui fait refuser, pas du côté qui fait
  // écrire.
  const brut = facturePayee() as Record<string, unknown>;
  delete brut.livemode;
  assert.equal(attendreOk(brut).evenement.enDirect, true);

  const explicite = { ...(facturePayee() as Record<string, unknown>), livemode: true };
  assert.equal(attendreOk(explicite).evenement.enDirect, true);
});

test("un événement sans identifiant ou sans type est refusé, sans lever", () => {
  for (const brut of [
    null,
    "texte",
    [],
    {},
    { type: "invoice.paid" },
    { id: "evt_1" },
    { id: "   ", type: "invoice.paid" },
  ]) {
    const lecture = lireEvenement(brut);
    assert.equal(lecture.ok, false, `accepté à tort : ${JSON.stringify(brut)}`);
  }
});

test("un événement sans objet est CONSTATÉ, pas refusé", () => {
  // Le refuser ferait rendre 400, et Stripe rejouerait un corps qui ne
  // passera jamais. On l'inscrit et on le clôt.
  const { intention } = attendreOk({ id: "evt_x", type: "invoice.paid", data: {}, livemode: false });
  assert.equal(intention.genre, "constater");
});

test("le résumé reste un RÉSUMÉ — pas le corps complet", () => {
  const { evenement } = attendreOk(
    facturePayee({
      // Ce qu'on ne veut surtout pas recopier dans une table lue par des
      // administrateurs.
      customer_email: "dirigeant@exemple.fr",
      payment_method_details: { card: { last4: "4242", fingerprint: "abc" } },
      metadata: { [CLE_ORGANISATION]: ORG },
    }),
  );
  const texte = JSON.stringify(evenement.resume);
  assert.ok(!texte.includes("dirigeant@exemple.fr"), "le résumé ne doit pas transporter l'adresse du client");
  assert.ok(!texte.includes("4242"), "le résumé ne doit pas transporter d'empreinte de moyen de paiement");
  assert.equal(evenement.resume.montantPayeCentimes, 9588);
  assert.equal(evenement.resume.organisationAnnoncee, ORG);
});

// ==================================================================
// L'INTENTION — L'ARGENT
// ==================================================================

test("`invoice.paid` produit une intention d'encaissement, devise en majuscules", () => {
  const { intention } = attendreOk(facturePayee({ metadata: { [CLE_ORGANISATION]: ORG } }));
  assert.deepEqual(intention, {
    genre: "encaisser",
    clientPrestataire: "cus_1ABC",
    organisationDemandee: ORG,
    factureDemandee: null,
    montantCentimes: 9588,
    // 'eur' chez Stripe, 'EUR' chez nous. Sans la bascule de casse,
    // `saas_record_provider_payment` refuserait TOUS les encaissements
    // pour devise discordante.
    devise: "EUR",
    reference: "in_1ABC",
  });
});

test("UNE FACTURE STRIPE À 0 N'EST PAS UN ENCAISSEMENT", () => {
  // Essai gratuit, remise à 100 % : rien n'a été prélevé. Poser un
  // paiement de 0 serait refusé par la base de toute façon, mais on
  // préfère ne pas le lui demander.
  for (const montant of [0, -100]) {
    const { intention } = attendreOk(facturePayee({ amount_paid: montant }));
    assert.equal(intention.genre, "constater");
  }
});

test("un montant illisible ne devient pas zéro", () => {
  for (const montant of [null, undefined, "9588", 95.88, Number.NaN]) {
    const { intention } = attendreOk(facturePayee({ amount_paid: montant }));
    assert.equal(intention.genre, "constater", `accepté à tort : ${String(montant)}`);
  }
});

test("une facture sans devise ou sans identifiant ne s'encaisse pas", () => {
  assert.equal(attendreOk(facturePayee({ currency: null })).intention.genre, "constater");
  assert.equal(attendreOk(facturePayee({ id: null })).intention.genre, "constater");
});

test("UN SEUL TYPE D'ÉVÉNEMENT CONSTATE L'ARGENT", () => {
  // Stripe annonce le même encaissement de plusieurs manières. Les
  // traiter tous poserait deux paiements du même argent, avec deux
  // références différentes que l'index d'unicité ne verrait pas comme
  // un doublon.
  for (const type of ["payment_intent.succeeded", "charge.succeeded", "invoice_payment.paid"]) {
    const { intention } = attendreOk({
      id: `evt_${type}`,
      type,
      livemode: false,
      data: { object: { id: "pi_1", amount: 9588, currency: "eur", customer: "cus_1ABC" } },
    });
    assert.equal(intention.genre, "constater", `${type} ne doit pas encaisser`);
  }
});

test("le client peut arriver développé plutôt qu'en simple identifiant", () => {
  const { intention } = attendreOk(facturePayee({ customer: { id: "cus_developpe", object: "customer" } }));
  assert.equal(intention.genre === "encaisser" && intention.clientPrestataire, "cus_developpe");
});

// ==================================================================
// L'INTENTION — LE CYCLE DE VIE, JAMAIS APPLIQUÉ
// ==================================================================

test("LE CYCLE DE VIE D'UN ABONNEMENT EST CONSTATÉ, JAMAIS APPLIQUÉ", () => {
  // 0083 § 11 : aucun chemin machine n'existe pour créer ou faire
  // avancer un abonnement. Ce webhook constate, il n'invente pas de
  // porte.
  for (const type of [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "customer.subscription.paused",
    "customer.subscription.resumed",
    "customer.subscription.trial_will_end",
  ]) {
    const { intention } = attendreOk({
      id: `evt_${type}`,
      type,
      livemode: false,
      data: { object: { id: "sub_1", object: "subscription", customer: "cus_1ABC", status: "active" } },
    });
    assert.equal(intention.genre, "constater");
  }
});

test("UN ÉCHEC DE PAIEMENT N'EFFACE RIEN — il est seulement consigné", () => {
  // § 26 : on ne supprime jamais de données à l'expiration. Ce webhook
  // ne coupe donc aucun accès, et ne peut pas en couper.
  for (const type of [
    "invoice.payment_failed",
    "invoice.marked_uncollectible",
    "charge.refunded",
    "charge.dispute.created",
  ]) {
    const { intention } = attendreOk({
      id: `evt_${type}`,
      type,
      livemode: false,
      data: { object: { id: "in_1", customer: "cus_1ABC", amount_due: 9588, currency: "eur" } },
    });
    assert.equal(intention.genre, "constater");
  }
});

test("un type inconnu est constaté, pas refusé", () => {
  const { intention } = attendreOk({
    id: "evt_futur",
    type: "quelque.chose.qui.nexiste.pas.encore",
    livemode: false,
    data: { object: { id: "x_1" } },
  });
  assert.equal(intention.genre, "constater");
});

// ==================================================================
// L'INTENTION — LE RATTACHEMENT
// ==================================================================

test("une session terminée rattache le client à l'entreprise", () => {
  const { intention } = attendreOk({
    id: "evt_cs",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        object: "checkout.session",
        id: "cs_1",
        status: "complete",
        customer: "cus_1ABC",
        metadata: { [CLE_ORGANISATION]: ORG },
      },
    },
  });
  assert.deepEqual(intention, { genre: "rattacherClient", clientPrestataire: "cus_1ABC", organisationDemandee: ORG });
});

test("une session non terminée, ou sans client, ne rattache rien", () => {
  for (const objet of [
    { id: "cs_1", status: "open", customer: "cus_1ABC" },
    { id: "cs_1", status: "expired", customer: "cus_1ABC" },
    { id: "cs_1", status: "complete" },
    { id: "cs_1", status: "complete", customer: null },
  ]) {
    const { intention } = attendreOk({
      id: "evt_cs",
      type: "checkout.session.completed",
      livemode: false,
      data: { object: objet },
    });
    assert.equal(intention.genre, "constater", `rattaché à tort : ${JSON.stringify(objet)}`);
  }
});

// ==================================================================
// LES MÉTADONNÉES — LE CONTRAT AVEC LE TUNNEL
// ==================================================================

test("l'entreprise est retrouvée où que Stripe l'ait recopiée", () => {
  // C'est le point qui fait tenir le RENOUVELLEMENT : dans deux ans,
  // Stripe déclenchera seul, et l'entreprise ne sera plus portée que par
  // les métadonnées de l'abonnement recopiées sur la facture. Stripe a
  // déjà déplacé cet endroit une fois entre deux versions d'API ; une
  // intégration qui ne regarde qu'une forme cesse de reconnaître ses
  // clients, en silence.
  const emplacements: Record<string, unknown>[] = [
    { metadata: { [CLE_ORGANISATION]: ORG } },
    { subscription_details: { metadata: { [CLE_ORGANISATION]: ORG } } },
    { parent: { subscription_details: { metadata: { [CLE_ORGANISATION]: ORG } } } },
    { subscription: { id: "sub_1", metadata: { [CLE_ORGANISATION]: ORG } } },
    { lines: { data: [{ id: "il_1" }, { id: "il_2", metadata: { [CLE_ORGANISATION]: ORG } }] } },
  ];
  for (const emplacement of emplacements) {
    const { intention } = attendreOk(facturePayee(emplacement));
    assert.equal(
      intention.genre === "encaisser" && intention.organisationDemandee,
      ORG,
      `non trouvée dans ${JSON.stringify(emplacement)}`,
    );
  }
});

test("le plus précis gagne quand deux emplacements se contredisent", () => {
  const autre = "33333333-3333-4333-8333-333333333333";
  const { intention } = attendreOk(
    facturePayee({
      metadata: { [CLE_ORGANISATION]: ORG },
      parent: { subscription_details: { metadata: { [CLE_ORGANISATION]: autre } } },
    }),
  );
  assert.equal(intention.genre === "encaisser" && intention.organisationDemandee, ORG);
});

test("la facture annoncée est lue, et une métadonnée vide vaut absente", () => {
  const avec = attendreOk(facturePayee({ metadata: { [CLE_FACTURE]: FACTURE } })).intention;
  assert.equal(avec.genre === "encaisser" && avec.factureDemandee, FACTURE);

  for (const vide of ["", "   ", null, 42, {}]) {
    const { intention } = attendreOk(facturePayee({ metadata: { [CLE_FACTURE]: vide } }));
    assert.equal(intention.genre === "encaisser" && intention.factureDemandee, null);
  }
});

test("`chercherMetadonnee` ne lève sur aucune forme tordue", () => {
  for (const objet of [
    {},
    { metadata: null },
    { metadata: "texte" },
    { lines: null },
    { lines: { data: "pas un tableau" } },
    { lines: { data: [null, 3, "x"] } },
    { parent: 7 },
    { subscription_details: [] },
  ]) {
    assert.equal(chercherMetadonnee(objet as Record<string, unknown>, CLE_ORGANISATION), null);
  }
});

// ==================================================================
// LE NOM DES MÉTADONNÉES — UN SEUL, DES DEUX CÔTÉS
// ==================================================================
// Il y a eu un désaccord : le tunnel écrivait `organizationId`, ce
// lecteur attendait `oasis_organization_id`. Rien ne l'aurait signalé
// avant le premier vrai paiement — signature valide, événement
// journalisé, puis « Entreprise inconnue » sur CHAQUE encaissement.
//
// L'intégration a tranché : le nom PRÉFIXÉ, et le tunnel a été aligné.
// L'alias de tolérance a été RETIRÉ à dessein — accepter les deux noms
// faisait marcher les deux côtés tout en rendant le désaccord
// invisible. Ces preuves fixent le contrat dans les deux sens.

test("LE NOM OFFICIEL EST RECONNU", () => {
  const { intention } = attendreOk(facturePayee({ metadata: { [CLE_ORGANISATION]: ORG } }));
  assert.equal(intention.genre === "encaisser" && intention.organisationDemandee, ORG);
});

test("LE NOM SANS PRÉFIXE N'EST PLUS ACCEPTÉ — le désaccord doit se voir", () => {
  // Si quelqu'un réintroduit `organizationId` côté tunnel, ce test
  // tombe tout de suite. C'est exactement ce qu'on veut : mieux vaut un
  // test rouge en intégration qu'un encaissement orphelin en
  // production.
  const { intention } = attendreOk(facturePayee({ metadata: { organizationId: ORG } }));
  assert.equal(intention.genre === "encaisser" && intention.organisationDemandee, null);
});

test("LES MÉTADONNÉES RÉELLES DU TUNNEL suffisent à identifier l'entreprise", () => {
  // Recopiées telles que `stripe.ts` les compose aujourd'hui, y compris
  // sur `subscription_data.metadata` — donc sur chaque renouvellement.
  // Les deux montants y figurent : le hors taxes est ce qui sera
  // FACTURÉ, le toutes taxes ce qui sera PRÉLEVÉ.
  const metadonneesDuTunnel = {
    [CLE_ORGANISATION]: ORG,
    planKey: "team",
    billingCycle: "monthly",
    mode: "test",
    totalHtCents: "7990",
    totalTtcCents: "9588",
    regimeTva: "france",
    siegesFacturables: "0",
  };
  const { intention } = attendreOk(
    facturePayee({ parent: { subscription_details: { metadata: metadonneesDuTunnel } } }),
  );
  assert.equal(intention.genre, "encaisser");
  assert.equal(intention.genre === "encaisser" && intention.organisationDemandee, ORG);
});

test("le tunnel ne pose AUCUN identifiant de facture — le rapprochement passera par le montant", () => {
  // Ce n'est pas un défaut : au moment du paiement, la facture Oasis de
  // la période n'est pas encore émise. Ce test FIGE le fait, pour que
  // personne ne croie la voie « métadonnée » couverte alors qu'elle ne
  // l'est jamais dans le parcours réel.
  const { intention } = attendreOk(
    facturePayee({ metadata: { [CLE_ORGANISATION]: ORG, planKey: "team" } }),
  );
  assert.equal(intention.genre === "encaisser" && intention.factureDemandee, null);
});
