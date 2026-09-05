/**
 * ==================================================================
 * CE QUE LE CENTRE DE SÉCURITÉ NE SAIT PAS DIRE — spec p.29
 * ==================================================================
 *
 * La spec demande six choses :
 *
 *     failed logins
 *     suspicious sessions
 *     permission changes      ← mesurable
 *     admin actions           ← mesurable
 *     support sessions        ← mesurable
 *     API anomalies
 *
 * TROIS SONT MESURABLES et se lisent dans `admin_audit_events` et
 * `support_sessions`. TROIS NE LE SONT PAS, et ce fichier écrit
 * pourquoi, une fois, à un seul endroit.
 *
 * ------------------------------------------------------------------
 * POURQUOI ÇA S'AFFICHE PLUTÔT QUE DE DISPARAÎTRE
 * ------------------------------------------------------------------
 * Un centre de sécurité qui montrerait trois cases sur six sans dire un
 * mot des trois autres laisserait croire que la spec en demandait
 * trois. Pire : il laisserait croire qu'on SURVEILLE les connexions
 * échouées. Un responsable sécurité qui ouvre cet écran doit repartir
 * en sachant exactement ce qui est surveillé et ce qui ne l'est pas —
 * c'est la moitié utile de la page.
 *
 * Et surtout : jamais ZÉRO. « 0 connexion échouée » se lit « personne
 * n'a essayé » ; la vérité est « rien ne les compte ». Les deux appellent
 * des décisions opposées. Ce produit a corrigé quatre fois la confusion
 * entre « zéro » et « je ne sais pas ».
 */

export type IndicateurAbsent = {
  /** L'intitulé de la spec, en français. */
  libelle: string;
  /** Ce qui manque, en une phrase qu'on peut lire à l'écran. */
  raison: string;
  /** Ce qu'il faudrait construire. Sans cela, la phrase est une plainte. */
  remede: string;
  /**
   * Le chiffre qui s'en approche, quand il en existe un — et le piège
   * qu'il y a à le lire comme la réponse.
   */
  approche?: string;
};

export const INDICATEURS_ABSENTS: readonly IndicateurAbsent[] = [
  {
    libelle: "Connexions échouées",
    raison:
      "Le seul journal qui les enregistrerait, auth.audit_log_entries, compte ZÉRO ligne sur ce projet — vérifié en production. " +
      "Et il ne serait de toute façon pas lisible d'ici : le schéma auth n'est pas exposé à PostgREST, " +
      "et aucune fonction security definer de 0075, 0080 ou 0081 ne l'ouvre.",
    remede:
      "Activer la conservation des journaux d'authentification côté Supabase, puis poser une fonction " +
      "security definer dans public qui en rende un décompte agrégé — jamais la table elle-même, " +
      "qui contient les adresses des tentatives.",
  },
  {
    libelle: "Sessions suspectes",
    raison:
      "Rien ne qualifie une session de suspecte : il n'existe ni empreinte d'appareil, ni pays d'origine, " +
      "ni historique de connexion à comparer. auth.sessions ne garde que les sessions VIVANTES — " +
      "la ligne disparaît à la déconnexion — donc même « deux pays en une heure » est hors de portée.",
    remede:
      "Il faut d'abord un historique des connexions (voir ci-dessus), puis une règle écrite de ce qui rend " +
      "une session suspecte. Sans la règle, l'écran afficherait l'opinion de celui qui l'a codé.",
    approche:
      "« Sessions ouvertes » et « comptes connectés », sur le tableau de bord, sont des instantanés de " +
      "présence. Aucun des deux ne mesure une anomalie : ils comptent des gens qui travaillent.",
  },
  {
    libelle: "Anomalies d'API",
    raison:
      "Aucune table n'enregistre une requête, une latence, un code de retour ni un quota dépassé. " +
      "Il n'y a pas de collecteur : ni dans les Edge Functions, ni dans web-pro, ni dans l'application iPhone.",
    remede:
      "Décider d'abord OÙ ces faits naissent — la passerelle PostgREST, les Edge Functions — avant " +
      "d'écrire l'écran qui les lit. Un tableau de bord d'anomalies posé avant son collecteur reste vide à vie.",
  },
];

/**
 * Le seul indicateur de sécurité qui soit mesurable et qui ne vienne PAS
 * du journal : la couverture du second facteur.
 *
 * Il n'est pas dans la liste de la spec p.29, et il est pourtant le
 * chiffre le plus actionnable de l'écran — c'est la seule protection de
 * cette console contre un cookie volé. `admin_list_platform_admins()`
 * (0081 § 3.f) le calcule depuis `auth.mfa_factors`, qu'on ne peut lire
 * d'aucune autre façon.
 */
export const NOTE_COUVERTURE_MFA =
  "Compté depuis auth.mfa_factors par admin_list_platform_admins(). " +
  "Un facteur « vérifié » est un facteur réellement utilisable : un enrôlement abandonné en cours de route " +
  "ne compte pas. Tant que la politique ADMIN_MFA_POLICY ne vaut pas « require », un administrateur sans " +
  "facteur entre quand même — c'est délibéré, et c'est ce qui évite d'enfermer dehors le dernier " +
  "administrateur le jour du basculement.";
