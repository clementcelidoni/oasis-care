/**
 * §COURRIEL — LE VOCABULAIRE, ET RIEN D'AUTRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE CONNAÎT AUCUN TRANSPORTEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * Le nom du prestataire n'apparaît nulle part ici, et c'est la règle du
 * chantier : « le code dit ENVOIE CE MESSAGE À CE DESTINATAIRE ; qui le
 * transporte est un réglage ». Un seul fichier du dépôt a le droit de
 * nommer le transporteur, et ce n'est pas celui-ci.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE MODULE NE DÉPEND DE RIEN — NI DE NEXT, NI DE NODE
 * ══════════════════════════════════════════════════════════════════
 *
 * Tout `web-pro/lib/email/**` est écrit pour tourner AUSSI BIEN dans le
 * serveur Next que dans la fonction Edge `envoi-email`, qui est du Deno.
 * Aucun `import` de `node:*`, aucun `process` en dur, aucun composant
 * React. Les seules choses employées — `fetch`, `crypto.subtle`, `Intl`,
 * `TextEncoder` — existent dans les deux runtimes.
 *
 * POURQUOI CETTE CONTRAINTE VAUT LA PEINE : les gabarits doivent être
 * rendus à DEUX endroits. Au moment de l'envoi d'un devis, côté
 * application ; et au moment où la file d'attente d'une campagne se
 * vide, côté machine. Deux jeux de gabarits, c'est un jour où le devis
 * dit « Bonjour {{clientt}} » d'un côté et pas de l'autre. Il n'y en a
 * donc qu'un, et il est portable.
 */

// ────────────────────────────────────────────────────────────────
// LES DEUX NATURES — LA DISTINCTION QUI COMMANDE TOUT
// ────────────────────────────────────────────────────────────────
//
// CE NE SONT PAS DEUX RÉGLAGES DU MÊME OBJET, ce sont deux régimes
// juridiques.
//
//   • 'transactionnel' — un devis, une facture, une relance, une
//     invitation. Le destinataire l'a demandé PAR SON ACTE. Il n'a pas
//     de lien de désabonnement, et il DOIT partir même si la personne
//     s'est désabonnée de la publicité.
//
//   • 'publicite' — une nouveauté, une offre. Consentement PRÉALABLE,
//     lien de désabonnement dans CHAQUE message, et le désabonnement
//     vaut pour tous les envois futurs, sans exception ni délai.
//
// LE DÉFAUT À NE JAMAIS COMMETTRE serait qu'un désabonnement de la
// publicité empêche une facture d'arriver. Il est invisible en test et
// catastrophique en production. La base l'interdit structurellement
// (0084 § 9) ; ce dossier ne lui offre aucun chemin de retour.
export type NatureCourriel = "transactionnel" | "publicite";

/** À qui un gabarit a le droit de s'adresser. Recopié de `email_templates.audience`. */
export type AudienceCourriel = "clientFinal" | "entreprise";

/**
 * Les huit gabarits du catalogue (migration 0084 § 1).
 *
 * Cette union est le miroir EXACT de la table `email_templates`. Elle
 * n'a pas de case pour un envoi décidé par un modèle, et cette absence
 * est le sujet : l'IA prépare des brouillons, un humain valide. Un envoi
 * déclenché par un CHANGEMENT D'ÉTAT — « la facture vient d'être
 * émise » — est légitime ; un envoi décidé par un MODÈLE n'a pas de nom
 * ici, donc pas de chemin.
 */
export type CleGabarit =
  | "devisEnvoye"
  | "devisRelance"
  | "factureEmise"
  | "factureRelance"
  | "invitationPortail"
  | "bienvenueEntreprise"
  | "parametreImportant"
  | "annonceCommerciale";

/** Ce qui déclenche un envoi. Miroir de `email_templates.trigger_kind`. */
export type DeclencheurCourriel = "humain" | "changementEtat" | "periodique";

// ────────────────────────────────────────────────────────────────
// L'IDENTITÉ DE L'EXPÉDITEUR — LE MOTIF CRM, EN TYPES
// ────────────────────────────────────────────────────────────────
//
// LE DIRIGEANT A TRANCHÉ : « toutes les informations du paysagiste
// apparaissent sur le mail, mais on garde cette adresse e-mail ». C'est
// le motif standard des CRM, et il est techniquement le bon.
//
//   • L'ADRESSE TECHNIQUE reste le domaine authentifié d'Oasis Care.
//     C'est elle qui porte SPF, DKIM et DMARC — c'est ce qui fait que le
//     courrier arrive. Un paysagiste n'aura jamais authentifié son
//     domaine, et le laisser essayer produirait un rejet massif.
//   • LE NOM AFFICHÉ est celui de son entreprise. L'alignement DMARC
//     porte sur le DOMAINE, pas sur le nom affiché : le montrer ne casse
//     rien.
//   • LE « RÉPONDRE À » POINTE LE PAYSAGISTE. C'est le champ qu'on
//     oublie, et son absence est catastrophique : sans lui, le client
//     répond « d'accord pour le devis » et la réponse tombe dans une
//     boîte d'Oasis que personne ne lit.
//
// AUCUN DE CES CHAMPS N'EST SAISI AU MOMENT DE L'ENVOI. Ils viennent
// tous de `email_sender_identity()`, qui les lit sur l'organisation
// vérifiée. Un nom d'expéditeur arbitraire depuis un domaine authentifié
// est un outil d'hameçonnage : on écrirait « Votre banque ».
export type IdentiteExpediteur = {
  /** Lu en base : `legal_name`, à défaut `name`. Jamais une zone de saisie. */
  nomAffiche: string;
  /** `business_organizations.email`. Le seul verrou dur du chantier. */
  repondreA: string;
  /** L'adresse technique sur le domaine authentifié. Vient de l'environnement. */
  adresseTechnique: string;
  /** URL publique du logo (bucket `organization-logos`), ou null. */
  urlLogo: string | null;
};

/**
 * LES MENTIONS LÉGALES DU PIED DE MESSAGE.
 *
 * Ce ne sont pas de la décoration : sur un devis et sur une facture,
 * elles ont une valeur légale. La sélection de champs est celle de la
 * vue `client_portal_companies` (migration 0056), qui sait déjà quoi
 * montrer d'une entreprise sans laisser fuiter `workspace_id` ni
 * `tax_configuration`.
 *
 * Tout est facultatif SAUF la raison sociale, parce qu'en base tout est
 * `nullable` sauf `name`. Le pied doit rester présentable avec des
 * trous : c'est l'état réel de la production aujourd'hui, où le SIRET,
 * le numéro de TVA et la décennale manquent sur la seule entreprise
 * existante.
 */
export type MentionsEntreprise = {
  raisonSociale: string;
  formeJuridique?: string | null;
  siret?: string | null;
  numeroTva?: string | null;
  villeRcs?: string | null;
  capitalCentimes?: number | null;
  adresse1?: string | null;
  adresse2?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  telephone?: string | null;
  courriel?: string | null;
  siteWeb?: string | null;
  numeroDecennale?: string | null;
  assureur?: string | null;
};

// ────────────────────────────────────────────────────────────────
// L'ENVELOPPE — CE QUE LE TRANSPORTEUR REÇOIT
// ────────────────────────────────────────────────────────────────

/**
 * Une pièce jointe, déjà encodée.
 *
 * `contenuBase64` et pas un flux : un document de ce produit pèse
 * quelques dizaines de kilooctets, et un flux compliquerait le double de
 * test sans rien apporter.
 */
export type PieceJointe = {
  /** Le nom que verra le client. « Facture FA-2026-0042.pdf », pas « doc.pdf ». */
  nom: string;
  typeMime: string;
  contenuBase64: string;
};

/**
 * L'ENVELOPPE COMPLÈTE. Elle est le seul objet que le transporteur voit.
 *
 * Remarquer ce qu'elle NE porte PAS : aucun identifiant d'organisation,
 * aucun identifiant de devis, aucune variable. Le transporteur n'a pas
 * besoin de savoir de quoi il s'agit, et ne doit pas pouvoir l'apprendre.
 */
export type EnveloppeCourriel = {
  nature: NatureCourriel;
  expediteur: { nom: string; email: string };
  repondreA: { nom: string; email: string };
  destinataire: { nom: string | null; email: string };
  objet: string;
  /** Toujours présent. Un message sans partie texte est classé indésirable plus souvent. */
  texte: string;
  html: string;
  pieces: PieceJointe[];
  /**
   * Les en-têtes de désabonnement, pour la publicité UNIQUEMENT.
   * `List-Unsubscribe` et `List-Unsubscribe-Post` sont ce que Gmail et
   * Yahoo exigent d'un envoi de masse depuis 2024 : sans eux, le bouton
   * « se désabonner » du client de messagerie devient « signaler comme
   * indésirable », et la plainte abîme le domaine de TOUT le parc.
   */
  entetes: Record<string, string>;
  /**
   * De quoi retrouver un message dans le tableau de bord du
   * transporteur. Jamais de donnée personnelle : la clé du gabarit et la
   * nature, rien d'autre.
   */
  etiquettes: string[];
};

// ────────────────────────────────────────────────────────────────
// LE RÉSULTAT D'UN TRANSPORT
// ────────────────────────────────────────────────────────────────
//
// TROIS CAS, ET LE TROISIÈME N'EST PAS UNE ERREUR. « Aucun transporteur
// n'est configuré » est l'état NORMAL d'un déploiement où la variable
// d'environnement n'a pas encore été posée : l'écran s'y adapte au lieu
// de mentir, exactement comme `unavailableReason` du côté paiement.
export type ResultatTransport =
  | { etat: "remis"; identifiantTransporteur: string }
  /**
   * Le transporteur a refusé. `raison` est en français : le paysagiste
   * la lira.
   *
   * `temporaire` EST LE CHAMP QUI MANQUAIT, et son absence coûtait une
   * journée de factures. Un 400 « adresse invalide » est DÉFINITIF : le
   * rejouer ne fera que le refaire. Un 429 « plafond du jour atteint »
   * ou un 5xx ne le sont pas — et le 429 est précisément ce qui arrive
   * un lundi matin, quand les relances se groupent et que le plafond
   * journalier du transporteur mord. La couche promettait au paysagiste
   * « il repartira une fois le plafond levé » et rien ne le repartait :
   * l'état « échoué » est terminal en base, la file ne lit que ce qui
   * attend, et aucun bouton du produit ne remettait une ligne en file.
   */
  | { etat: "refuse"; raison: string; code: string | null; temporaire: boolean }
  /**
   * ON NE SAIT PAS. C'est l'état le plus honnête des quatre, et il
   * n'existait pas.
   *
   * Quand la connexion casse APRÈS que le transporteur a accepté le
   * message, ou qu'il répond 2xx sans identifiant, le message est
   * peut-être parti. Écrire « il n'est pas parti » est une affirmation
   * sur un fait inconnu — et elle est fausse dans le cas le plus
   * fréquent : le client reçoit son document et l'écran du paysagiste
   * jure qu'il ne l'a pas reçu. On ne marque donc ni parti ni perdu :
   * on réclame un œil humain.
   */
  | { etat: "incertain"; raison: string }
  | { etat: "indisponible"; raison: string };

/**
 * Ce que le transporteur nous rapporte plus tard, normalisé.
 *
 * Les noms d'événements sont EXACTEMENT ceux de `email_events.event`
 * (0084 § 6.a). La traduction depuis le vocabulaire du transporteur se
 * fait dans son implémentation, et nulle part ailleurs — c'est la moitié
 * la plus facile à oublier de « qui transporte est un réglage ».
 */
export type EvenementCourriel =
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "softBounce"
  | "hardBounce"
  | "complaint"
  | "blocked"
  | "unsubscribed"
  | "deferred"
  | "error";

export type NouvelleDuTransporteur = {
  /** L'identifiant rendu au moment de l'envoi. C'est lui qui rattache. */
  identifiantTransporteur: string;
  evenement: EvenementCourriel;
  /** ISO 8601. */
  instant: string;
  raison: string | null;
  /** La charge brute, conservée telle quelle pour l'enquête. */
  charge: Record<string, unknown>;
};
