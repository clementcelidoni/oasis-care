// Oasis Care — Les relances. LES PREUVES SUR L'ORCHESTRATION.
//
//     node --test --experimental-strip-types "supabase/functions/relances-planifiees/traitement.test.ts"
//
// AUCUN RÉSEAU, AUCUNE BASE. La file est un double qui enregistre ce
// qu'on lui demande ; l'expéditeur aussi. Un test qui exigerait l'un ou
// l'autre ne tournerait jamais en intégration — et le transporteur, lui,
// tombe pour de vrai.
//
// CE QUE CES TESTS DÉFENDENT VRAIMENT. La plupart vérifient une
// ABSENCE : qu'aucune ligne n'a été réservée, qu'aucune n'a été
// terminée, qu'aucun message n'est parti deux fois. Une file qui
// expédie trop ne se signale par aucune erreur — elle fonctionne
// parfaitement, et le client reçoit trois fois la même relance.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Issue, OrdreEnvoi } from "../envoi-email/traitement.ts";
import type { PorteFile, RelanceReservee } from "./file.ts";
import { viderFileRelances, type Expediteur } from "./traitement.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const DEVIS = "44444444-4444-4444-8444-444444444444";
const FACTURE = "33333333-3333-4333-8333-333333333333";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const MESSAGE = "55555555-5555-4555-8555-555555555555";

function relance(surcharge: Partial<RelanceReservee> = {}): RelanceReservee {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    organizationId: ORG,
    entityType: "quote",
    entityId: DEVIS,
    templateKey: "devisRelance",
    occurrence: 2,
    customerId: CLIENT,
    referenceOn: "2026-08-01",
    ...surcharge,
  };
}

type Trace = {
  reservations: number[];
  faites: { id: string; messageId: string | null }[];
  abandons: { id: string; motif: string }[];
  ordres: OrdreEnvoi[];
};

/**
 * La file double.
 *
 * `lignes` est une pile de LOTS : chaque appel à `reserver` en consomme
 * un. C'est ce qui permet d'éprouver la boucle sans inventer un état
 * partagé qui ne ressemblerait à rien de ce que fait la base.
 */
function fileDouble(
  lots: RelanceReservee[][],
  options: { reserverLeve?: string } = {},
): { porte: PorteFile; trace: Trace } {
  const trace: Trace = { reservations: [], faites: [], abandons: [], ordres: [] };
  const restants = [...lots];
  const porte: PorteFile = {
    async reserver(limite) {
      trace.reservations.push(limite);
      if (options.reserverLeve !== undefined) throw new Error(options.reserverLeve);
      return restants.shift() ?? [];
    },
    async marquerFaite(id, messageId) {
      trace.faites.push({ id, messageId });
      return true;
    },
    async marquerAbandonnee(id, motif) {
      trace.abandons.push({ id, motif });
      return true;
    },
  };
  return { porte, trace };
}

function expediteurDouble(
  issues: (Issue | Error)[],
  trace: Trace,
): Expediteur {
  const restantes = [...issues];
  return async (ordre) => {
    trace.ordres.push(ordre);
    const suivante = restantes.shift();
    if (suivante === undefined) throw new Error("Le test n'a pas prévu d'issue supplémentaire.");
    if (suivante instanceof Error) throw suivante;
    return suivante;
  };
}

// ------------------------------------------------------------------
// 1. LE TRANSPORTEUR ABSENT NE DOIT RIEN RÉSERVER
// ------------------------------------------------------------------

test("sans transporteur, aucune ligne n'est réservée", async () => {
  const { porte, trace } = fileDouble([[relance()]]);
  const bilan = await viderFileRelances(porte, expediteurDouble([], trace), {
    raisonIndisponibilite: "Aucun transporteur n'est configuré.",
  });

  // C'EST LE TEST LE PLUS IMPORTANT DU FICHIER. Une ligne réservée puis
  // laissée en plan n'est reprise par personne : `relances_a_expedier`
  // ne regarde que les lignes dont `claimed_at is null`.
  assert.equal(trace.reservations.length, 0);
  assert.equal(trace.faites.length, 0);
  assert.equal(trace.abandons.length, 0);
  assert.equal(bilan.traitees, 0);
  assert.equal(bilan.arret, "Aucun transporteur n'est configuré.");
});

// ------------------------------------------------------------------
// 2. LE CHEMIN NOMINAL
// ------------------------------------------------------------------

test("une relance de devis part et la ligne est terminée avec le message", async () => {
  const { porte, trace } = fileDouble([[relance()], []]);
  const bilan = await viderFileRelances(
    porte,
    expediteurDouble([{ etat: "envoye", messageId: MESSAGE, avertissements: [] }], trace),
  );

  assert.deepEqual(trace.ordres, [
    {
      organizationId: ORG,
      gabarit: "devisRelance",
      entityType: "quote",
      entityId: DEVIS,
      occurrence: 2,
    },
  ]);
  assert.deepEqual(trace.faites, [{ id: relance().id, messageId: MESSAGE }]);
  assert.equal(trace.abandons.length, 0);
  assert.equal(bilan.envoyees, 1);
  assert.equal(bilan.traitees, 1);
  assert.equal(bilan.arret, null);
});

test("une relance de facture part avec son propre gabarit", async () => {
  const ligne = relance({ entityType: "invoice", entityId: FACTURE, templateKey: "factureRelance", occurrence: 3 });
  const { porte, trace } = fileDouble([[ligne], []]);
  await viderFileRelances(
    porte,
    expediteurDouble([{ etat: "envoye", messageId: MESSAGE, avertissements: [] }], trace),
  );

  assert.equal(trace.ordres[0].gabarit, "factureRelance");
  assert.equal(trace.ordres[0].entityType, "invoice");
  assert.equal(trace.ordres[0].occurrence, 3);
});

// ------------------------------------------------------------------
// 3. ON RÉSERVE UNE LIGNE À LA FOIS
// ------------------------------------------------------------------

test("la réservation se fait ligne par ligne, jamais par lot", async () => {
  const a = relance({ id: "aaaaaaaa-0000-4000-8000-00000000000a" });
  const b = relance({ id: "aaaaaaaa-0000-4000-8000-00000000000b", entityId: FACTURE, entityType: "invoice", templateKey: "factureRelance" });
  const { porte, trace } = fileDouble([[a], [b], []]);

  await viderFileRelances(
    porte,
    expediteurDouble(
      [
        { etat: "envoye", messageId: MESSAGE, avertissements: [] },
        { etat: "envoye", messageId: MESSAGE, avertissements: [] },
      ],
      trace,
    ),
  );

  // Chaque réservation demande UNE ligne. Réserver cinquante lignes puis
  // mourir à la troisième perdrait quarante-sept relances en silence,
  // faute de fonction de libération en base.
  assert.deepEqual(trace.reservations, [1, 1, 1]);
  assert.equal(trace.faites.length, 2);
});

// ------------------------------------------------------------------
// 4. L'IDEMPOTENCE — « DÉJÀ » N'EST PAS UN ÉCHEC
// ------------------------------------------------------------------

test("un message déjà au journal termine la ligne sans repartir", async () => {
  const { porte, trace } = fileDouble([[relance()], []]);
  const bilan = await viderFileRelances(
    porte,
    expediteurDouble([{ etat: "deja", messageId: MESSAGE }], trace),
  );

  assert.equal(bilan.deja, 1);
  assert.equal(bilan.envoyees, 0);
  // La ligne est terminée, et elle pointe vers le message qui existait
  // déjà : c'est la contrainte d'unicité de 0084 qui a tranché.
  assert.deepEqual(trace.faites, [{ id: relance().id, messageId: MESSAGE }]);
  assert.equal(trace.abandons.length, 0);
});

// ------------------------------------------------------------------
// 5. « INCERTAIN » — NI PARTI NI PERDU
// ------------------------------------------------------------------

test("une issue incertaine termine la ligne en pointant vers le journal", async () => {
  const { porte, trace } = fileDouble([[relance()], []]);
  const bilan = await viderFileRelances(
    porte,
    expediteurDouble(
      [{ etat: "incertain", raison: "Le transporteur n'a rendu aucun identifiant.", messageId: MESSAGE }],
      trace,
    ),
  );

  assert.equal(bilan.incertaines, 1);
  // `done_at` ici ne dit pas « le client l'a reçu » : il dit « cette
  // ligne a atteint le journal d'envoi ». C'est `email_messages` qui
  // porte l'état exact, et c'est lui que le paysagiste consulte.
  assert.deepEqual(trace.faites, [{ id: relance().id, messageId: MESSAGE }]);
  assert.equal(trace.abandons.length, 0);
});

// ------------------------------------------------------------------
// 6. LE REFUS MOTIVÉ S'ÉCRIT DANS LA FILE
// ------------------------------------------------------------------

test("un refus est écrit avec sa raison, en français", async () => {
  const { porte, trace } = fileDouble([[relance()], []]);
  const bilan = await viderFileRelances(
    porte,
    expediteurDouble(
      [{ etat: "refuse", raison: "Cette adresse s'est désabonnée.", messageId: null }],
      trace,
    ),
  );

  assert.equal(bilan.abandonnees, 1);
  assert.deepEqual(trace.abandons, [
    { id: relance().id, motif: "Cette adresse s'est désabonnée." },
  ]);
  assert.equal(trace.faites.length, 0);
});

test("un motif trop long est tronqué comme la base le tronquera", async () => {
  const { porte, trace } = fileDouble([[relance()], []]);
  await viderFileRelances(
    porte,
    expediteurDouble([{ etat: "refuse", raison: "é".repeat(500), messageId: null }], trace),
  );

  assert.equal(trace.abandons[0].motif.length, 300);
});

// ------------------------------------------------------------------
// 7. LE TRANSPORTEUR QUI DISPARAÎT EN COURS DE PASSAGE
// ------------------------------------------------------------------

test("une indisponibilité en cours de passage n'abandonne aucune ligne", async () => {
  const { porte, trace } = fileDouble([[relance()], []]);
  const bilan = await viderFileRelances(
    porte,
    expediteurDouble([{ etat: "indisponible", raison: "Le transporteur n'est plus configuré." }], trace),
  );

  // ON NE FERME PAS UN RANG DE RELANCE À CAUSE D'UNE VARIABLE
  // D'ENVIRONNEMENT. L'index unique du dépôt empêche que ce rang soit
  // recalculé : l'abandonner ici le perdrait pour de bon.
  assert.equal(trace.abandons.length, 0);
  assert.equal(trace.faites.length, 0);
  assert.equal(bilan.arret, "Le transporteur n'est plus configuré.");
});

// ------------------------------------------------------------------
// 8. LA PANNE D'EXPÉDITION ARRÊTE LE PASSAGE SANS TERMINER LA LIGNE
// ------------------------------------------------------------------

test("une exception d'expédition ne termine pas la ligne et arrête le passage", async () => {
  const a = relance({ id: "aaaaaaaa-0000-4000-8000-00000000000a" });
  const b = relance({ id: "aaaaaaaa-0000-4000-8000-00000000000b" });
  const { porte, trace } = fileDouble([[a], [b], []]);

  const bilan = await viderFileRelances(
    porte,
    expediteurDouble([new Error("connexion refusée")], trace),
  );

  // Ni terminée, ni abandonnée : une panne de trente secondes ne doit
  // pas fermer définitivement une relance.
  assert.equal(trace.faites.length, 0);
  assert.equal(trace.abandons.length, 0);
  // Et la deuxième ligne n'a jamais été réservée : le passage s'arrête.
  assert.deepEqual(trace.reservations, [1]);
  assert.match(bilan.arret ?? "", /connexion refusée/);
  assert.match(bilan.arret ?? "", /reste réservée/);
  assert.match(bilan.arret ?? "", new RegExp(a.id));
});

test("une file illisible arrête le passage sans rien terminer", async () => {
  const { porte, trace } = fileDouble([[relance()]], { reserverLeve: "base injoignable" });
  const bilan = await viderFileRelances(porte, expediteurDouble([], trace));

  assert.equal(trace.faites.length, 0);
  assert.equal(trace.abandons.length, 0);
  assert.equal(trace.ordres.length, 0);
  // « Rien à faire » et « je n'ai pas pu regarder » ne se confondent pas.
  assert.match(bilan.arret ?? "", /base injoignable/);
});

// ------------------------------------------------------------------
// 9. LES GARDE-FOUS — CE QUI N'EST PAS UNE RELANCE NE PART PAS
// ------------------------------------------------------------------

test("un gabarit qui n'est pas une relance est refusé sans être envoyé", async () => {
  const { porte, trace } = fileDouble([[relance({ templateKey: "devisEnvoye" })], []]);
  const bilan = await viderFileRelances(porte, expediteurDouble([], trace));

  // Le danger précis : `devisEnvoye` au rang 2 ferait partir le PREMIER
  // envoi du devis sous le rang d'une relance.
  assert.equal(trace.ordres.length, 0);
  assert.equal(bilan.abandonnees, 1);
  assert.match(trace.abandons[0].motif, /n'est pas une relance/);
});

test("un gabarit qui ne correspond pas au document est refusé", async () => {
  const ligne = relance({ templateKey: "factureRelance", entityType: "quote" });
  const { porte, trace } = fileDouble([[ligne], []]);
  const bilan = await viderFileRelances(porte, expediteurDouble([], trace));

  assert.equal(trace.ordres.length, 0);
  assert.equal(bilan.abandonnees, 1);
  assert.match(trace.abandons[0].motif, /ne correspond pas au document/);
});

test("un rang de 1 est refusé : ce serait le premier envoi", async () => {
  const { porte, trace } = fileDouble([[relance({ occurrence: 1 })], []]);
  const bilan = await viderFileRelances(porte, expediteurDouble([], trace));

  assert.equal(trace.ordres.length, 0);
  assert.equal(bilan.abandonnees, 1);
  assert.match(trace.abandons[0].motif, /rang/);
});

// ------------------------------------------------------------------
// 10. LA FILE VIDE, ET LE PLAFOND
// ------------------------------------------------------------------

test("une file vide ne signale aucun arrêt", async () => {
  const { porte, trace } = fileDouble([[]]);
  const bilan = await viderFileRelances(porte, expediteurDouble([], trace));

  assert.equal(bilan.traitees, 0);
  assert.equal(bilan.arret, null);
});

test("le plafond du passage arrête la boucle et le dit", async () => {
  const lots = [
    [relance({ id: "aaaaaaaa-0000-4000-8000-00000000000a" })],
    [relance({ id: "aaaaaaaa-0000-4000-8000-00000000000b" })],
    [relance({ id: "aaaaaaaa-0000-4000-8000-00000000000c" })],
  ];
  const { porte, trace } = fileDouble(lots);
  const bilan = await viderFileRelances(
    porte,
    expediteurDouble(
      [
        { etat: "envoye", messageId: MESSAGE, avertissements: [] },
        { etat: "envoye", messageId: MESSAGE, avertissements: [] },
      ],
      trace,
    ),
    { plafond: 2 },
  );

  assert.equal(bilan.traitees, 2);
  assert.equal(trace.reservations.length, 2);
  assert.match(bilan.arret ?? "", /Plafond/);
});
