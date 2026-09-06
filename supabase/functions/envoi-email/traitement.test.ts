// Oasis Care — Chantier courriel. LES PREUVES SUR L'ORCHESTRATION.
//
//     node --test --experimental-strip-types "supabase/functions/envoi-email/traitement.test.ts"
//
// AUCUN RÉSEAU, AUCUNE BASE. La porte est un double qui enregistre ce
// qu'on lui demande ; le transporteur aussi. Un test qui exigerait l'un
// ou l'autre ne tournerait jamais en intégration.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  construireVariables,
  joursDeRetard,
  traiterNouvelles,
  traiterOrdre,
  viderFile,
  type OrdreEnvoi,
} from "./traitement.ts";
import type {
  ArgumentsMiseEnFile,
  FaitObjet,
  MessageEnFile,
  PorteBase,
} from "./porte.ts";
import {
  EnvoyeurIndisponible,
  type EnveloppeCourriel,
  type EnvoyeurCourriel,
  type MentionsEntreprise,
} from "./bibliotheque.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const AUTRE_ORG = "99999999-9999-4999-8999-999999999999";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const FACTURE = "33333333-3333-4333-8333-333333333333";
const DEVIS = "44444444-4444-4444-8444-444444444444";

const MENTIONS: MentionsEntreprise = {
  raisonSociale: "Jardins Dupont",
  siret: "12345678900011",
  adresse1: "3 chemin des Tilleuls",
  codePostal: "44000",
  ville: "Nantes",
  courriel: "contact@jardins-dupont.example",
};

const MENTIONS_OASIS: MentionsEntreprise = {
  raisonSociale: "Oasis Care SAS",
  siret: "99988877700011",
  adresse1: "2 rue de la Serre",
  codePostal: "75011",
  ville: "Paris",
  courriel: "bonjour@oasis.example",
};

const REGLAGES = {
  baseUrl: "https://pro.example",
  adresseTechnique: "envoi@expediteur.example",
};

const FAIT_FACTURE: FaitObjet = {
  organizationId: ORG,
  customerId: CLIENT,
  numero: "FA-2026-0042",
  titre: null,
  dateFait: "2026-09-01T08:00:00.000Z",
  dateLimite: "2026-10-05",
  decideLe: null,
  statut: "issued",
  archiveLe: null,
  totalTtcCentimes: 124050,
  resteDuCentimes: 124050,
};

const FAIT_DEVIS: FaitObjet = {
  organizationId: ORG,
  customerId: CLIENT,
  numero: "DV-2026-0007",
  titre: "Création de massif",
  dateFait: "2026-09-01T08:00:00.000Z",
  dateLimite: "2026-10-01",
  decideLe: null,
  statut: "sent",
  archiveLe: null,
  totalTtcCentimes: 98000,
  resteDuCentimes: null,
};

// ────────────────────────────────────────────────────────────────
// LES DOUBLES
// ────────────────────────────────────────────────────────────────

type Journal = {
  misEnFile: ArgumentsMiseEnFile[];
  reserves: string[];
  envoyes: { id: string; identifiant: string; empreinte: string | null | undefined }[];
  echecs: { id: string; raison: string; code: string | null; temporaire: boolean }[];
  incertains: { id: string; raison: string }[];
  evenements: { identifiant: string; evenement: string; instant: string }[];
  jetonsDemandes: string[];
  portesRejouees: string[];
};

type Options = {
  raisonBloquante?: string | null;
  /** Ce que la réservation de lot rend, une fois : un second appel ne rend rien. */
  file?: MessageEnFile[];
  fait?: FaitObjet | null;
  /** La porte rejouée au moment d'expédier. */
  verdict?: { ok: boolean; raison: string | null };
  /** La réservation d'un message précis. */
  reservationAcquise?: boolean;
  /** Le marquage « parti » réussit-il ? */
  marquageReussi?: boolean;
};

function porteDouble(
  journal: Journal,
  surcharge: Partial<PorteBase> = {},
  options: Options = {},
): PorteBase {
  // LA FILE NE SE REND QU'UNE FOIS, et c'est le point du double : une
  // ligne réservée n'est plus « en attente ». Un double qui rendrait
  // toujours la même ligne simulerait une base qui n'a pas de
  // réservation, c'est-à-dire précisément le défaut qu'on corrige.
  let file = options.file ?? [];

  return {
    async lireIdentite() {
      return {
        nomAffiche: "Jardins Dupont",
        repondreA: "contact@jardins-dupont.example",
        cheminLogo: null,
        raisonBloquante: options.raisonBloquante ?? null,
        avertissements: [],
      };
    },
    async lireMentions(_org, natureOasis = false) {
      return natureOasis ? MENTIONS_OASIS : MENTIONS;
    },
    async lireDestinataire() {
      return {
        email: "marie@client.example",
        nom: "Marie Martin",
        contactId: null,
        raisonBloquante: null,
      };
    },
    async lireFait(entityType) {
      if (options.fait !== undefined) return options.fait;
      return entityType === "quote" ? FAIT_DEVIS : FAIT_FACTURE;
    },
    async lireJetonDesabonnement(_org, email) {
      journal.jetonsDemandes.push(email);
      return "b".repeat(64);
    },
    urlPubliqueLogo() {
      return null;
    },
    async mettreEnFile(args) {
      journal.misEnFile.push(args);
      return {
        messageId: `msg-${journal.misEnFile.length}`,
        cree: true,
        raisonBloquante: null,
        avertissements: [],
      };
    },
    async reserverUn(id) {
      journal.reserves.push(id);
      return options.reservationAcquise ?? true;
    },
    async reserverFile() {
      const lot = file;
      file = [];
      return lot;
    },
    async verifierEncoreExpediable(id) {
      journal.portesRejouees.push(id);
      return options.verdict ?? { ok: true, raison: null };
    },
    async marquerEnvoye(id, _cle, identifiant, empreinte) {
      journal.envoyes.push({ id, identifiant, empreinte });
      return options.marquageReussi ?? true;
    },
    async marquerEchec(id, raison, code, _cle, temporaire) {
      journal.echecs.push({ id, raison, code, temporaire });
      return true;
    },
    async marquerSortInconnu(id, raison) {
      journal.incertains.push({ id, raison });
      return true;
    },
    async enregistrerEvenement(_cle, identifiant, evenement, instant) {
      journal.evenements.push({ identifiant, evenement, instant });
    },
    ...surcharge,
  };
}

function journalVide(): Journal {
  return {
    misEnFile: [], reserves: [], envoyes: [], echecs: [], incertains: [],
    evenements: [], jetonsDemandes: [], portesRejouees: [],
  };
}

function envoyeurDouble(
  enveloppes: EnveloppeCourriel[],
  resultat: "remis" | "refuse" | "refuseTemporaire" | "incertain" = "remis",
): EnvoyeurCourriel {
  return {
    cle: "double",
    libelle: "Double de test",
    raisonIndisponibilite: null,
    async expedier(enveloppe) {
      enveloppes.push(enveloppe);
      if (resultat === "remis") {
        return { etat: "remis", identifiantTransporteur: `id-${enveloppes.length}` };
      }
      if (resultat === "incertain") {
        return { etat: "incertain", raison: "Pas de réponse du transporteur." };
      }
      if (resultat === "refuseTemporaire") {
        return {
          etat: "refuse",
          raison: "Le transporteur a atteint son plafond d'envois pour aujourd'hui.",
          code: "429",
          temporaire: true,
        };
      }
      return {
        etat: "refuse",
        raison: "Adresse inexistante.",
        code: "hard_bounce",
        temporaire: false,
      };
    },
    lireNouvelle(charge) {
      const brut = charge as Record<string, unknown>;
      if (typeof brut?.event !== "string") return null;
      return {
        identifiantTransporteur: String(brut.id ?? "id-1"),
        evenement: brut.event as "delivered",
        instant: "2026-09-05T10:00:00.000Z",
        raison: null,
        charge: brut,
      };
    },
  };
}

const ORDRE_FACTURE: OrdreEnvoi = {
  organizationId: ORG,
  gabarit: "factureEmise",
  entityType: "invoice",
  entityId: FACTURE,
};

// ══════════════════════════════════════════════════════════════════
// LE DÉFAUT À NE JAMAIS COMMETTRE
// ══════════════════════════════════════════════════════════════════
//
// « Qu'un désabonnement de la publicité empêche une facture d'arriver. »
// Il est invisible en test et catastrophique en production : le client
// ne reçoit plus ses factures et personne ne sait pourquoi.
//
// La base l'interdit structurellement (0084 § 9 : le registre de
// consentement n'est lu que dans `if nature = 'publicite'`). Les tests
// qui suivent prouvent que CETTE COUCHE-CI n'ouvre pas une seconde porte
// par laquelle le défaut reviendrait.

test("une facture ne consulte JAMAIS le registre de consentement", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const porte = porteDouble(journal, {
    async lireJetonDesabonnement() {
      // Pas « rend null » : LÈVE. Si un jour quelqu'un déplace la
      // lecture du consentement hors de la branche publicitaire, ce test
      // tombe immédiatement plutôt que de laisser passer un refus
      // silencieux.
      throw new Error("Le consentement ne doit pas être consulté pour un document.");
    },
  });

  const issue = await traiterOrdre(ORDRE_FACTURE, porte, envoyeurDouble(enveloppes), REGLAGES);

  assert.equal(issue.etat, "envoye");
  assert.equal(journal.jetonsDemandes.length, 0);
  assert.equal(enveloppes.length, 1);
  assert.equal(enveloppes[0].nature, "transactionnel");
});

test("une adresse désabonnée de la publicité reçoit quand même sa facture", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  // La personne s'est désabonnée : plus aucun jeton actif. Pour une
  // publicité, ce serait un refus. Pour une facture, ce n'est même pas
  // une question posée.
  const porte = porteDouble(journal, { async lireJetonDesabonnement() { return null; } });

  const facture = await traiterOrdre(ORDRE_FACTURE, porte, envoyeurDouble(enveloppes), REGLAGES);
  assert.equal(facture.etat, "envoye");
});

// ══════════════════════════════════════════════════════════════════
// LE CONTENU NE VIENT PLUS DE L'APPELANT
// ══════════════════════════════════════════════════════════════════
//
// C'était la faille la plus grave du chantier : `variables`,
// `entityType` et `entityId` traversaient la requête HTTP jusqu'au rendu
// sans validation. Un compte inscrit pouvait faire expédier, depuis le
// domaine authentifié d'Oasis, un message au texte de son choix et au
// bouton de son choix.

test("L'ORDRE NE PORTE AUCUN TEXTE : le type lui-même n'a pas de champ pour en mettre", () => {
  // Une propriété structurelle, vérifiée sur les CLÉS de l'objet plutôt
  // que sur une intention : ajouter `variables` à `OrdreEnvoi` ferait
  // tomber ce test avant de faire tomber un client.
  const cles = Object.keys(ORDRE_FACTURE).sort();
  assert.deepEqual(cles, ["entityId", "entityType", "gabarit", "organizationId"]);
  assert.ok(!JSON.stringify(ORDRE_FACTURE).includes("@"), "aucune adresse dans l'ordre");
});

test("le montant et le nom du client viennent de la base, pas de la requête", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  await traiterOrdre(ORDRE_FACTURE, porteDouble(journal), envoyeurDouble(enveloppes), REGLAGES);

  // Les noms de variables sont ceux du CATALOGUE. La version précédente
  // émettait `totalTtcCents` là où le gabarit attend
  // `totalTtcCentimes` : la facture partait sans son montant, et rien
  // ne le signalait — le gabarit omet proprement une ligne dont la
  // valeur manque.
  assert.equal(journal.misEnFile[0].variables.totalTtcCentimes, 124050);
  assert.equal(journal.misEnFile[0].variables.nomClient, "Marie Martin");
  assert.ok(enveloppes[0].texte.includes("240,50"), "le montant s'imprime");
  assert.ok(enveloppes[0].texte.includes("Marie Martin"), "le client est nommé");
});

test("un devis d'une AUTRE entreprise est refusé, avec une phrase", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal, {}, { fait: { ...FAIT_FACTURE, organizationId: AUTRE_ORG } }),
    envoyeurDouble(enveloppes),
    REGLAGES,
  );
  assert.equal(issue.etat, "refuse");
  assert.match((issue as { raison: string }).raison, /n'appartient pas/);
  assert.equal(journal.misEnFile.length, 0);
});

test("un document introuvable — donc caché par la RLS — ne produit aucun message", async () => {
  const journal = journalVide();
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal, {}, { fait: null }),
    envoyeurDouble([]),
    REGLAGES,
  );
  assert.equal(issue.etat, "refuse");
  assert.equal(journal.misEnFile.length, 0);
});

test("sans le FAIT DATÉ, rien ne part : un statut se change, un fait daté non", async () => {
  const journal = journalVide();
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal, {}, { fait: { ...FAIT_FACTURE, dateFait: null } }),
    envoyeurDouble([]),
    REGLAGES,
  );
  assert.equal(issue.etat, "refuse");
  assert.match((issue as { raison: string }).raison, /pas émise/);
});

test("un gabarit sans chemin d'envoi est refusé plutôt que nourri à l'aveugle", async () => {
  const journal = journalVide();
  const issue = await traiterOrdre(
    { ...ORDRE_FACTURE, gabarit: "annonceCommerciale", entityType: "invoice" } as OrdreEnvoi,
    porteDouble(journal),
    envoyeurDouble([]),
    REGLAGES,
  );
  assert.equal(issue.etat, "refuse");
  assert.equal(journal.misEnFile.length, 0);
});

test("un gabarit de devis sur une facture est refusé", async () => {
  const journal = journalVide();
  const issue = await traiterOrdre(
    { ...ORDRE_FACTURE, gabarit: "devisEnvoye" },
    porteDouble(journal),
    envoyeurDouble([]),
    REGLAGES,
  );
  assert.equal(issue.etat, "refuse");
  assert.equal(journal.misEnFile.length, 0);
});

// ══════════════════════════════════════════════════════════════════
// LES VARIABLES, CALCULÉES
// ══════════════════════════════════════════════════════════════════

test("la relance porte son RANG, qui commande le ton du message", () => {
  const v1 = construireVariables("factureRelance", FAIT_FACTURE, "Marie Martin", 1);
  const v2 = construireVariables("factureRelance", FAIT_FACTURE, "Marie Martin", 2);
  assert.equal(v1.rang, 1);
  assert.equal(v2.rang, 2);
  // « rangRelance » — le nom qu'émettait la couche appelante — n'existe
  // pas dans le gabarit : `v.rang <= 1` valait alors `false`, et la
  // PREMIÈRE relance employait le ton d'une dernière mise en demeure.
  assert.equal(v1.rangRelance, undefined);
});

test("la relance de facture porte le RESTE DÛ, jamais le total", () => {
  const v = construireVariables(
    "factureRelance",
    { ...FAIT_FACTURE, totalTtcCentimes: 124050, resteDuCentimes: 40000 },
    "Marie Martin",
    1,
  );
  assert.equal(v.resteDuCentimes, 40000);
  assert.equal(v.totalTtcCentimes, undefined);
});

test("un montant inconnu reste inconnu : jamais zéro", () => {
  const v = construireVariables(
    "factureEmise",
    { ...FAIT_FACTURE, totalTtcCentimes: null },
    "Marie Martin",
    1,
  );
  assert.equal(v.totalTtcCentimes, null);
});

test("les jours de retard se calculent, ils ne s'attendent pas de la requête", () => {
  const maintenant = new Date("2026-10-20T09:00:00.000Z");
  assert.equal(joursDeRetard("2026-10-05", maintenant), 15);
  // Une échéance à venir n'est pas un retard négatif.
  assert.equal(joursDeRetard("2026-11-05", maintenant), 0);
  // Et une date absente ne produit pas « undefined jour ».
  assert.equal(joursDeRetard(null, maintenant), 0);
});

test("la relance affiche un nombre de jours, jamais « undefined »", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  await traiterOrdre(
    { ...ORDRE_FACTURE, gabarit: "factureRelance", occurrence: 2 },
    porteDouble(journal),
    envoyeurDouble(enveloppes),
    REGLAGES,
  );
  assert.ok(!enveloppes[0].texte.includes("undefined"), "aucun « undefined » dans le message");
  assert.ok(/Retard\s*:/.test(enveloppes[0].texte));
});

// ══════════════════════════════════════════════════════════════════
// L'ORDRE DES GESTES
// ══════════════════════════════════════════════════════════════════

test("sans transporteur, RIEN n'est mis en file — et l'on rend une phrase", async () => {
  const journal = journalVide();
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal),
    new EnvoyeurIndisponible("La clé n'est pas posée sur ce serveur."),
    REGLAGES,
  );
  assert.equal(issue.etat, "indisponible");
  assert.equal((issue as { raison: string }).raison, "La clé n'est pas posée sur ce serveur.");
  // Une ligne mise en file sans pouvoir partir occuperait la clé
  // d'idempotence : le vrai envoi, plus tard, serait refusé comme un
  // doublon.
  assert.equal(journal.misEnFile.length, 0);
});

test("le message est mis en file, RÉSERVÉ, puis transporté — dans cet ordre", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const ordre: string[] = [];
  const porte = porteDouble(journal, {
    async mettreEnFile(args) {
      ordre.push("file");
      journal.misEnFile.push(args);
      return { messageId: "msg-1", cree: true, raisonBloquante: null, avertissements: [] };
    },
    async reserverUn(id) {
      ordre.push("reservation");
      journal.reserves.push(id);
      return true;
    },
  });
  const envoyeur: EnvoyeurCourriel = {
    ...envoyeurDouble(enveloppes),
    async expedier(enveloppe) {
      ordre.push("transport");
      enveloppes.push(enveloppe);
      return { etat: "remis", identifiantTransporteur: "id-1" };
    },
  };

  await traiterOrdre(ORDRE_FACTURE, porte, envoyeur, REGLAGES);
  // Si l'on transportait d'abord, deux onglets ouverts sur la même
  // facture enverraient deux messages et n'en journaliseraient qu'un.
  // Si l'on ne réservait pas, un passage de file simultané prendrait la
  // ligne qu'on vient d'écrire et l'enverrait une seconde fois.
  assert.deepEqual(ordre, ["file", "reservation", "transport"]);
});

test("UNE RÉSERVATION PERDUE ARRÊTE LE TRANSPORT : quelqu'un d'autre l'a prise", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal, {}, { reservationAcquise: false }),
    envoyeurDouble(enveloppes),
    REGLAGES,
  );
  assert.equal(issue.etat, "deja");
  assert.equal(enveloppes.length, 0, "le transporteur n'est pas appelé une seconde fois");
});

test("un doublon ne repart pas : la contrainte d'unicité tranche, pas un « si déjà envoyé »", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const porte = porteDouble(journal, {
    async mettreEnFile() {
      return {
        messageId: "msg-existant",
        cree: false,
        raisonBloquante: "Ce message est déjà parti : il ne repart pas.",
        avertissements: [],
      };
    },
  });

  const issue = await traiterOrdre(ORDRE_FACTURE, porte, envoyeurDouble(enveloppes), REGLAGES);
  assert.equal(issue.etat, "deja");
  assert.equal(enveloppes.length, 0, "le transporteur n'est même pas appelé");
});

test("une identité incomplète refuse avec la phrase de la base, sans rien rendre", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const porte = porteDouble(journal, {}, {
    raisonBloquante:
      "Renseignez le SIRET de votre entreprise : une facture sans SIRET n'est pas conforme (art. 242 nonies A du CGI).",
  });

  const issue = await traiterOrdre(ORDRE_FACTURE, porte, envoyeurDouble(enveloppes), REGLAGES);
  assert.equal(issue.etat, "refuse");
  assert.match((issue as { raison: string }).raison, /SIRET/);
  assert.equal(journal.misEnFile.length, 0);
  assert.equal(enveloppes.length, 0);
});

test("un client sans adresse est refusé AVANT l'envoi, avec une phrase et non une exception", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const porte = porteDouble(journal, {
    async lireDestinataire() {
      return {
        email: null,
        nom: null,
        contactId: null,
        raisonBloquante:
          "Aucune adresse e-mail pour « Marie Martin ». Renseignez-la sur la fiche du client.",
      };
    },
  });

  const issue = await traiterOrdre(ORDRE_FACTURE, porte, envoyeurDouble(enveloppes), REGLAGES);
  assert.equal(issue.etat, "refuse");
  assert.match((issue as { raison: string }).raison, /Renseignez-la/);
});

test("la version du gabarit est recopiée dans le journal", async () => {
  const journal = journalVide();
  await traiterOrdre(ORDRE_FACTURE, porteDouble(journal), envoyeurDouble([]), REGLAGES);
  assert.equal(journal.misEnFile[0].version, "factureEmise@1");
  assert.match(journal.misEnFile[0].empreinteHtml, /^[0-9a-f]{64}$/);
});

// ══════════════════════════════════════════════════════════════════
// L'ÉCHEC TEMPORAIRE, L'ÉCHEC DÉFINITIF, ET LE SORT INCONNU
// ══════════════════════════════════════════════════════════════════

test("un refus DÉFINITIF est journalisé comme tel, avec sa raison en français", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal),
    envoyeurDouble(enveloppes, "refuse"),
    REGLAGES,
  );
  assert.equal(issue.etat, "refuse");
  assert.equal(journal.echecs.length, 1);
  assert.equal(journal.echecs[0].raison, "Adresse inexistante.");
  // Le code brut est gardé À CÔTÉ, pour nous ; la phrase est pour le
  // paysagiste, qui la lira dans son écran.
  assert.equal(journal.echecs[0].code, "hard_bounce");
  assert.equal(journal.echecs[0].temporaire, false);
});

test("UN PLAFOND JOURNALIER EST TEMPORAIRE : le message doit repartir tout seul", async () => {
  const journal = journalVide();
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal),
    envoyeurDouble([], "refuseTemporaire"),
    REGLAGES,
  );
  assert.equal(issue.etat, "refuse");
  // Sans ce drapeau, la ligne passait en échec DÉFINITIF et rien ne la
  // rejouait — alors que la phrase promettait au paysagiste qu'elle
  // repartirait. Un lundi matin de pointe, c'est toute la file du jour
  // qui était perdue.
  assert.equal(journal.echecs[0].temporaire, true);
});

test("UN SORT INCONNU N'EST NI UN ENVOI NI UN ÉCHEC", async () => {
  const journal = journalVide();
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal),
    envoyeurDouble([], "incertain"),
    REGLAGES,
  );
  assert.equal(issue.etat, "incertain");
  assert.equal(journal.envoyes.length, 0);
  assert.equal(journal.echecs.length, 0);
  assert.equal(journal.incertains.length, 1);
  assert.match(journal.incertains[0].raison, /réponse du transporteur|peut-être parti/i);
});

test("UN MARQUAGE RATÉ APRÈS L'ENVOI NE PASSE PAS POUR UN SUCCÈS", async () => {
  const journal = journalVide();
  // Le message est parti, et la base ne l'a pas enregistré. Sans cette
  // branche, la ligne restait « en attente » et le passage suivant la
  // réexpédiait — à chaque passage, indéfiniment. C'est le doublon
  // franc, celui qui ne demande aucune concurrence pour se produire.
  const issue = await traiterOrdre(
    ORDRE_FACTURE,
    porteDouble(journal, {}, { marquageReussi: false }),
    envoyeurDouble([]),
    REGLAGES,
  );
  assert.equal(issue.etat, "incertain");
  assert.equal(journal.incertains.length, 1);
});

test("l'indisponibilité en cours de route rend la réservation au lieu de la garder", async () => {
  const journal = journalVide();
  const envoyeur: EnvoyeurCourriel = {
    cle: "double",
    libelle: "Double",
    raisonIndisponibilite: null,
    async expedier() {
      return { etat: "indisponible", raison: "Le transporteur a disparu." };
    },
  };
  const issue = await traiterOrdre(ORDRE_FACTURE, porteDouble(journal), envoyeur, REGLAGES);
  assert.equal(issue.etat, "indisponible");
  // Sans cette remise en file, la ligne resterait « en cours d'envoi »
  // pour toujours : ni partie, ni échouée, ni rejouable.
  assert.equal(journal.echecs.length, 1);
  assert.equal(journal.echecs[0].temporaire, true);
});

// ══════════════════════════════════════════════════════════════════
// LA FILE — LES CAMPAGNES ÉCRITES DIRECTEMENT PAR LA BASE
// ══════════════════════════════════════════════════════════════════

function ligneCampagne(): MessageEnFile {
  return {
    id: "msg-camp-1",
    organizationId: ORG,
    gabarit: "annonceCommerciale",
    nature: "publicite",
    version: "campagne",
    destinataireEmail: "contact@jardins-dupont.example",
    destinataireNom: "Jardins Dupont",
    objet: "Une nouveauté dans Oasis Care",
    corpsTexte: "Le module de facturation évolue.",
    variables: { entreprise: "Jardins Dupont" },
    empreinteProvisoire: true,
  };
}

test("la file rend le corps rédigé par l'administrateur, avec son désabonnement", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];

  const bilan = await viderFile(
    porteDouble(journal, {}, { file: [ligneCampagne()] }),
    envoyeurDouble(enveloppes),
    REGLAGES,
  );

  assert.equal(bilan.traites, 1);
  assert.equal(bilan.envoyes, 1);
  assert.equal(enveloppes[0].nature, "publicite");
  assert.ok(enveloppes[0].html.includes("Le module de facturation évolue."));
  assert.ok(enveloppes[0].entetes["List-Unsubscribe"] !== undefined);
});

test("LE PIED D'UNE ANNONCE PORTE LES MENTIONS D'OASIS, pas celles du destinataire", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  await viderFile(
    porteDouble(journal, {}, { file: [ligneCampagne()] }),
    envoyeurDouble(enveloppes),
    REGLAGES,
  );
  // « Jardins Dupont » recevait une publicité d'Oasis Care portant SON
  // PROPRE SIRET en pied. Absurde, et un défaut d'identification de
  // l'expéditeur (art. L.34-5 CPCE).
  assert.ok(enveloppes[0].texte.includes("99988877700011"), "le SIRET d'Oasis");
  assert.ok(!enveloppes[0].texte.includes("12345678900011"), "jamais celui du destinataire");
});

test("L'EMPREINTE PROVISOIRE D'UNE CAMPAGNE EST REMPLACÉE PAR LA VRAIE", async () => {
  const journal = journalVide();
  await viderFile(
    porteDouble(journal, {}, { file: [ligneCampagne()] }),
    envoyeurDouble([]),
    REGLAGES,
  );
  assert.match(String(journal.envoyes[0].empreinte), /^[0-9a-f]{64}$/);
});

test("un transactionnel de la file ne refabrique PAS d'empreinte : la sienne est gelée", async () => {
  const journal = journalVide();
  await viderFile(
    porteDouble(journal, {}, {
      file: [{ ...ligneCampagne(), gabarit: "factureEmise", nature: "transactionnel",
               variables: { numero: "FA-1", nomClient: "Marie", totalTtcCentimes: 1000 },
               empreinteProvisoire: false }],
    }),
    envoyeurDouble([]),
    REGLAGES,
  );
  assert.equal(journal.envoyes[0].empreinte, null);
});

test("LA FILE RÉSERVE : deux passages successifs ne prennent pas la même ligne", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const porte = porteDouble(journal, {}, { file: [ligneCampagne()] });

  const premier = await viderFile(porte, envoyeurDouble(enveloppes), REGLAGES);
  const second = await viderFile(porte, envoyeurDouble(enveloppes), REGLAGES);

  assert.equal(premier.traites, 1);
  // Sans réservation en base, ce second passage relisait la même ligne
  // « en attente » et l'expédiait une seconde fois — sans que le journal
  // en garde trace, puisque le second marquage retombe sur la même
  // ligne.
  assert.equal(second.traites, 0);
  assert.equal(enveloppes.length, 1, "un seul appel au transporteur");
});

test("LA PORTE EST REJOUÉE AVANT D'EXPÉDIER, et un refus arrête le message", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const bilan = await viderFile(
    porteDouble(journal, {}, {
      file: [ligneCampagne()],
      verdict: {
        ok: false,
        raison: "Cette facture a été annulée depuis la préparation du message : il ne part pas.",
      },
    }),
    envoyeurDouble(enveloppes),
    REGLAGES,
  );
  assert.equal(bilan.arretes, 1);
  assert.equal(bilan.envoyes, 0);
  assert.equal(enveloppes.length, 0, "le transporteur n'est pas appelé");
  assert.equal(journal.echecs[0].code, "porte");
  assert.equal(journal.echecs[0].temporaire, false);
});

test("la porte est interrogée AVANT le rendu et avant tout appel sortant", async () => {
  const journal = journalVide();
  await viderFile(
    porteDouble(journal, {}, { file: [ligneCampagne()] }),
    envoyeurDouble([]),
    REGLAGES,
  );
  assert.deepEqual(journal.portesRejouees, ["msg-camp-1"]);
});

test("sans transporteur, la file ne touche à rien et le dit", async () => {
  const journal = journalVide();
  const bilan = await viderFile(
    porteDouble(journal, {}, { file: [] }),
    new EnvoyeurIndisponible("Pas de clé."),
    REGLAGES,
  );
  assert.equal(bilan.indisponible, "Pas de clé.");
  assert.equal(bilan.traites, 0);
});

// ══════════════════════════════════════════════════════════════════
// LE WEBHOOK
// ══════════════════════════════════════════════════════════════════

test("un lot d'événements est enregistré, et les inconnus sont comptés sans lever", async () => {
  const journal = journalVide();
  const bilan = await traiterNouvelles(
    [
      { event: "delivered", id: "id-1" },
      { event: "hardBounce", id: "id-2" },
      { pas: "un événement" },
    ],
    porteDouble(journal),
    envoyeurDouble([]),
  );
  assert.deepEqual(bilan, { lues: 2, ignorees: 1 });
  assert.equal(journal.evenements.length, 2);
});

test("un objet seul, hors tableau, est accepté aussi", async () => {
  const journal = journalVide();
  const bilan = await traiterNouvelles({ event: "delivered", id: "id-1" }, porteDouble(journal), envoyeurDouble([]));
  assert.deepEqual(bilan, { lues: 1, ignorees: 0 });
});

// Le devis, pour que le chemin « quote » soit couvert lui aussi.
test("un devis part avec son numéro, son montant et sa validité", async () => {
  const journal = journalVide();
  const enveloppes: EnveloppeCourriel[] = [];
  const issue = await traiterOrdre(
    { organizationId: ORG, gabarit: "devisEnvoye", entityType: "quote", entityId: DEVIS },
    porteDouble(journal),
    envoyeurDouble(enveloppes),
    REGLAGES,
  );
  assert.equal(issue.etat, "envoye");
  assert.ok(enveloppes[0].texte.includes("DV-2026-0007"));
  assert.ok(enveloppes[0].texte.includes("980,00"));
});
