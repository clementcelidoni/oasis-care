// Oasis Care — Chantier courriel. LA PORTE VERS LA BASE.
//
// ==================================================================
// UNE INTERFACE, PARCE QUE C'EST ELLE QUI REND LES TESTS JOUABLES
// ==================================================================
//
// `traitement.ts` — l'orchestration, c'est-à-dire la partie où l'on se
// trompe — ne connaît que cette interface. Les tests lui donnent un
// double qui enregistre ce qu'on lui demande ; aucun test de ce
// chantier n'a besoin ni du réseau ni d'une base.
//
// ==================================================================
// CE QUE CETTE PORTE NE PROPOSE PAS, ET C'EST LE SUJET
// ==================================================================
//
// Il n'y a AUCUNE méthode pour écrire une adresse de destinataire, un
// nom d'expéditeur ou une nature de message. Ces trois-là sont lus ou
// déduits en base par `email_enqueue`, et cette fonction refuse de les
// recevoir en paramètre :
//
//   • une adresse en paramètre ferait de ce serveur un relais de
//     courrier indésirable ;
//   • un nom d'expéditeur en paramètre, depuis un domaine authentifié,
//     serait un outil d'hameçonnage — on écrirait « Votre banque » ;
//   • une nature en paramètre permettrait d'expédier une publicité
//     déguisée en facture, donc sans consentement ni désabonnement.
//
// IL N'Y A PAS NON PLUS DE MÉTHODE POUR ÉCRIRE LE TEXTE DU MESSAGE, et
// c'est la correction la plus importante de ce fichier. La machine
// RELIT le devis ou la facture (`lireFait`) et FABRIQUE les variables
// elle-même. Auparavant elles arrivaient dans le corps de la requête :
// un compte inscrit pouvait donc faire expédier, depuis le domaine
// authentifié d'Oasis, un message au texte de son choix et au bouton de
// son choix — la seule chose qu'il ne choisissait pas était justement
// l'adresse qui porte l'authentification.
//
// Les fonctions d'écriture sont réservées à `service_role` par la
// migration 0084 § 15.c. C'est pourquoi cette fonction Edge existe : le
// site web n'a pas cette clé, et ne doit pas l'avoir.

import type {
  CleGabarit,
  EvenementCourriel,
  MentionsEntreprise,
  NatureCourriel,
} from "./bibliotheque.ts";

/** Ce que rend `email_sender_identity(organisation, gabarit)`. */
export type IdentiteLue = {
  nomAffiche: string | null;
  repondreA: string | null;
  cheminLogo: string | null;
  /** Non nul quand l'entreprise ne peut pas encore expédier. Une phrase, pas un code. */
  raisonBloquante: string | null;
  avertissements: string[];
};

/** Ce que rend `email_recipient_for_customer(organisation, client)`. */
export type DestinataireLu = {
  email: string | null;
  nom: string | null;
  contactId: string | null;
  raisonBloquante: string | null;
};

/** Ce que rend `email_enqueue(...)`. */
export type MiseEnFile = {
  messageId: string | null;
  /** Faux quand le message existait déjà : la contrainte d'unicité a tranché. */
  cree: boolean;
  raisonBloquante: string | null;
  avertissements: string[];
};

/**
 * LE FAIT MÉTIER, RELU EN BASE SOUS LE JETON DE L'APPELANT.
 *
 * C'est la source des variables du message. Rien de ce qui s'imprime
 * dans un devis ou une facture ne vient plus de la requête HTTP.
 *
 * Les montants restent en CENTIMES ENTIERS et gardent `null` quand ils
 * n'ont pas pu être lus : un `?? 0` transformerait « on ne sait pas »
 * en « zéro euro », et le client recevrait un devis à 0,00 € — une
 * erreur silencieuse qui a l'air d'un montant.
 */
export type FaitObjet = {
  organizationId: string;
  customerId: string | null;
  numero: string | null;
  titre: string | null;
  /** Le fait daté : `sent_at` pour un devis, `issued_at` pour une facture. */
  dateFait: string | null;
  /** `valid_until` d'un devis, `due_on` d'une facture. */
  dateLimite: string | null;
  decideLe: string | null;
  statut: string;
  archiveLe: string | null;
  totalTtcCentimes: number | null;
  resteDuCentimes: number | null;
};

/** Une ligne de `email_messages` réservée pour transport. */
export type MessageEnFile = {
  id: string;
  organizationId: string;
  gabarit: CleGabarit;
  nature: NatureCourriel;
  version: string;
  destinataireEmail: string;
  destinataireNom: string | null;
  objet: string;
  corpsTexte: string;
  variables: Record<string, unknown>;
  /**
   * L'empreinte enregistrée est-elle un SUBSTITUT ? Vrai pour une
   * campagne, dont la ligne est écrite avant que le HTML n'existe. La
   * vraie est posée au moment du marquage.
   */
  empreinteProvisoire: boolean;
};

export type ArgumentsMiseEnFile = {
  organizationId: string;
  gabarit: CleGabarit;
  entityType: "quote" | "invoice" | "clientInvitation" | "organization";
  entityId: string;
  version: string;
  objet: string;
  corpsTexte: string;
  empreinteHtml: string;
  customerId: string | null;
  variables: Record<string, unknown>;
  occurrence: number;
  campaignId: string | null;
};

/** Ce que rend `email_still_sendable(message)`. */
export type VerdictPorte = { ok: boolean; raison: string | null };

export interface PorteBase {
  lireIdentite(organizationId: string, gabarit: CleGabarit): Promise<IdentiteLue>;

  /**
   * Les mentions du pied de message.
   *
   * MÊME SÉLECTION DE COLONNES QUE LA VUE `client_portal_companies`
   * (0056), qui sait déjà quoi montrer d'une entreprise sans laisser
   * fuiter `workspace_id` ni `tax_configuration`. Recopier sa sélection
   * plutôt que d'en inventer une évite de publier un jour, dans un
   * message qui part chez un client, une colonne ajoutée entre-temps.
   *
   * `natureOasis` bascule sur les mentions d'OASIS CARE : une annonce
   * commerciale est un message d'Oasis, et son pied portait jusqu'ici
   * le SIRET de l'entreprise qui la RECEVAIT.
   */
  lireMentions(organizationId: string, natureOasis?: boolean): Promise<MentionsEntreprise | null>;

  lireDestinataire(organizationId: string, customerId: string): Promise<DestinataireLu>;

  /**
   * Le devis ou la facture, relu en base sous le jeton de l'appelant.
   * Rend `null` quand l'objet n'existe pas, ou que la RLS le cache.
   */
  lireFait(
    entityType: "quote" | "invoice",
    entityId: string,
  ): Promise<FaitObjet | null>;

  /**
   * Le jeton de désabonnement d'une adresse, pour la publicité.
   *
   * Il vient de `email_consents.unsubscribe_token` — une table que
   * PERSONNE ne peut lire (0084 § 15 : aucune politique de lecture, elle
   * porte les jetons). Seul `service_role` y accède, donc seulement
   * ici. Rend `null` quand aucun consentement n'existe : le rendu refuse
   * alors, ce qui est le bon comportement puisque `email_gate` aurait de
   * toute façon refusé l'envoi.
   */
  lireJetonDesabonnement(organizationId: string, email: string): Promise<string | null>;

  /** L'URL publique du logo (bucket `organization-logos`), ou null. */
  urlPubliqueLogo(cheminLogo: string | null): string | null;

  mettreEnFile(args: ArgumentsMiseEnFile): Promise<MiseEnFile>;

  /**
   * RÉSERVER UN MESSAGE PRÉCIS AVANT DE L'EXPÉDIER.
   *
   * Rend VRAI si la réservation est acquise, FAUX si quelqu'un d'autre
   * l'a déjà prise. Sans elle, un passage de file simultané prendrait
   * la ligne qu'on vient d'enfiler et l'enverrait une seconde fois.
   */
  reserverUn(messageId: string): Promise<boolean>;

  /**
   * RÉSERVER UN LOT, ET LE RENDRE.
   *
   * C'est un `update … for update skip locked` en base, jamais un
   * `select` suivi d'un `update` : deux passages simultanés ne prennent
   * pas la même ligne. La contrainte d'unicité sur la clé
   * d'idempotence, elle, ne garde que l'insertion et ne protège pas ce
   * chemin — la file n'insère rien, elle relit.
   */
  reserverFile(limite: number): Promise<MessageEnFile[]>;

  /**
   * LA PORTE, REJOUÉE AU MOMENT D'EXPÉDIER.
   *
   * Une ligne peut attendre longtemps en file. Entre sa préparation et
   * son transport, la facture a pu être annulée, l'entreprise
   * suspendue, l'adresse s'être plainte. C'est la MÊME fonction
   * (`email_gate`) qui juge, jamais un second jeu de règles.
   */
  verifierEncoreExpediable(messageId: string): Promise<VerdictPorte>;

  /**
   * ELLES RENDENT UN BOOLÉEN, ET L'APPELANT DOIT LE LIRE.
   *
   * Un marquage raté APRÈS que le message est parti laisse la ligne en
   * file : au passage suivant, elle repart. C'est le doublon franc,
   * celui qui ne demande aucune concurrence pour se produire — il
   * suffit d'un délai de requête dépassé.
   */
  marquerEnvoye(
    messageId: string,
    cleTransporteur: string,
    identifiantTransporteur: string,
    empreinteHtml?: string | null,
  ): Promise<boolean>;

  marquerEchec(
    messageId: string,
    raison: string,
    code: string | null,
    cleTransporteur: string | null,
    temporaire: boolean,
  ): Promise<boolean>;

  /**
   * NI PARTI NI PERDU. Pour le rejet de connexion et le 2xx sans
   * identifiant : le message est peut-être arrivé, et l'affirmer dans
   * un sens ou dans l'autre serait mentir dans le journal que le
   * paysagiste consulte quand son client dit n'avoir rien reçu.
   */
  marquerSortInconnu(
    messageId: string,
    raison: string,
    cleTransporteur: string | null,
  ): Promise<boolean>;

  enregistrerEvenement(
    cleTransporteur: string,
    identifiantTransporteur: string,
    evenement: EvenementCourriel,
    instant: string,
    raison: string | null,
    charge: Record<string, unknown>,
  ): Promise<void>;
}
