// Oasis Care — Chantier Stripe. LES PREUVES SUR L'ORCHESTRATION.
//
//     node --test --experimental-strip-types \
//       "supabase/functions/stripe-webhook/traitement.test.ts"
//
// AUCUN RÉSEAU, AUCUNE BASE. `PorteBase` est implémentée ici par un
// double simulé qui reproduit LES CONTRAINTES de 0083, pas seulement
// ses signatures :
//   • `billing_provider_events` : unicité sur (prestataire, id
//     d'événement) — l'insertion échoue, elle ne se contente pas de
//     rendre « déjà vu » ;
//   • `saas_invoice_payments` : unicité partielle sur
//     (method, external_reference) ;
//   • `billing_provider_link_customer` : refus (23505) quand
//     l'entreprise est déjà rattachée à un autre client.
//
// C'est ce qui permet d'éprouver les trois choses qui font vraiment mal
// sur un webhook — LE REJEU, LA LIVRAISON SIMULTANÉE, LE DÉSORDRE —
// sans jamais parler à Stripe ni à Postgres. Un test qui exigerait l'un
// ou l'autre ne tournerait jamais en intégration, c'est-à-dire jamais.

import { test } from "node:test";
import assert from "node:assert/strict";

import { lireEvenement, type EvenementNormalise, type Intention } from "./evenement.ts";
import type { FactureCandidate } from "./rapprochement.ts";
import {
  RefusMetier,
  traiter,
  type DemandeAbonnement,
  type DemandeEncaissement,
  type EtatEvenement,
  type IssueAbonnement,
  type Issue,
  type PorteBase,
} from "./traitement.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const AUTRE_ORG = "22222222-2222-2222-2222-222222222222";
const CLIENT = "cus_essai_1";

// ==================================================================
// LES CORPS D'ÉVÉNEMENT, TELS QUE STRIPE LES ENVOIE
// ==================================================================
// On passe par `lireEvenement` plutôt que de fabriquer une `Intention`
// à la main : ce qui est éprouvé ici est donc bien la chaîne complète
// « corps reçu → intention → effet », et non une intention idéalisée
// qui ne ressemblerait à aucun corps réel.

function facturePayee(surcharge: Record<string, unknown> = {}): unknown {
  return {
    id: "evt_1",
    type: "invoice.paid",
    livemode: false,
    created: 1_780_000_000,
    api_version: "2025-01-01",
    data: {
      object: {
        object: "invoice",
        id: "in_stripe_1",
        customer: CLIENT,
        currency: "eur",
        amount_paid: 9588,
        status: "paid",
        parent: { subscription_details: { metadata: { oasis_organization_id: ORG } } },
        ...surcharge,
      },
    },
  };
}

function sessionTerminee(surcharge: Record<string, unknown> = {}): unknown {
  return {
    id: "evt_session",
    type: "checkout.session.completed",
    livemode: false,
    created: 1_780_000_000,
    data: {
      object: {
        object: "checkout.session",
        id: "cs_1",
        status: "complete",
        customer: CLIENT,
        metadata: { oasis_organization_id: ORG },
        ...surcharge,
      },
    },
  };
}

/**
 * Une session terminée portant LE CONTRAT DE MÉTADONNÉES COMPLET —
 * celui que `web-pro/lib/billing/stripe.ts` pose sur la session et sur
 * l'abonnement. C'est lui qui permet d'ouvrir l'abonnement.
 */
function sessionAvecContrat(metadata: Record<string, string> = {}): unknown {
  return sessionTerminee({
    metadata: {
      oasis_organization_id: ORG,
      planKey: "team",
      billingCycle: "monthly",
      mode: "test",
      avecEssai: "true",
      finEssaiLe: "2026-10-06",
      premierPrelevementLe: "2026-10-06",
      jourAnniversaire: "6",
      siegesFacturables: "3",
      ...metadata,
    },
  });
}

function lire(brut: unknown): { evenement: EvenementNormalise; intention: Intention } {
  const lecture = lireEvenement(brut);
  assert.equal(lecture.ok, true, "le corps d'essai doit être lisible");
  return { evenement: lecture.evenement, intention: lecture.intention };
}

function jouer(base: BaseSimulee, brut: unknown) {
  const { evenement, intention } = lire(brut);
  return traiter(base, evenement, intention);
}

// ==================================================================
// LE DOUBLE SIMULÉ
// ==================================================================

interface Paiement {
  readonly reference: string;
  readonly factureId: string;
  readonly montantCentimes: number;
}

class BaseSimulee implements PorteBase {
  /** Le journal, clé = identifiant d'événement. */
  readonly evenements = new Map<string, { outcome: string; processed_at: string | null }>();
  /** L'unicité (method, external_reference) de 0083 § 5.a. */
  readonly paiements: Paiement[] = [];
  /** L'annuaire : entreprise ↔ client du prestataire. */
  readonly clients = new Map<string, string>();

  factures: FactureCandidate[] = [
    { id: "f-1", organizationId: ORG, devise: "EUR", statut: "issued", resteCentimes: 9588 },
  ];

  /** Ce qui doit tomber en panne, et combien de fois encore. */
  panne: { methode: keyof PorteBase; restant: number } | null = null;
  /** Un refus métier à provoquer sur une méthode donnée. */
  refus: { methode: keyof PorteBase; message: string } | null = null;

  readonly appels: string[] = [];

  private controler(methode: keyof PorteBase): void {
    this.appels.push(methode);
    if (this.panne !== null && this.panne.methode === methode && this.panne.restant > 0) {
      this.panne.restant -= 1;
      throw new Error(`Panne simulée sur ${methode}.`);
    }
    if (this.refus !== null && this.refus.methode === methode) {
      throw new RefusMetier(this.refus.message);
    }
  }

  inscrireEvenement(evenement: EvenementNormalise): Promise<"accepted" | "duplicate"> {
    this.controler("inscrireEvenement");
    // L'INSERTION D'ABORD, comme en base : c'est la contrainte qui dit
    // qui est le premier, pas une lecture préalable.
    if (this.evenements.has(evenement.id)) return Promise.resolve("duplicate");
    this.evenements.set(evenement.id, { outcome: "pending", processed_at: null });
    return Promise.resolve("accepted");
  }

  lireEtatEvenement(evenementId: string): Promise<EtatEvenement | null> {
    this.controler("lireEtatEvenement");
    const ligne = this.evenements.get(evenementId);
    if (ligne === undefined) return Promise.resolve(null);
    return Promise.resolve({ outcome: ligne.outcome, closDepuis: ligne.processed_at });
  }

  clore(evenementId: string, issue: Issue, motif: string | null): Promise<"closed" | "alreadyClosed"> {
    this.controler("clore");
    const ligne = this.evenements.get(evenementId);
    if (ligne === undefined) throw new RefusMetier("Événement introuvable : on ne clôt pas ce qu'on n'a pas inscrit.");
    if (ligne.processed_at !== null) return Promise.resolve("alreadyClosed");
    ligne.outcome = issue;
    ligne.processed_at = new Date().toISOString();
    if (motif !== null) (ligne as { error?: string }).error = motif;
    return Promise.resolve("closed");
  }

  /** Les abonnements ouverts : entreprise → ce qui a été demandé. */
  readonly abonnements = new Map<string, DemandeAbonnement>();

  ouvrirAbonnement(demande: DemandeAbonnement): Promise<IssueAbonnement | null> {
    this.controler("ouvrirAbonnement");
    // `saas_start_subscription` refuse une entreprise déjà abonnée
    // (23505) ; l'implémentation traduit ce refus-là en `null`.
    if (this.abonnements.has(demande.organisationId)) return Promise.resolve(null);
    this.abonnements.set(demande.organisationId, demande);
    this.clients.set(demande.organisationId, demande.clientPrestataire);
    return Promise.resolve(
      demande.avecEssai
        ? { statut: "trialing", numeroFacture: null, message: "Essai ouvert." }
        : { statut: "active", numeroFacture: "FS-2026-00001", message: "Abonnement actif." },
    );
  }

  /**
   * Les abonnements FERMÉS — « restreint » ou « en sursis » du péage.
   * Le double reproduit la règle de `saas_reopen_subscription` : elle
   * ne reprend QUE ceux-là, et lève 23505 sur tout abonnement en cours
   * (que l'implémentation traduit en `null`, comme à l'ouverture).
   */
  readonly abonnementsFermes = new Set<string>();

  reprendreAbonnement(demande: DemandeAbonnement): Promise<IssueAbonnement | null> {
    this.controler("reprendreAbonnement");
    if (!this.abonnementsFermes.has(demande.organisationId)) return Promise.resolve(null);
    this.abonnementsFermes.delete(demande.organisationId);
    this.abonnements.set(demande.organisationId, demande);
    this.clients.set(demande.organisationId, demande.clientPrestataire);
    // JAMAIS D'ESSAI À LA REPRISE : la base ne l'accorde pas, le double
    // non plus. Un « trialing » rendu ici masquerait la règle.
    return Promise.resolve({
      statut: "active",
      numeroFacture: "FS-2026-00042",
      message: "Abonnement repris.",
    });
  }

  rattacherClient(organisationId: string, clientPrestataire: string): Promise<"linked" | "alreadyLinked"> {
    this.controler("rattacherClient");
    const deja = this.clients.get(organisationId);
    if (deja !== undefined) {
      if (deja === clientPrestataire) return Promise.resolve("alreadyLinked");
      throw new RefusMetier(`L'entreprise est déjà rattachée au client ${deja} chez stripe (test).`);
    }
    for (const [org, client] of this.clients) {
      if (client === clientPrestataire) {
        throw new RefusMetier(`Le client ${clientPrestataire} appartient déjà à une autre entreprise (${org}).`);
      }
    }
    this.clients.set(organisationId, clientPrestataire);
    return Promise.resolve("linked");
  }

  organisationDuClient(clientPrestataire: string): Promise<string | null> {
    this.controler("organisationDuClient");
    for (const [org, client] of this.clients) if (client === clientPrestataire) return Promise.resolve(org);
    return Promise.resolve(null);
  }

  facturesEncaissables(
    organisationId: string | null,
    factureDemandee: string | null,
  ): Promise<readonly FactureCandidate[]> {
    this.controler("facturesEncaissables");
    // On reproduit le filtre de `lireFactures` : quand une facture est
    // DÉSIGNÉE, on la rend sans filtrer sur l'entreprise — c'est ce qui
    // permet à `rapprocher()` de constater qu'elle appartient à
    // quelqu'un d'autre et de refuser.
    if (factureDemandee !== null) return Promise.resolve(this.factures.filter((f) => f.id === factureDemandee));
    if (organisationId === null) return Promise.resolve([]);
    return Promise.resolve(this.factures.filter((f) => f.organizationId === organisationId));
  }

  /**
   * LA LECTURE D'IDEMPOTENCE, RENDUE AVEUGLE.
   *
   * Sous vraie concurrence, les deux livraisons peuvent LIRE avant que
   * l'une ait écrit : la lecture ne voit alors rien, et c'est la
   * contrainte d'unicité qui doit trancher. Ce drapeau force ce pire
   * cas, pour que le test de course éprouve la CONTRAINTE et non le
   * raccourci — sans quoi il ne prouverait plus rien du tout.
   */
  lectureIdempotenceAveugle = false;

  /**
   * LES FACTURES NE BOUGENT PAS — le modèle fidèle de la CONCURRENCE.
   *
   * Sous READ COMMITTED, deux livraisons simultanées lisent l'état de
   * la facture AVANT que l'une ait écrit : toutes deux la voient
   * `issued` avec son reste à payer entier, toutes deux la retiennent,
   * et toutes deux atteignent l'encaissement. C'est là, et seulement
   * là, que la contrainte d'unicité tranche.
   *
   * Ce drapeau reproduit cette lecture simultanée. Il ne sert QUE dans
   * le test de course : partout ailleurs, l'état change comme en base.
   */
  facturesFigees = false;

  encaissementDejaPose(reference: string): Promise<boolean> {
    this.controler("encaissementDejaPose");
    if (this.lectureIdempotenceAveugle) return Promise.resolve(false);
    // La même clé que l'index d'unicité de 0083 § 5.a.
    return Promise.resolve(this.paiements.some((p) => p.reference === reference));
  }

  enregistrerEncaissement(demande: DemandeEncaissement): Promise<"recorded" | "duplicate"> {
    this.controler("enregistrerEncaissement");
    if (!this.evenements.has(demande.evenementId)) {
      // 0083 § 8.d : l'événement doit être au journal. L'ordre est
      // imposé par la base, pas par la discipline de l'appelant.
      throw new RefusMetier("L'événement n'est pas au journal.");
    }
    // L'INDEX UNIQUE PARTIEL (method, external_reference).
    if (this.paiements.some((p) => p.reference === demande.reference)) return Promise.resolve("duplicate");
    this.paiements.push({
      reference: demande.reference,
      factureId: demande.factureId,
      montantCentimes: demande.montantCentimes,
    });

    // ══════════════════════════════════════════════════════════════
    // L'ENCAISSEMENT CHANGE L'ÉTAT DE LA FACTURE, ET C'EST LE POINT
    // ══════════════════════════════════════════════════════════════
    //
    // Ce double laissait auparavant `factures` FIGÉ. Toute la suite de
    // tests tournait donc contre une base qui ne changeait jamais
    // d'état — et le défaut le plus subtil du webhook était par
    // construction invisible : un rejeu retrouvait sa facture intacte
    // et « réussissait », alors qu'en vrai la facture est passée à
    // `paid` et n'est plus candidate au rapprochement.
    //
    // On reproduit donc ce que fait la base : le reste à payer
    // diminue, et la facture sort des encaissables quand elle est
    // soldée. Un double qui ment sur l'état ne prouve rien.
    if (this.facturesFigees) return Promise.resolve("recorded");

    this.factures = this.factures.map((f) => {
      if (f.id !== demande.factureId || f.resteCentimes === null) return f;
      const reste = f.resteCentimes - demande.montantCentimes;
      return { ...f, resteCentimes: reste, statut: reste <= 0 ? "paid" : f.statut };
    });
    // `lireFactures` (index.ts) ne sélectionne que les factures
    // `issued` : une facture soldée disparaît des candidates.
    this.factures = this.factures.filter((f) => f.statut === "issued");

    return Promise.resolve("recorded");
  }
}

// ==================================================================
// LE CHEMIN NORMAL
// ==================================================================

test("un `invoice.paid` pose UN encaissement et clôt l'événement en « applied »", async () => {
  const base = new BaseSimulee();
  const reponse = await jouer(base, facturePayee());

  assert.equal(reponse.statut, 200);
  assert.deepEqual(base.paiements, [{ reference: "in_stripe_1", factureId: "f-1", montantCentimes: 9588 }]);
  assert.equal(base.evenements.get("evt_1")?.outcome, "applied");
  // La référence portée est celle de Stripe, telle quelle : c'est elle
  // qui supporte l'idempotence, et un administrateur peut la coller
  // dans le tableau de bord du prestataire.
  assert.equal(base.paiements[0].reference, "in_stripe_1");
});

test("le rattachement du client se fait AU PASSAGE, sans attendre la session", async () => {
  const base = new BaseSimulee();
  await jouer(base, facturePayee());
  assert.equal(base.clients.get(ORG), CLIENT);
});

// ==================================================================
// LE REJEU — le fonctionnement normal de Stripe, pas une hypothèse
// ==================================================================

test("LE MÊME ÉVÉNEMENT LIVRÉ TROIS FOIS NE POSE QU'UN SEUL ENCAISSEMENT", async () => {
  const base = new BaseSimulee();
  const premiere = await jouer(base, facturePayee());
  const deuxieme = await jouer(base, facturePayee());
  const troisieme = await jouer(base, facturePayee());

  assert.equal(premiere.statut, 200);
  assert.equal(deuxieme.statut, 200);
  assert.equal(troisieme.statut, 200);
  assert.equal(base.paiements.length, 1, "trois livraisons, un seul encaissement");
  // Les rejeux annoncent l'issue déjà consignée, ils ne la refont pas.
  assert.deepEqual(deuxieme.corps, { recu: true, deja: "applied" });
});

test("DEUX LIVRAISONS SIMULTANÉES N'EN POSENT QU'UNE — la course est perdue par la base", async () => {
  // Les deux passent l'inscription AVANT que l'une ait clos : la
  // première inscrit, la seconde reçoit « duplicate » et voit un
  // événement NON CLOS, donc rejoue l'effet. C'est l'unicité
  // (method, external_reference) qui empêche le second paiement — pas
  // un « if déjà traité », qui serait franchi par les deux.
  const base = new BaseSimulee();
  // LA LECTURE D'IDEMPOTENCE EST RENDUE AVEUGLE, et c'est ce qui donne
  // sa valeur au test. Sous vraie concurrence, les deux livraisons
  // peuvent lire avant que l'une ait écrit : le raccourci ne voit rien,
  // et il ne reste que la contrainte. C'est CELLE-LÀ qu'on éprouve ici.
  base.lectureIdempotenceAveugle = true;
  // …et les deux voient la même facture, comme deux transactions
  // concurrentes qui lisent avant que l'une ait écrit.
  base.facturesFigees = true;

  const [a, b] = await Promise.all([jouer(base, facturePayee()), jouer(base, facturePayee())]);

  assert.equal(a.statut, 200);
  assert.equal(b.statut, 200);
  assert.equal(base.paiements.length, 1);
  assert.equal(base.evenements.get("evt_1")?.outcome, "applied");

  // ON VÉRIFIE QUE LA COURSE A BIEN EU LIEU. Sans ce contrôle, le test
  // passerait aussi si la première livraison s'était entièrement
  // terminée avant que la seconde ne commence — c'est-à-dire s'il
  // n'avait rien éprouvé du tout. Deux tentatives d'encaissement, un
  // seul paiement : c'est la contrainte qui a tranché.
  const tentatives = base.appels.filter((m) => m === "enregistrerEncaissement").length;
  assert.equal(tentatives, 2, "les deux livraisons doivent avoir tenté l'encaissement");
});

test("UN REJEU APRÈS UNE CLÔTURE TOMBÉE NE CONSIGNE PAS « failed » SUR UN SUCCÈS", async () => {
  // ══════════════════════════════════════════════════════════════
  // LE DÉFAUT QUE CE TEST GARDE FERMÉ
  // ══════════════════════════════════════════════════════════════
  //
  // Séquence réelle : l'encaissement réussit, la clôture tombe (réseau),
  // on rend 503, le prestataire rejoue. Le rejeu repassait alors par le
  // RAPPROCHEMENT — qui ne considère que les factures `issued`. Or la
  // facture vient d'être soldée et est passée à `paid` : zéro candidate.
  //
  // L'argent n'était pas doublé, l'index d'unicité tenait. Mais le
  // journal consignait « failed » sur un encaissement RÉUSSI, avec un
  // motif invitant explicitement un humain à poser à la main un
  // paiement qui existait déjà — et s'il employait sa propre référence,
  // la base l'acceptait.
  const base = new BaseSimulee();
  base.panne = { methode: "clore", restant: 1 };

  const premiere = await jouer(base, facturePayee());
  assert.equal(premiere.statut, 503, "la clôture est tombée : 503 pour faire rejouer");
  assert.equal(base.paiements.length, 1, "mais l'argent, lui, est bien posé");
  // La facture est soldée : elle n'est PLUS candidate au rapprochement.
  assert.equal(base.factures.length, 0);

  const rejeu = await jouer(base, facturePayee());

  assert.equal(rejeu.statut, 200);
  assert.equal(rejeu.corps.issue, "applied", "le rejeu constate un succès, il n'en invente pas un échec");
  assert.equal(base.paiements.length, 1, "et il ne double pas l'argent");
  assert.equal(base.evenements.get("evt_1")?.outcome, "applied");
});

test("UN ÉVÉNEMENT INSCRIT MAIS NON CLOS EST REPRIS, PAS ACQUITTÉ EN SILENCE", async () => {
  // Le cas de la livraison tombée en route : l'événement est au
  // journal, l'effet n'a jamais eu lieu. Répondre 200 « déjà vu »
  // perdrait l'encaissement définitivement — Stripe ne rejouerait plus.
  const base = new BaseSimulee();
  base.evenements.set("evt_1", { outcome: "pending", processed_at: null });

  const reponse = await jouer(base, facturePayee());

  assert.equal(reponse.statut, 200);
  assert.equal(base.paiements.length, 1, "l'effet manquant doit être repris");
  assert.equal(base.evenements.get("evt_1")?.outcome, "applied");
});

// ==================================================================
// LE DÉSORDRE
// ==================================================================

test("LE DÉSORDRE : `invoice.paid` AVANT la session se suffit à lui-même", async () => {
  const base = new BaseSimulee();

  // L'argent arrive avant que le client n'ait été rattaché.
  const paiement = await jouer(base, facturePayee());
  assert.equal(paiement.statut, 200);
  assert.equal(base.paiements.length, 1);

  // Puis la session arrive. Elle ne casse rien : le rattachement
  // existe déjà et vaut « alreadyLinked ».
  const session = await jouer(base, sessionTerminee());
  assert.equal(session.statut, 200);
  assert.equal(base.evenements.get("evt_session")?.outcome, "applied");
  assert.equal(base.clients.get(ORG), CLIENT);
  assert.equal(base.paiements.length, 1, "la session ne pose aucun argent");
});

test("L'ORDRE INVERSE DONNE LE MÊME RÉSULTAT — session puis paiement", async () => {
  const base = new BaseSimulee();
  await jouer(base, sessionTerminee());
  await jouer(base, facturePayee());

  assert.equal(base.clients.get(ORG), CLIENT);
  assert.deepEqual(base.paiements, [{ reference: "in_stripe_1", factureId: "f-1", montantCentimes: 9588 }]);
});

test("UN RENOUVELLEMENT SANS MÉTADONNÉE retrouve l'entreprise par le rattachement", async () => {
  // Dans deux ans, un renouvellement dont l'abonnement aurait perdu ses
  // métadonnées : il ne reste que le client. L'annuaire suffit.
  const base = new BaseSimulee();
  base.clients.set(ORG, CLIENT);

  const brut = facturePayee({ parent: undefined, id: "in_stripe_2" });
  const reponse = await jouer(base, { ...(brut as object), id: "evt_renouvellement" });

  assert.equal(reponse.statut, 200);
  assert.equal(base.paiements.length, 1);
  assert.equal(base.paiements[0].reference, "in_stripe_2");
  // On vérifie que c'est bien l'ANNUAIRE qui a résolu l'entreprise, et
  // non une métadonnée oubliée dans le corps d'essai : sans cette
  // ligne, le test passerait aussi si le corps portait l'entreprise, et
  // n'éprouverait donc pas le chemin du renouvellement.
  assert.ok(base.appels.includes("organisationDuClient"), "l'entreprise doit être retrouvée par le rattachement");
});

// ==================================================================
// CE QUI N'EST QUE CONSTATÉ
// ==================================================================

test("LE CYCLE DE VIE D'UN ABONNEMENT EST CONSTATÉ, JAMAIS APPLIQUÉ", async () => {
  const base = new BaseSimulee();
  const reponse = await jouer(base, {
    id: "evt_abo",
    type: "customer.subscription.updated",
    livemode: false,
    data: { object: { object: "subscription", id: "sub_1", customer: CLIENT, status: "active" } },
  });

  assert.equal(reponse.statut, 200);
  assert.equal(base.evenements.get("evt_abo")?.outcome, "ignored");
  assert.equal(base.paiements.length, 0);
  assert.equal(base.clients.size, 0, "aucun rattachement n'est créé par un événement d'abonnement");
});

test("UN ÉCHEC DE PAIEMENT N'EFFACE RIEN — il est consigné et c'est tout", async () => {
  const base = new BaseSimulee();
  base.clients.set(ORG, CLIENT);

  const reponse = await jouer(base, {
    id: "evt_echec",
    type: "invoice.payment_failed",
    livemode: false,
    data: { object: { object: "invoice", id: "in_3", customer: CLIENT, amount_due: 9588, currency: "eur" } },
  });

  assert.equal(reponse.statut, 200);
  assert.equal(base.evenements.get("evt_echec")?.outcome, "ignored");
  assert.equal(base.paiements.length, 0);
  // L'annuaire est intact : rien n'est supprimé à l'échec (§ 26).
  assert.equal(base.clients.get(ORG), CLIENT);
});

test("L'ARGENT N'EST CONSTATÉ QUE SUR `invoice.paid` — pas deux fois", async () => {
  // `payment_intent.succeeded` annonce le MÊME encaissement avec une
  // autre référence : le traiter poserait un second paiement que
  // l'unicité (method, external_reference) ne verrait pas.
  const base = new BaseSimulee();
  await jouer(base, facturePayee());
  await jouer(base, {
    id: "evt_pi",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: { object: "payment_intent", id: "pi_1", customer: CLIENT, amount: 9588, currency: "eur" } },
  });

  assert.equal(base.paiements.length, 1);
  assert.equal(base.evenements.get("evt_pi")?.outcome, "ignored");
});

// ==================================================================
// CE QUI ÉCHOUE, ET COMMENT
// ==================================================================

test("DE L'ARGENT SANS FACTURE RAPPROCHABLE EST « failed », PAS « ignored »", async () => {
  // C'est un écart de trésorerie, pas un non-événement : un humain doit
  // le voir. Et la réponse reste 200 — sans quoi Stripe rejouerait
  // pendant trois jours une erreur qui ne changera pas, jusqu'à
  // désactiver le point de terminaison.
  const base = new BaseSimulee();
  base.factures = [];

  const reponse = await jouer(base, facturePayee());

  assert.equal(reponse.statut, 200);
  assert.equal(base.evenements.get("evt_1")?.outcome, "failed");
  assert.equal(base.paiements.length, 0);
  assert.notEqual(reponse.journal, null, "un écart de trésorerie doit laisser une trace dans les journaux");
  assert.match(reponse.journal ?? "", /in_stripe_1/, "la référence Stripe doit figurer pour le rapprochement à la main");
});

test("UN REFUS DE LA BASE CLÔT EN « failed » ET REND 200 — jamais une boucle de rejeu", async () => {
  const base = new BaseSimulee();
  base.refus = { methode: "enregistrerEncaissement", message: "Facture annulée : elle n'encaisse plus rien. (23514)" };

  const reponse = await jouer(base, facturePayee());

  assert.equal(reponse.statut, 200);
  assert.equal(base.evenements.get("evt_1")?.outcome, "failed");
});

test("UNE PANNE LAISSE L'ÉVÉNEMENT OUVERT ET REND 503 — Stripe doit rejouer", async () => {
  const base = new BaseSimulee();
  base.panne = { methode: "enregistrerEncaissement", restant: 1 };

  const reponse = await jouer(base, facturePayee());

  assert.equal(reponse.statut, 503);
  assert.equal(base.paiements.length, 0);
  // NON CLOS : c'est ce qui permet au rejeu de reprendre l'effet.
  // Clore en « failed » ici gèlerait l'événement pour une panne d'une
  // seconde.
  assert.equal(base.evenements.get("evt_1")?.outcome, "pending");
  assert.equal(base.evenements.get("evt_1")?.processed_at, null);
});

test("APRÈS UNE PANNE, LE REJEU REPREND L'EFFET ET NE LE DOUBLE PAS", async () => {
  const base = new BaseSimulee();
  base.panne = { methode: "enregistrerEncaissement", restant: 1 };

  const premiere = await jouer(base, facturePayee());
  assert.equal(premiere.statut, 503);

  const seconde = await jouer(base, facturePayee());
  assert.equal(seconde.statut, 200);
  assert.equal(base.paiements.length, 1);
  assert.equal(base.evenements.get("evt_1")?.outcome, "applied");
});

test("UNE CLÔTURE QUI TOMBE REND 503, ET LE REJEU NE DOUBLE PAS L'ARGENT", async () => {
  // L'effet a eu lieu, la clôture non. Mieux vaut un rejeu inutile
  // qu'un journal qui ment sur ce qui a été fait.
  const base = new BaseSimulee();
  base.panne = { methode: "clore", restant: 1 };

  const premiere = await jouer(base, facturePayee());
  assert.equal(premiere.statut, 503);
  assert.equal(base.paiements.length, 1, "l'encaissement, lui, a bien eu lieu");

  const seconde = await jouer(base, facturePayee());
  assert.equal(seconde.statut, 200);
  assert.equal(base.paiements.length, 1, "le rejeu ne double pas l'argent");
  assert.equal(base.evenements.get("evt_1")?.outcome, "applied");
});

test("UNE PANNE À L'INSCRIPTION N'ÉCRIT RIEN ET REND 503", async () => {
  const base = new BaseSimulee();
  base.panne = { methode: "inscrireEvenement", restant: 1 };

  const reponse = await jouer(base, facturePayee());

  assert.equal(reponse.statut, 503);
  assert.equal(base.evenements.size, 0);
  assert.equal(base.paiements.length, 0);
});

test("UN RATTACHEMENT REFUSÉ NE FAIT PAS PERDRE L'ENCAISSEMENT", async () => {
  // Le cas réel : un tunnel repris depuis le début a créé un SECOND
  // client chez Stripe. L'annuaire refuse le second rattachement — à
  // juste titre — mais l'argent, lui, est arrivé et l'entreprise est
  // connue par les métadonnées de l'événement signé. Faire échouer
  // l'encaissement pour un problème d'annuaire laisserait un vrai
  // paiement attaché à aucune facture.
  const base = new BaseSimulee();
  base.clients.set(ORG, "cus_precedent");

  const reponse = await jouer(base, facturePayee());

  assert.equal(reponse.statut, 200);
  assert.equal(base.paiements.length, 1, "l'argent doit être posé malgré le refus de rattachement");
  assert.equal(base.evenements.get("evt_1")?.outcome, "applied");
  // L'anomalie n'est pas avalée pour autant : elle voyage avec le
  // succès pour qu'un humain la voie.
  assert.equal(base.clients.get(ORG), "cus_precedent", "l'annuaire n'est jamais écrasé en silence");
});

test("une session sans métadonnée d'organisation ne rattache rien — rien n'est inventé", async () => {
  const base = new BaseSimulee();
  const reponse = await jouer(base, sessionTerminee({ metadata: {} }));

  assert.equal(reponse.statut, 200);
  assert.equal(base.evenements.get("evt_session")?.outcome, "ignored");
  assert.equal(base.clients.size, 0);
});

test("PAYER LA FACTURE D'UNE AUTRE ENTREPRISE EST REFUSÉ DE BOUT EN BOUT", async () => {
  const base = new BaseSimulee();
  base.factures = [
    { id: "f-autre", organizationId: AUTRE_ORG, devise: "EUR", statut: "issued", resteCentimes: 9588 },
  ];

  const brut = facturePayee({ metadata: { oasis_invoice_id: "f-autre" } });
  const reponse = await jouer(base, brut);

  assert.equal(reponse.statut, 200);
  assert.equal(base.paiements.length, 0);
  assert.equal(base.evenements.get("evt_1")?.outcome, "failed");
});

test("UN ENCAISSEMENT N'OUVRE JAMAIS D'ABONNEMENT", async () => {
  // ══════════════════════════════════════════════════════════════
  // CE TEST DISAIT L'INVERSE, ET IL AVAIT RAISON DE LE DIRE — JUSQU'À
  // CE QUE LE CHEMIN EXISTE.
  // ══════════════════════════════════════════════════════════════
  //
  // Il affirmait « le webhook n'ouvre aucun abonnement, la porte
  // n'existe même pas », au motif que 0083 § 11 n'offrait aucun chemin
  // machine. 0089 § 4 en a posé un — `saas_start_subscription` — et
  // l'audit a mesuré qu'il n'avait AUCUN appelant : l'argent arrivait
  // donc toujours avant la facture, et chaque prélèvement tombait en
  // rapprochement manuel.
  //
  // Ce qui reste vrai, et qu'on garde : l'ARGENT n'ouvre rien. Un
  // `invoice.paid` constate un encaissement sur une facture existante,
  // point. Ouvrir un abonnement à partir d'un paiement, ce serait
  // ouvrir un droit sur un événement dont on ne sait pas ce qu'il
  // vendait.
  const base = new BaseSimulee();
  await jouer(base, facturePayee());

  assert.equal(base.appels.includes("ouvrirAbonnement"), false);
  assert.equal(base.abonnements.size, 0);
});

test("UNE SESSION CONFIRMÉE OUVRE L'ABONNEMENT — c'est ce qui manquait", async () => {
  const base = new BaseSimulee();
  const reponse = await jouer(base, sessionAvecContrat());

  assert.equal(reponse.statut, 200);
  assert.equal(base.evenements.get("evt_session")?.outcome, "applied");

  const demande = base.abonnements.get(ORG);
  assert.ok(demande, "L'abonnement doit être ouvert.");
  assert.equal(demande.plan, "team");
  assert.equal(demande.cycle, "monthly");
  assert.equal(demande.avecEssai, true);
  assert.equal(demande.clientPrestataire, CLIENT);
});

test("LES TROIS VÉRITÉS DU DEHORS TRAVERSENT INTACTES", async () => {
  // La base compte en UTC, l'écran compte à Paris, et c'est le
  // PRESTATAIRE qui débite — à la date annoncée au client. Un recalcul
  // côté base fixait une ancre différente, donc décalait tous les mois
  // suivants, et la facture ne tombait plus le jour de l'encaissement.
  const base = new BaseSimulee();
  await jouer(base, sessionAvecContrat());

  const demande = base.abonnements.get(ORG);
  assert.ok(demande);
  assert.equal(demande.finEssaiLe, "2026-10-06");
  // L'ancre est celle ANNONCÉE, et elle ne se déduit pas de la date :
  // un essai ouvert le 31 janvier finit le 28 février, et l'ancre reste
  // 31 (0089 § 1).
  assert.equal(demande.jourAnniversaire, 6);
  // Et les sièges viennent de la CAISSE : c'est ce qui a été débité.
  assert.equal(demande.siegesFacturables, 3);
});

test("SANS ESSAI, AUCUNE DATE D'ESSAI NE PART", async () => {
  // Transmettre une fin d'essai à un client qui paie tout de suite
  // ouvrirait un essai en base pendant que le prestataire débite : le
  // pire des deux mondes.
  const base = new BaseSimulee();
  await jouer(base, sessionAvecContrat({ avecEssai: "false" }));

  const demande = base.abonnements.get(ORG);
  assert.ok(demande);
  assert.equal(demande.avecEssai, false);
  assert.equal(demande.finEssaiLe, null);
});

test("UNE CLÉ « avecEssai » MAL ORTHOGRAPHIÉE FAIT PAYER, ELLE N'OFFRE PAS UN MOIS", async () => {
  // Le sens de l'erreur qui coûte le moins : seul « true » vaut essai.
  for (const valeur of ["vrai", "TRUE", "1", "oui", ""]) {
    const base = new BaseSimulee();
    await jouer(base, sessionAvecContrat({ avecEssai: valeur }));
    assert.equal(
      base.abonnements.get(ORG)?.avecEssai,
      false,
      `« ${valeur} » ne doit pas ouvrir un mois gratuit.`,
    );
  }
});

test("UN NOMBRE DE SIÈGES ILLISIBLE VAUT « JE NE SAIS PAS », JAMAIS ZÉRO", async () => {
  // « Zéro siège supplémentaire » et « je n'ai pas su lire » sont deux
  // réponses différentes. La seconde doit laisser la base recompter,
  // pas facturer un chiffre inventé — c'est la règle « jamais de || 0
  // derrière un montant qui peut être inconnu ».
  const base = new BaseSimulee();
  await jouer(base, sessionAvecContrat({ siegesFacturables: "trois" }));
  assert.equal(base.abonnements.get(ORG)?.siegesFacturables, null);

  const base2 = new BaseSimulee();
  await jouer(base2, sessionAvecContrat({ siegesFacturables: "0" }));
  assert.equal(base2.abonnements.get(ORG)?.siegesFacturables, 0);
});

test("UNE SESSION SANS LE CONTRAT RETOMBE SUR LE SIMPLE RATTACHEMENT", async () => {
  // Une session créée à la main dans le tableau de bord du prestataire,
  // ou une session d'avant ce chantier. On n'invente pas d'abonnement à
  // partir d'une session dont on ne sait pas ce qu'elle vendait.
  const base = new BaseSimulee();
  const reponse = await jouer(base, sessionTerminee());

  assert.equal(reponse.statut, 200);
  assert.equal(base.abonnements.size, 0);
  assert.equal(base.clients.get(ORG), CLIENT);
});

test("UNE ENTREPRISE DÉJÀ ABONNÉE N'EST PAS UNE ANOMALIE", async () => {
  // C'est le rejeu d'un événement, ou une seconde session. On consigne
  // « ignored » et on répond 200 : consigner « failed » ferait rejouer
  // Stripe trois jours pour une situation parfaitement normale.
  const base = new BaseSimulee();
  await jouer(base, sessionAvecContrat());

  const seconde = await traiter(
    base,
    { ...lire(sessionAvecContrat()).evenement, id: "evt_session_2" },
    lire(sessionAvecContrat()).intention,
  );

  assert.equal(seconde.statut, 200);
  assert.equal(base.evenements.get("evt_session_2")?.outcome, "ignored");
  assert.equal(base.abonnements.size, 1);
});

test("UNE ENTREPRISE FERMÉE QUI REPASSE À LA CAISSE EST REPRISE, PAS IGNORÉE", async () => {
  // ══════════════════════════════════════════════════════════════
  // LE CHEMIN DU RETOUR. C'est la moitié manquante du péage.
  // ══════════════════════════════════════════════════════════════
  //
  // `saas_start_subscription` lève 23505 dès qu'une ligne existe, et il
  // en existe toujours une après la première souscription. Avant cette
  // reprise, une entreprise résiliée ou suspendue voyait son paiement
  // partir et son accès rester fermé : on encaissait sans rouvrir. Un
  // péage sans sortie n'est pas un péage, c'est une prison.
  const base = new BaseSimulee();
  await jouer(base, sessionAvecContrat());
  assert.equal(base.abonnements.size, 1);

  // Le temps passe : le prélèvement échoue, le péage ferme. La ligne
  // d'abonnement, elle, RESTE — c'est tout le problème que la reprise
  // résout, et c'est pour cela qu'on ne la supprime pas ici.
  base.abonnementsFermes.add(ORG);

  const retour = await traiter(
    base,
    { ...lire(sessionAvecContrat()).evenement, id: "evt_retour" },
    lire(sessionAvecContrat()).intention,
  );

  assert.equal(retour.statut, 200);
  assert.equal(
    base.evenements.get("evt_retour")?.outcome,
    "applied",
    "Une reprise est un effet appliqué, pas un événement ignoré.",
  );
  assert.equal(base.abonnementsFermes.has(ORG), false, "L'abonnement doit être rouvert.");
  assert.equal(base.appels.includes("reprendreAbonnement"), true);
});

test("LA REPRISE N'OFFRE JAMAIS UN SECOND MOIS D'ESSAI", async () => {
  // Résilier pour redemander un mois gratuit serait le dernier
  // contournement du péage. La base le refuse ; on ne le lui demande
  // même pas, et c'est ce que ce test fige : la session porte pourtant
  // « avecEssai = true ».
  const base = new BaseSimulee();
  base.abonnementsFermes.add(ORG);
  base.abonnements.set(ORG, {
    organisationId: ORG, plan: "team", cycle: "monthly", avecEssai: true,
    clientPrestataire: "cus_1", mode: "test", finEssaiLe: null,
    jourAnniversaire: null, siegesFacturables: null,
  });

  await jouer(base, sessionAvecContrat({ avecEssai: "true" }));

  assert.equal(
    base.abonnements.get(ORG)?.avecEssai,
    false,
    "La reprise doit demander un abonnement payant, jamais un essai.",
  );
  assert.equal(base.abonnements.get(ORG)?.finEssaiLe, null);
});

test("UN ABONNEMENT EN COURS N'EST PAS « REPRIS » — la base tranche, pas nous", async () => {
  // La reprise est tentée, la base refuse (rien à rouvrir), et l'on
  // retombe sur « ignored ». C'est ce qui distingue un rejeu banal
  // d'un vrai retour, et ce n'est pas au webhook d'en décider.
  const base = new BaseSimulee();
  await jouer(base, sessionAvecContrat());

  const rejeu = await traiter(
    base,
    { ...lire(sessionAvecContrat()).evenement, id: "evt_rejeu" },
    lire(sessionAvecContrat()).intention,
  );

  assert.equal(base.appels.includes("reprendreAbonnement"), true, "On demande…");
  assert.equal(rejeu.statut, 200);
  assert.equal(base.evenements.get("evt_rejeu")?.outcome, "ignored", "…et la base dit non.");
});

test("L'ABONNEMENT EST OUVERT AVANT QUE L'ARGENT N'ARRIVE", async () => {
  // ══════════════════════════════════════════════════════════════
  // LA CHAÎNE COMPLÈTE, DANS L'ORDRE OÙ STRIPE LA LIVRE.
  // ══════════════════════════════════════════════════════════════
  //
  // C'est la règle que 0089 s'est donnée en tête de fichier : « La
  // facture PRÉCÈDE l'encaissement, jamais l'inverse. » Sans elle, le
  // rapprochement ne trouve aucune candidate et chaque prélèvement
  // tombe en « à rapprocher à la main ».
  const base = new BaseSimulee();
  base.factures = [];

  await jouer(base, sessionAvecContrat({ avecEssai: "false" }));
  assert.equal(base.abonnements.get(ORG)?.avecEssai, false);

  // La facture que `saas_start_subscription` vient d'émettre.
  base.factures = [
    { id: "f-neuve", organizationId: ORG, devise: "EUR", statut: "issued", resteCentimes: 9588 },
  ];

  const paiement = await jouer(base, facturePayee());
  assert.equal(paiement.statut, 200);
  assert.equal(base.paiements.length, 1, "L'encaissement doit trouver sa facture.");
  assert.equal(base.paiements[0].factureId, "f-neuve");
  assert.equal(base.evenements.get("evt_1")?.outcome, "applied");
});
