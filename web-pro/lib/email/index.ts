import type { EnveloppeCourriel, IdentiteExpediteur, PieceJointe } from "./types.ts";
import type { MessageRendu } from "./gabarits/index.ts";

/**
 * §COURRIEL — LA SURFACE PUBLIQUE DU DOSSIER.
 *
 * ══════════════════════════════════════════════════════════════════
 * C'EST LE SEUL FICHIER QUE LA FONCTION EDGE IMPORTE
 * ══════════════════════════════════════════════════════════════════
 *
 * `supabase/functions/envoi-email/` est du Deno et ne partage pas de
 * `node_modules` avec `web-pro`. Elle tire pourtant ses gabarits et son
 * transporteur d'ici, par une seule ligne
 * (`envoi-email/bibliotheque.ts`), et c'est délibéré : les gabarits
 * doivent être rendus à deux endroits — au moment de l'envoi d'un devis,
 * et au moment où la file d'une campagne se vide. Deux jeux de gabarits,
 * ce serait un jour où l'un dit encore l'ancien montant.
 *
 * D'où la règle de tout `lib/email/**` : AUCUN import de `node:*`,
 * aucun composant React, aucun client Supabase. `fetch`, `crypto`,
 * `Intl`, `TextEncoder` — rien d'autre.
 */

export type {
  AudienceCourriel,
  CleGabarit,
  DeclencheurCourriel,
  EnveloppeCourriel,
  EvenementCourriel,
  IdentiteExpediteur,
  MentionsEntreprise,
  NatureCourriel,
  NouvelleDuTransporteur,
  PieceJointe,
  ResultatTransport,
} from "./types.ts";

export type { EnvoyeurCourriel } from "./envoyeur.ts";
export { EnvoyeurIndisponible, lireEnvironnement, obtenirEnvoyeurCourriel } from "./envoyeur.ts";

export {
  CLE_TRANSPORTEUR,
  NOM_SECRET_WEBHOOK,
  EnvoyeurBrevo,
  construireEnvoyeurBrevo,
  lireNouvelleTransporteur,
  refusTemporaire,
  traduireRefus,
  verifierDesabonnement,
} from "./brevo.ts";
export {
  CODE_SANS_IDENTIFIANT,
  ClientTransporteurHttp,
  ErreurTransporteur,
  composerCorps,
  configEstComplete,
  lireConfigTransporteur,
  normaliserIdentifiant,
} from "./brevo-api.ts";
export type { ApiTransporteur, ConfigTransporteur, LectureConfig } from "./brevo-api.ts";

export * from "./gabarits/index.ts";
export { empreinteSha256 } from "./empreinte.ts";
export {
  AucuneSourceDocument,
  nomDeFichier,
  type ResultatDocument,
  type SourceDocument,
  type TypeDocument,
} from "./document-joint.ts";

/**
 * DE QUOI ON A BESOIN, EN PLUS DU RENDU, POUR FABRIQUER UNE ENVELOPPE.
 *
 * TOUT VIENT DE LA BASE. `identite` est ce que rend
 * `email_sender_identity()` — le nom affiché lu sur l'organisation
 * vérifiée, l'adresse de réponse, le logo. `destinataire` est ce que
 * rend `email_recipient_for_customer()` — le contact principal s'il a
 * une adresse, sinon la fiche client, sinon un refus explicite.
 *
 * IL N'Y A PAS DE CHAMP « ADRESSE LIBRE », ET IL NE FAUT PAS EN
 * AJOUTER. Un formulaire qui accepterait une adresse arbitraire ferait
 * de ce serveur un relais de courrier indésirable, et le domaine —
 * celui qui porte AUSSI les messages d'authentification et les factures
 * d'abonnement d'Oasis — serait sur liste noire en une journée.
 */
export type Destinataire = { email: string; nom: string | null };

/**
 * Assembler l'enveloppe finale.
 *
 * `nettoyerEntete` s'applique aux valeurs qui deviendront des en-têtes.
 * Elles viennent de la base, mais « viennent de la base » ne veut pas
 * dire « sont sûres » : le nom d'une entreprise et celui d'un contact
 * sont de la donnée saisie, et un saut de ligne dans un en-tête permet
 * d'en injecter un second — c'est-à-dire un destinataire caché.
 */
export function composerEnveloppe(
  rendu: MessageRendu,
  identite: IdentiteExpediteur,
  destinataire: Destinataire,
  pieces: PieceJointe[] = [],
): EnveloppeCourriel {
  return {
    nature: rendu.nature,
    expediteur: {
      nom: nettoyerEntete(identite.nomAffiche),
      // L'ADRESSE TECHNIQUE, sur le domaine authentifié. Le transporteur
      // la relit de sa propre configuration : ce champ est là pour le
      // journal et pour les tests, jamais pour donner le choix.
      email: identite.adresseTechnique,
    },
    repondreA: { nom: nettoyerEntete(identite.nomAffiche), email: identite.repondreA },
    destinataire: {
      nom: destinataire.nom === null ? null : nettoyerEntete(destinataire.nom),
      email: destinataire.email,
    },
    objet: rendu.objet,
    texte: rendu.texte,
    html: rendu.html,
    pieces,
    entetes: rendu.entetes,
    // JAMAIS DE DONNÉE PERSONNELLE DANS UNE ÉTIQUETTE. Elles remontent
    // dans le tableau de bord du transporteur, qui est un tiers : la clé
    // du gabarit et la nature suffisent à retrouver un envoi, et ne
    // disent rien de personne.
    etiquettes: [rendu.cle, rendu.nature],
  };
}

/**
 * Ce qui ne doit jamais entrer dans un en-tête.
 *
 * Les retours à la ligne et les tabulations sont l'injection ; les
 * chevrons et les guillemets cassent l'analyse d'un en-tête d'adresse et
 * font parfois disparaître le nom affiché sans erreur.
 */
export function nettoyerEntete(valeur: string): string {
  return valeur.replace(/[\r\n\t"<>]+/g, " ").replace(/\s{2,}/g, " ").trim();
}
