import type { Tone } from "@/components/ui";

/**
 * ==================================================================
 * LES MOTS DE CET ÉCRAN — en français, pour un exploitant
 * ==================================================================
 *
 * Rassemblés ici parce que six écrans qui traduiraient « bounced » de
 * six façons différentes feraient croire à six états différents.
 *
 * AUCUN TON N'EST DÉCORATIF. `critical` est réservé à ce qui abîme la
 * réputation d'un domaine partagé par tout le parc ; `unknown` à ce
 * qu'on ne sait pas encore. Un rebond en gris et une plainte en rouge,
 * ce n'est pas une nuance de goût : la plainte est ce qui fait tomber
 * la délivrabilité de tout le monde, le rebond ne coûte qu'un message.
 */

// ------------------------------------------------------------------
// LA NATURE — la distinction qui commande tout le chantier
// ------------------------------------------------------------------

export type Nature = "transactionnel" | "publicite";

export const LIBELLES_NATURE: Record<Nature, string> = {
  transactionnel: "Transactionnel",
  publicite: "Publicité",
};

export const TONS_NATURE: Record<Nature, Tone> = {
  // Le transactionnel est le régime ORDINAIRE : un devis, une facture.
  // Il ne mérite aucune couleur d'alerte — l'accentuer ferait croire
  // qu'il demande une précaution qu'il ne demande pas.
  transactionnel: "info",
  // La publicité, elle, engage un régime juridique : consentement
  // préalable, désabonnement dans chaque message. La couleur le
  // rappelle à chaque endroit où le mot apparaît.
  publicite: "warning",
};

/**
 * La phrase qui explique la nature, affichée là où un administrateur
 * pressé pourrait se tromper.
 *
 * ELLE EST LONGUE À DESSEIN. Confondre les deux natures est LE défaut
 * de ce chantier : un désabonnement qui empêcherait une facture
 * d'arriver est invisible en test et catastrophique en production. Un
 * libellé de trois mots n'empêche personne de se tromper ; une phrase
 * qui dit ce que le destinataire a le droit d'attendre, si.
 */
export const EXPLICATIONS_NATURE: Record<Nature, string> = {
  transactionnel:
    "Le destinataire l'a appelé par son propre acte : il a demandé un devis, il a reçu une facture, il a été invité. " +
    "Ce message N'A PAS de lien de désabonnement, et il DOIT partir même si la personne s'est désabonnée de la publicité. " +
    "Oasis Admin n'en expédie aucun : ils partent depuis Oasis Care Pro, déclenchés par un geste du paysagiste ou par un changement d'état.",
  publicite:
    "Une nouveauté, une offre. Elle exige un consentement PRÉALABLE enregistré, elle porte un lien de désabonnement dans CHAQUE message, " +
    "et le désabonnement vaut pour tous les envois futurs, sans délai ni exception. " +
    "Elle ne s'adresse QU'AUX entreprises clientes d'Oasis Care — jamais à leurs clients, qui n'ont rien signé avec nous.",
};

export function estNature(valeur: string): valeur is Nature {
  return valeur === "transactionnel" || valeur === "publicite";
}

export function libelleNature(valeur: string): string {
  return estNature(valeur) ? LIBELLES_NATURE[valeur] : valeur;
}

export function tonNature(valeur: string): Tone {
  return estNature(valeur) ? TONS_NATURE[valeur] : "neutral";
}

// ------------------------------------------------------------------
// L'ÉTAT D'UNE CAMPAGNE
// ------------------------------------------------------------------

export const LIBELLES_STATUT_CAMPAGNE: Record<string, string> = {
  draft: "Brouillon",
  // 'sending' ne devrait jamais rester affiché : `admin_send_email_campaign`
  // le pose et le remplace dans la même transaction. Le voir signifie que
  // la fonction s'est interrompue au milieu — une information, pas un
  // état normal, et l'écran ne doit pas le présenter comme tel.
  sending: "Envoi interrompu",
  sent: "Envoyée",
  cancelled: "Annulée",
};

export const TONS_STATUT_CAMPAGNE: Record<string, Tone> = {
  draft: "neutral",
  sending: "critical",
  sent: "positive",
  cancelled: "neutral",
};

// ------------------------------------------------------------------
// L'ÉTAT D'UN MESSAGE
// ------------------------------------------------------------------

export const LIBELLES_STATUT_MESSAGE: Record<string, string> = {
  queued: "En file",
  sent: "Remis au transporteur",
  deferred: "Différé",
  delivered: "Distribué",
  bounced: "Rebond",
  complained: "Signalé comme indésirable",
  blocked: "Bloqué par le transporteur",
  failed: "Échec",
  cancelled: "Annulé",
};

export const TONS_STATUT_MESSAGE: Record<string, Tone> = {
  queued: "neutral",
  sent: "info",
  deferred: "warning",
  delivered: "positive",
  bounced: "warning",
  // La plainte est la seule qui abîme la réputation du DOMAINE, donc
  // celle de tout le parc, factures d'abonnement comprises.
  complained: "critical",
  blocked: "critical",
  failed: "critical",
  cancelled: "neutral",
};

/**
 * « Remis au transporteur » et « Distribué » ne sont pas la même chose,
 * et les confondre est le mensonge le plus facile de cet écran.
 *
 * `sent` veut dire que le transporteur a pris le message. `delivered`
 * veut dire que le serveur du destinataire l'a accepté — et cette
 * seconde information n'arrive QUE par le retour du transporteur. Tant
 * que ce retour n'est pas branché, un message reste à `sent` pour
 * toujours, et compter les `sent` comme des « reçus » ferait afficher
 * un taux de distribution de 100 % à un produit qui ne mesure rien.
 */
export function estDistributionConnue(statut: string): boolean {
  return statut !== "queued" && statut !== "sent";
}

// ------------------------------------------------------------------
// LA LISTE DE SUPPRESSION
// ------------------------------------------------------------------

export const LIBELLES_SUPPRESSION: Record<string, string> = {
  rebondDur: "Rebond dur — la boîte n'existe pas",
  plainte: "Plainte — la personne a cliqué « indésirable »",
  desabonnement: "Désabonnement",
  bloqueTransporteur: "Bloquée par le transporteur",
  manuel: "Inscrite à la main",
};

export const TONS_SUPPRESSION: Record<string, Tone> = {
  rebondDur: "warning",
  plainte: "critical",
  desabonnement: "neutral",
  bloqueTransporteur: "critical",
  manuel: "info",
};

/**
 * Ce qu'une levée signifie vraiment, par type.
 *
 * `desabonnement` se lève tout seul quand la personne redonne son
 * consentement (0084 § 11, `email_record_consent`). Les autres non, et
 * c'est délibéré : un rebond dur et une plainte sont des FAITS sur
 * l'acheminement, pas des souhaits. Les lever à la main est un geste
 * qui engage la réputation du domaine pour tout le parc — d'où le motif
 * obligatoire.
 */
export const CONSEQUENCES_LEVEE: Record<string, string> = {
  rebondDur:
    "La boîte n'existait pas au dernier essai. La lever ne la fait pas exister : ne le faites que si l'adresse a été corrigée depuis.",
  plainte:
    "Cette personne a signalé un message comme indésirable. La solliciter à nouveau est ce qui fait tomber la délivrabilité du domaine pour TOUT le parc, factures d'abonnement d'Oasis comprises.",
  desabonnement:
    "Un désabonnement se lève tout seul le jour où l'entreprise redonne son consentement depuis ses propres réglages. Le lever ici à sa place revient à la réabonner sans qu'elle l'ait demandé.",
  bloqueTransporteur:
    "C'est le transporteur qui refuse cette adresse, pour ses propres raisons. La lever de notre côté ne lève pas la sienne : le message repartira et sera refusé à nouveau.",
  manuel: "Quelqu'un l'a inscrite à la main. Le motif d'origine dit pourquoi.",
};

// ------------------------------------------------------------------
// LE NIVEAU D'ALERTE DE RÉPUTATION
// ------------------------------------------------------------------

export const LIBELLES_ALERTE: Record<string, string> = {
  insuffisant: "Trop peu de messages pour conclure",
  ok: "Rien à signaler",
  surveillance: "À surveiller",
  critique: "Critique",
};

export const TONS_ALERTE: Record<string, Tone> = {
  // « insuffisant » n'est pas « bon ». C'est « on ne sait pas », et le
  // ton de l'inconnu est le seul qui ne mente pas : sous vingt messages,
  // un seul rebond afficherait 100 %.
  insuffisant: "unknown",
  ok: "positive",
  surveillance: "warning",
  critique: "critical",
};

// ------------------------------------------------------------------
// LE DÉCLENCHEUR D'UN GABARIT
// ------------------------------------------------------------------

/**
 * LA FRONTIÈRE QUE CE CHANTIER DOIT RENDRE VISIBLE.
 *
 * Le catalogue de 0084 n'a pas de valeur 'ia' : un envoi décidé par un
 * MODÈLE ne peut pas être déclaré, donc ne peut pas exister. Un envoi
 * déclenché par un CHANGEMENT D'ÉTAT — « la facture vient d'être
 * émise » — est légitime et c'est ce que le produit demande. Les deux
 * se ressemblent de loin ; l'énumération les sépare.
 */
export const LIBELLES_DECLENCHEUR: Record<string, string> = {
  humain: "Un humain clique",
  changementEtat: "Un fait daté vient d'être posé",
  periodique: "Une échéance — aucun ordonnanceur n'existe encore",
};

export const TONS_DECLENCHEUR: Record<string, Tone> = {
  humain: "info",
  changementEtat: "neutral",
  // La relance est déclarée au catalogue mais ne peut pas partir :
  // `pg_cron` et `pg_net` sont absents du projet. Le ton de l'inconnu
  // dit « pas encore », là où un ton neutre laisserait croire que ça
  // marche.
  periodique: "unknown",
};

// ------------------------------------------------------------------
// L'AUDIENCE — pourquoi une entreprise est écartée
// ------------------------------------------------------------------

/**
 * Les motifs d'exclusion, regroupés pour l'écran.
 *
 * LES PHRASES DE LA BASE SONT AFFICHÉES TELLES QUELLES à côté : elles
 * sont écrites en français et disent exactement ce qui bloque. Ces
 * catégories ne servent qu'à COMPTER — « 12 sans consentement, 3
 * désabonnées » — parce qu'une liste de cent phrases identiques
 * n'apprend rien alors qu'un total, si.
 */
export type MotifExclusion =
  | "sansAdresse"
  | "sansConsentement"
  | "desabonnee"
  | "suppression"
  | "suspendue"
  | "dejaEnvoye"
  | "archivee"
  | "autre";

export const LIBELLES_EXCLUSION: Record<MotifExclusion, string> = {
  sansAdresse: "Aucune adresse e-mail enregistrée",
  sansConsentement: "Aucun consentement préalable",
  desabonnee: "Désabonnée",
  suppression: "Adresse sur la liste de suppression",
  suspendue: "Expédition suspendue",
  dejaEnvoye: "A déjà reçu cette campagne",
  archivee: "Entreprise archivée",
  autre: "Autre motif",
};

export const TONS_EXCLUSION: Record<MotifExclusion, Tone> = {
  sansAdresse: "unknown",
  sansConsentement: "warning",
  desabonnee: "neutral",
  suppression: "critical",
  suspendue: "critical",
  dejaEnvoye: "neutral",
  archivee: "neutral",
  autre: "unknown",
};

/**
 * Range une phrase de refus de la base dans une catégorie.
 *
 * ON CLASSE SUR LE TEXTE, ET IL FAUT SAVOIR POURQUOI C'EST ACCEPTABLE
 * ICI : `email_gate()` ne rend pas de code, seulement une phrase. La
 * classification ne sert QU'À COMPTER ; la phrase exacte est toujours
 * affichée à côté, et une phrase mal rangée tombe dans « autre » sans
 * rien cacher. Aucune décision d'envoi ne dépend de cette fonction —
 * c'est la base qui décide, ici on résume.
 */
export function classerRefus(phrase: string | null): MotifExclusion {
  if (phrase === null) return "autre";
  const p = phrase.toLowerCase();
  if (p.includes("adresse e-mail de votre entreprise")) return "sansAdresse";
  if (p.includes("aucun consentement")) return "sansConsentement";
  if (p.includes("désabonnée")) return "desabonnee";
  if (p.includes("liste de suppression")) return "suppression";
  if (p.includes("suspendue")) return "suspendue";
  if (p.includes("déjà parti")) return "dejaEnvoye";
  return "autre";
}
