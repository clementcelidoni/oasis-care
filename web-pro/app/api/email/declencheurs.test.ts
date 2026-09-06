import { test } from "node:test";
import assert from "node:assert/strict";

import { surDevisEnvoye, surFactureEmise, phrasePourEcran } from "./declencheurs.ts";
import { PortEmailNonBranche, obtenirPortEmail } from "./port.ts";
import {
  LecteurDouble, PortEspion, unDevis, uneFacture, ORGANISATION_DE_TEST,
} from "./doubles.ts";

/**
 * §EMAILS — LES DÉCLENCHEURS, ÉPROUVÉS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON DÉFEND ICI, PAR ORDRE DE GRAVITÉ
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. UNE FACTURE S'ÉMET MÊME QUAND LE COURRIER NE PART PAS. C'est la
 *      propriété la plus importante du fichier, et la plus facile à
 *      casser par distraction : il suffit d'un `throw` remonté d'une
 *      couche pour qu'un paysagiste perde son numéro de facture parce
 *      que Brevo était en panne. Quatre épreuves l'attaquent par quatre
 *      chemins différents.
 *
 *   2. UN MESSAGE NE PART JAMAIS DEUX FOIS. Éprouvé ici contre un
 *      double qui imite la contrainte d'unicité de la base — parce que
 *      c'est la base qui garantit, et que le double doit lui
 *      ressembler, pas être plus indulgent.
 *
 *   3. LA DEMANDE NE PORTE NI ADRESSE NI NOM D'EXPÉDITEUR. Vérifié sur
 *      les clés de l'objet, pas sur la parole du commentaire.
 *
 *   4. UNE ADRESSE ABSENTE EST UN CAS TRAITÉ. Le paysagiste lit une
 *      phrase ; il ne voit pas la page rouge de Next.
 */

function deps(port = new PortEspion()) {
  const lecteur = new LecteurDouble();
  return { lecteur, port, ensemble: { lecteur, port } };
}

// ══════════════════════════════════════════════════════════════════
// 1. LE DEVIS
// ══════════════════════════════════════════════════════════════════

test("le devis marqué « envoyé » part une fois, et le rejeu n'envoie rien", async () => {
  const { lecteur, port, ensemble } = deps();
  const devis = unDevis();
  lecteur.devis.set(devis.id, devis);

  const premier = await surDevisEnvoye(ensemble, {
    organizationId: ORGANISATION_DE_TEST, quoteId: devis.id,
  });
  assert.equal(premier.etat, "misEnFile");

  // LE REJEU. Un déploiement qui redémarre, deux onglets ouverts, un
  // clic double : la seconde demande atteint bien le port — on ne
  // l'arrête pas par un « si déjà envoyé » applicatif, qui perdrait la
  // course — et c'est la clé d'idempotence qui tranche.
  const second = await surDevisEnvoye(ensemble, {
    organizationId: ORGANISATION_DE_TEST, quoteId: devis.id,
  });
  assert.equal(second.etat, "dejaParti");

  assert.equal(port.demandes.length, 2, "les deux demandes atteignent le port");
  assert.equal(
    port.demandes[0].occurrence, 1,
    "le premier envoi porte le rang 1 ; les relances ont leur propre suite",
  );
});

test("la demande ne porte NI adresse de destinataire NI nom d'expéditeur", async () => {
  const { lecteur, port, ensemble } = deps();
  const devis = unDevis();
  lecteur.devis.set(devis.id, devis);

  await surDevisEnvoye(ensemble, { organizationId: ORGANISATION_DE_TEST, quoteId: devis.id });

  // LA PROPRIÉTÉ QUI EMPÊCHE CE SERVEUR DE DEVENIR UN RELAIS DE
  // COURRIER INDÉSIRABLE. Le destinataire se résout en base, dans
  // `email_recipient_for_customer` ; le nom affiché se lit sur
  // l'organisation vérifiée. Si l'un des deux apparaissait ici, il
  // pourrait venir d'un formulaire.
  // ELLE NE PORTE PLUS NON PLUS LE TEXTE NI LE CLIENT. `variables` et
  // `customerId` en ont disparu : le contenu d'un message ne traverse
  // plus le réseau depuis un appelant, et le destinataire se déduit du
  // document que la machine RELIT en base.
  const cles = Object.keys(port.demandes[0]).sort();
  assert.deepEqual(cles, [
    "gabarit", "objetId", "occurrence", "organizationId", "typeObjet",
  ]);

  const serialise = JSON.stringify(port.demandes[0]);
  assert.ok(!serialise.includes("@"), "aucune adresse e-mail ne transite par la demande");
});

test("un devis sans total lisible n'invente aucun montant", async () => {
  const { lecteur, port, ensemble } = deps();
  // Le montant ne transite plus par la demande : il se lit en base,
  // dans la machine. Ce que ce test défend ici est donc plus étroit et
  // plus solide — la demande ne porte RIEN qui puisse être un montant,
  // donc aucun `?? 0` ne peut s'y glisser.
  const devis = unDevis({ totalTtcCents: null });
  lecteur.devis.set(devis.id, devis);

  await surDevisEnvoye(ensemble, { organizationId: ORGANISATION_DE_TEST, quoteId: devis.id });

  const serialise = JSON.stringify(port.demandes[0]);
  assert.ok(!/0,00|totalTtc/i.test(serialise), "aucun montant dans la demande");
});

test("un devis dont le fait daté manque n'expédie rien", async () => {
  const { lecteur, port, ensemble } = deps();
  // On lit `sent_at`, pas le statut. Un statut « sent » posé sans que
  // l'écriture ait abouti ne doit pas faire partir de courrier.
  const devis = unDevis({ envoyeLe: null });
  lecteur.devis.set(devis.id, devis);

  const resultat = await surDevisEnvoye(ensemble, {
    organizationId: ORGANISATION_DE_TEST, quoteId: devis.id,
  });
  assert.equal(resultat.etat, "erreur");
  assert.equal(port.demandes.length, 0);
});

test("un devis d'une autre entreprise est refusé avant d'atteindre le port", async () => {
  const { lecteur, port, ensemble } = deps();
  const devis = unDevis({ organizationId: "99999999-9999-4999-8999-999999999999" });
  lecteur.devis.set(devis.id, devis);

  const resultat = await surDevisEnvoye(ensemble, {
    organizationId: ORGANISATION_DE_TEST, quoteId: devis.id,
  });
  assert.equal(resultat.etat, "erreur");
  assert.equal(port.demandes.length, 0, "rien ne sort vers le transporteur");
});

// ══════════════════════════════════════════════════════════════════
// 2. LA FACTURE — ET LA DIGUE
// ══════════════════════════════════════════════════════════════════

test("la facture émise part une fois, sur le fait daté et non sur le statut", async () => {
  const { lecteur, port, ensemble } = deps();
  const facture = uneFacture();
  lecteur.factures.set(facture.id, facture);

  const premier = await surFactureEmise(ensemble, {
    organizationId: ORGANISATION_DE_TEST, invoiceId: facture.id,
  });
  assert.equal(premier.etat, "misEnFile");

  // On repasse le statut à autre chose et on rejoue : `issued_at` n'a
  // pas bougé, donc la clé d'idempotence non plus, donc rien ne repart.
  lecteur.factures.set(facture.id, { ...facture, statut: "partiallyPaid" });
  const second = await surFactureEmise(ensemble, {
    organizationId: ORGANISATION_DE_TEST, invoiceId: facture.id,
  });
  assert.equal(second.etat, "dejaParti");

  // LES DEUX DEMANDES ONT BIEN ATTEINT LE PORT. C'est le point : on ne
  // s'arrête pas sur un « si déjà envoyé » lu en amont, qui perdrait la
  // course entre deux onglets. On demande, et c'est la contrainte
  // d'unicité qui refuse.
  assert.equal(port.demandes.length, 2);
});

test("LE TRANSPORTEUR INDISPONIBLE N'EMPÊCHE PAS L'ÉMISSION", async () => {
  const lecteur = new LecteurDouble();
  const facture = uneFacture();
  lecteur.factures.set(facture.id, facture);

  const port = new PortEmailNonBranche("La clé du transporteur n'est pas posée sur ce serveur.");
  const resultat = await surFactureEmise({ lecteur, port }, {
    organizationId: ORGANISATION_DE_TEST, invoiceId: facture.id,
  });

  // Pas d'exception, pas de rejet de promesse : un résultat à lire.
  // C'est ce qui garantit que `issueInvoice` va jusqu'au bout.
  assert.equal(resultat.etat, "indisponible");
  assert.match(resultat.raison, /transporteur/i);
  // Et l'écran le DIT — sinon le paysagiste attend une réponse à un
  // message qui n'existe pas, et le produit ment par omission.
  assert.equal(phrasePourEcran(resultat), resultat.raison);
});

test("le transporteur qui LÈVE ne fait pas échouer le geste métier", async () => {
  const { lecteur, port, ensemble } = deps();
  const facture = uneFacture();
  lecteur.factures.set(facture.id, facture);
  port.leveProchain = new Error("connexion refusée");

  const resultat = await surFactureEmise(ensemble, {
    organizationId: ORGANISATION_DE_TEST, invoiceId: facture.id,
  });
  assert.equal(resultat.etat, "erreur");
  assert.equal(resultat.raison, "connexion refusée");
});

test("une base injoignable ne fait pas échouer le geste métier", async () => {
  const { lecteur, ensemble } = deps();
  lecteur.panne = new Error("la base ne répond pas");

  const resultat = await surFactureEmise(ensemble, {
    organizationId: ORGANISATION_DE_TEST, invoiceId: "44444444-4444-4444-8444-444444444444",
  });
  assert.equal(resultat.etat, "erreur");
});

test("une adresse absente est un cas traité, pas une exception", async () => {
  const { lecteur, port, ensemble } = deps();
  const facture = uneFacture();
  lecteur.factures.set(facture.id, facture);

  // La phrase que rend `email_recipient_for_customer` quand ni le
  // contact principal ni la fiche client n'ont d'adresse.
  port.refusProchain =
    "Aucune adresse e-mail pour « Jardin des Lilas ». Renseignez-la sur la fiche du client, "
    + "ou sur son contact principal, avant d'envoyer.";

  const resultat = await surFactureEmise(ensemble, {
    organizationId: ORGANISATION_DE_TEST, invoiceId: facture.id,
  });

  assert.equal(resultat.etat, "refuse");
  // Elle est écrite pour un paysagiste, pas pour un développeur : elle
  // dit quoi faire, et où.
  assert.match(phrasePourEcran(resultat) ?? "", /fiche du client/);
});

test("un refus d'identité légale laisse la facture émise et rend une phrase actionnable", async () => {
  const { lecteur, port, ensemble } = deps();
  const facture = uneFacture();
  lecteur.factures.set(facture.id, facture);

  // `factureEmise` porte `requires_legal_identity` : sans SIRET,
  // `email_sender_identity` refuse. Le document reste opposable, le
  // courrier attend — c'est la distinction que ce module doit tenir.
  port.refusProchain =
    "Renseignez le SIRET de votre entreprise : une facture sans SIRET n'est pas conforme "
    + "(art. 242 nonies A du CGI).";

  const resultat = await surFactureEmise(ensemble, {
    organizationId: ORGANISATION_DE_TEST, invoiceId: facture.id,
  });
  assert.equal(resultat.etat, "refuse");
  assert.match(phrasePourEcran(resultat) ?? "", /SIRET/);
});

test("une facture en brouillon n'expédie rien", async () => {
  const { lecteur, port, ensemble } = deps();
  const facture = uneFacture({ emiseLe: null, numero: null, statut: "draft" });
  lecteur.factures.set(facture.id, facture);

  const resultat = await surFactureEmise(ensemble, {
    organizationId: ORGANISATION_DE_TEST, invoiceId: facture.id,
  });
  assert.equal(resultat.etat, "erreur");
  assert.equal(port.demandes.length, 0);
});

// ══════════════════════════════════════════════════════════════════
// 3. LE PORT PAR DÉFAUT
// ══════════════════════════════════════════════════════════════════

test("le port par défaut est indisponible, et il le dit sans mentir", async () => {
  // L'état « rien n'expédie » est NORMAL, pas une panne — la même
  // convention que `UnconfiguredBillingProvider`. Il ne simule aucun
  // envoi et ne rend aucun identifiant de message.
  // SANS JETON DE SESSION, LE PORT NE PEUT PAS EXPÉDIER : la machine
  // relit le document sous ce jeton, et sans lui la RLS ne cloisonnerait
  // plus rien. Il le DIT au lieu de faire semblant.
  const port = obtenirPortEmail(null);
  assert.notEqual(port.raisonIndisponible, null);

  const resultat = await port.mettreEnFile({
    organizationId: ORGANISATION_DE_TEST,
    gabarit: "devisEnvoye",
    typeObjet: "quote",
    objetId: "33333333-3333-4333-8333-333333333333",
    occurrence: 1,
  });
  assert.equal(resultat.etat, "indisponible");
});

test("un envoi réussi n'a rien à montrer à l'écran", () => {
  assert.equal(
    phrasePourEcran({ etat: "misEnFile", messageId: "msg-1", avertissements: [] }),
    null,
  );
  // MAIS « DÉJÀ PARTI » N'EST PLUS UN SILENCE.
  //
  // L'écran offre « Repasser en brouillon → corriger → Marquer comme
  // envoyé ». Au second passage, la clé d'idempotence est prise : rien
  // ne repart — ce qui est correct — et rien ne s'affichait. Le
  // paysagiste croyait avoir transmis la version corrigée ; son client
  // avait l'ancienne.
  const dit = phrasePourEcran({ etat: "dejaParti", messageId: "msg-1" });
  assert.notEqual(dit, null);
  assert.match(String(dit), /déjà été envoyé/);
});
