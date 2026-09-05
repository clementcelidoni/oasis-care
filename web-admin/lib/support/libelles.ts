import type { Tone } from "@/components/ui";

import type {
  CanalTicket,
  NiveauAcces,
  PrioriteTicket,
  ProduitTicket,
  SessionAssistance,
  StatutTicket,
} from "./types.ts";

/**
 * ==================================================================
 * LE VOCABULAIRE DE L'ASSISTANCE — et une décision par couleur
 * ==================================================================
 *
 * Aucune base, aucun Next : ce fichier est éprouvable seul, et il l'est
 * (`libelles.test.ts`). Ce qu'il porte n'est pas de la cosmétique. Deux
 * des fonctions ci-dessous décident si un accès aux données d'un client
 * est présenté comme OUVERT ou comme TERMINÉ, et se tromper d'un sens
 * ferait afficher « session active » sur une session expirée.
 *
 * ATTENTION, ET C'EST LA PHRASE LA PLUS IMPORTANTE DU MODULE :
 * `etatSession()` N'EST PAS UNE SÉCURITÉ. Elle décrit ce qu'on affiche.
 * Ce qui REFUSE, c'est `support_session_record_access()` en SQL, qui
 * revérifie propriété, révocation, expiration, consentement et
 * appartenance de la ressource à CHAQUE accès. Un calcul d'expiration
 * dans le navigateur — ou même ici, côté serveur, au moment du rendu —
 * ne protège de rien : il suffirait de ne pas rafraîchir la page.
 */

// ------------------------------------------------------------------
// Les demandes
// ------------------------------------------------------------------

export const LIBELLES_STATUT: Record<StatutTicket, string> = {
  open: "Ouverte",
  pending: "En attente du client",
  resolved: "Résolue",
  closed: "Close",
};

/**
 * Le ton suit ce qui DEMANDE UNE ACTION DE NOTRE PART, pas la gravité.
 *
 * « En attente du client » est neutre : la balle n'est pas dans notre
 * camp, et la peindre en orange dans une liste de quarante lignes
 * noierait les demandes qui, elles, attendent une réponse.
 */
export const TONS_STATUT: Record<StatutTicket, Tone> = {
  open: "warning",
  pending: "neutral",
  resolved: "positive",
  closed: "neutral",
};

export const LIBELLES_PRIORITE: Record<PrioriteTicket, string> = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente",
};

export const TONS_PRIORITE: Record<PrioriteTicket, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "critical",
};

/**
 * Le rang d'une priorité, pour trier.
 *
 * Plus le nombre est GRAND, plus la demande passe devant. Écrit ici et
 * pas dans un `order by` de PostgREST : la colonne est un `text`, et un
 * tri alphabétique mettrait « urgent » en dernier — après « normal » et
 * « low » — ce qui est exactement l'inverse de ce qu'on veut.
 */
export const RANG_PRIORITE: Record<PrioriteTicket, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};

export const LIBELLES_PRODUIT: Record<ProduitTicket, string> = {
  mobile: "Oasis Care Mobile",
  pro: "Oasis Care Pro",
  controlCenter: "Control Center",
  unknown: "Non précisé",
};

export const LIBELLES_CANAL: Record<CanalTicket, string> = {
  inApp: "Depuis l'application",
  email: "Courriel",
  admin: "Saisie par l'équipe",
};

/** Un libellé qui ne ment pas quand la base a gagné une valeur de plus. */
export function libelle<Cle extends string>(
  table: Record<Cle, string>,
  valeur: string,
): string {
  return (table as Record<string, string | undefined>)[valeur] ?? valeur;
}

export function tonDe<Cle extends string>(
  table: Record<Cle, Tone>,
  valeur: string,
): Tone {
  return (table as Record<string, Tone | undefined>)[valeur] ?? "neutral";
}

// ------------------------------------------------------------------
// Les sessions d'assistance
// ------------------------------------------------------------------

/**
 * Les quatre états d'une session, dans l'ordre où ils s'imposent.
 *
 * L'ORDRE EST LA LOGIQUE, et il n'est pas interchangeable :
 *
 *   1. RÉVOQUÉE l'emporte sur tout. Une session coupée à 14 h 02 qui
 *      devait expirer à 14 h 30 est révoquée, pas active — et l'écran
 *      doit dire pourquoi elle a été coupée.
 *   2. EXPIRÉE ensuite. C'est le cas normal de fin.
 *   3. CONSENTEMENT ATTENDU : la session court, mais elle n'ouvre
 *      RIEN tant que le client n'a pas répondu. La confondre avec
 *      « active » ferait croire à un accès qu'on n'a pas.
 *   4. ACTIVE en dernier : c'est le seul état qui ouvre quelque chose,
 *      et c'est celui qu'on atteint quand aucun des trois autres ne
 *      s'applique.
 */
export type EtatSession = "revoquee" | "expiree" | "consentement-attendu" | "active";

export function etatSession(
  session: Pick<
    SessionAssistance,
    "revoked_at" | "expires_at" | "consent_required" | "consent_given_at"
  >,
  maintenant: Date = new Date(),
): EtatSession {
  if (session.revoked_at !== null) return "revoquee";

  const fin = new Date(session.expires_at).getTime();
  // Une date illisible est traitée comme EXPIRÉE, jamais comme active.
  // Un `NaN` qui retomberait sur « active » ouvrirait une session sans
  // fin, ce que la base refuse justement d'enregistrer.
  if (Number.isNaN(fin) || fin <= maintenant.getTime()) return "expiree";

  if (session.consent_required && session.consent_given_at === null) {
    return "consentement-attendu";
  }
  return "active";
}

export const LIBELLES_ETAT_SESSION: Record<EtatSession, string> = {
  revoquee: "Révoquée",
  expiree: "Terminée",
  "consentement-attendu": "En attente du consentement",
  active: "Ouverte",
};

/**
 * Le ton d'un état de session.
 *
 * `active` est en AVERTISSEMENT et non en « positif ». Une session
 * d'assistance ouverte n'est pas une bonne nouvelle à célébrer : c'est
 * un accès aux données d'un client qui court, et l'œil doit s'y
 * arrêter dans une liste. Le vert dirait « tout va bien ».
 */
export const TONS_ETAT_SESSION: Record<EtatSession, Tone> = {
  revoquee: "critical",
  expiree: "neutral",
  "consentement-attendu": "info",
  active: "warning",
};

/**
 * Les secondes restantes, jamais négatives.
 *
 * Rend `0` pour une session finie — et non un nombre négatif, qu'un
 * affichage naïf transformerait en « expire dans -12 min ».
 */
export function secondesRestantes(expiresAt: string, maintenant: Date = new Date()): number {
  const fin = new Date(expiresAt).getTime();
  if (Number.isNaN(fin)) return 0;
  return Math.max(0, Math.floor((fin - maintenant.getTime()) / 1000));
}

/**
 * « expire dans 18 min », la phrase de la spec p.21.
 *
 * Sous la minute, on compte en SECONDES : « expire dans 0 min »
 * laisserait croire à un accès encore ouvert pendant cinquante-neuf
 * secondes, ou à un accès déjà fermé alors qu'il court. Les deux sont
 * faux, et c'est la dernière minute qui compte.
 */
export function phraseTempsRestant(secondes: number): string {
  if (secondes <= 0) return "expirée";
  if (secondes < 60) return `expire dans ${secondes} s`;
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return `expire dans ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? `expire dans ${heures} h` : `expire dans ${heures} h ${reste} min`;
}

/**
 * Un niveau d'accès est-il réellement proposable dans le formulaire ?
 *
 * DEUX CONDITIONS, ET LA SECONDE EST CELLE QU'ON OUBLIE. La base refuse
 * un niveau non accordable (0081 § 8.c) ; elle refuse AUSSI un niveau
 * qui prétend ouvrir des données métier sans qu'aucune ressource ne lui
 * soit rattachée — « les données du client » n'est pas un niveau
 * d'accès. Le formulaire recopie les deux règles pour ne pas proposer
 * un choix que la base rejettera, et l'écran affiche le motif du refus
 * plutôt que de faire disparaître la ligne : son absence pure ferait
 * croire à un oubli d'interface, alors que c'est une décision.
 */
export function niveauProposable(
  niveau: NiveauAcces,
  nombreDeRessources: number,
): { proposable: true } | { proposable: false; motif: string } {
  if (!niveau.is_grantable) {
    return {
      proposable: false,
      motif:
        niveau.note ??
        "Ce niveau est déclaré mais non accordable : aucune ressource ne lui a été attribuée.",
    };
  }
  if (niveau.opens_business_data && nombreDeRessources === 0) {
    return {
      proposable: false,
      motif:
        "Ce niveau prétend ouvrir des données métier mais aucune table ne lui est rattachée. " +
        "La base refuserait la session : « les données du client » n'est pas un niveau d'accès.",
    };
  }
  return { proposable: true };
}

/**
 * Ce qu'un niveau ouvre, en une phrase.
 *
 * ZÉRO RESSOURCE SE DIT, et se dit exactement : « n'ouvre aucune
 * donnée ». C'est le cas du niveau `none`, qui est le DÉFAUT et qui est
 * parfaitement utile — il trace qu'un administrateur travaille sur un
 * dossier, ce que le client peut lire. Une liste vide affichée comme un
 * trou laisserait croire à un réglage manquant.
 */
export function resumeRessources(ressources: readonly string[]): string {
  if (ressources.length === 0) return "N'ouvre aucune donnée.";
  return `Ouvre en lecture seule : ${ressources.join(", ")}.`;
}
