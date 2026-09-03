import { VERSION_MAX_LENGTH } from "./presence.ts";
import pkg from "../../package.json" with { type: "json" };

/**
 * QUELLE VERSION TOURNE, ET SUR QUELLE RÉVISION.
 *
 * Lu CÔTÉ SERVEUR, jamais côté navigateur. Deux raisons :
 *   • le serveur sait avec certitude quelle version il exécute, alors
 *     qu'un onglet ouvert depuis trois jours porte l'ancienne ;
 *   • rien n'a alors besoin d'être exposé au client, et une variable de
 *     moins traverse le réseau.
 *
 * ============================================================
 * LE PIÈGE, DÉJÀ RENCONTRÉ CÔTÉ iPHONE
 * ============================================================
 *
 * 0077 a dû ajouter `app_build` À CÔTÉ de `app_version`, et le commit
 * explique pourquoi : `project.yml` fige `MARKETING_VERSION` à
 * « 0.1.0 », seul le numéro de build est réécrit par la CI, et les 31
 * versions envoyées à TestFlight portent donc TOUTES la version 0.1.0.
 * Une distribution bâtie sur la seule version afficherait « 100 % sur
 * 0.1.0 » : exact, et sans aucune valeur.
 *
 * LE WEB PRO EST DANS LE MÊME CAS, EN PIRE. `package.json` porte
 * « 0.1.0 » depuis le premier jour et rien ne le remonte ; il n'existe
 * même pas de chaîne d'intégration pour ce projet
 * (`.github/workflows/` ne contient que les trois workflows iOS). La
 * version du paquet dit donc « c'est Oasis Care Pro », pas « c'est la
 * livraison de mardi ».
 *
 * C'est la RÉVISION DE BUILD qui porte l'information utile, et elle
 * n'existe que si le déploiement l'injecte. Quand elle manque, on rend
 * `null` — PAS une chaîne inventée, PAS « inconnu », PAS la date du
 * jour. Ce projet a corrigé deux fois (0059, 0065) la confusion entre
 * « zéro » et « je ne sais pas » ; une révision fabriquée ferait
 * exactement cela, en pire, puisqu'elle serait indiscernable d'une
 * vraie dans la distribution des versions.
 *
 * POUR QUE CE CHAMP SERVE, il suffit d'injecter l'une des variables
 * ci-dessous à la construction. C'est une ligne de configuration de
 * déploiement, hors du périmètre de ce module — et le jour où elle
 * existe, ce fichier n'a pas à changer.
 */

/**
 * Les sources de révision reconnues, dans l'ordre.
 *
 * `NEXT_PUBLIC_APP_BUILD` d'abord : c'est celle qu'on pose exprès, elle
 * doit gagner sur celles que l'hébergeur fournit d'office. Les
 * suivantes sont les noms standards des trois hébergeurs qui déploient
 * du Next.js sans qu'on ait rien à écrire.
 */
const BUILD_SOURCES = [
  "NEXT_PUBLIC_APP_BUILD",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
  "GIT_COMMIT_SHA",
] as const;

/** Un SHA court reste lisible dans un tableau et tient dans 32 signes. */
const SHORT_SHA_LENGTH = 12;

export interface WebRelease {
  appVersion: string;
  appBuild: string | null;
}

/**
 * La version et la révision de CE serveur.
 *
 * Lues à chaque appel plutôt que figées dans une constante de module :
 * la différence est invisible en production (les variables
 * d'environnement n'y bougent pas), mais elle rend la fonction
 * vérifiable et évite un ordre d'initialisation à surveiller.
 */
export function webRelease(): WebRelease {
  // Une version imposée par le déploiement gagne sur celle du paquet,
  // mais seulement si elle tient dans la colonne : au-delà, ce n'est
  // plus un numéro de version, et la base la refuserait.
  const forced = clean(process.env.NEXT_PUBLIC_APP_VERSION);
  const declared = forced && forced.length <= VERSION_MAX_LENGTH ? forced : null;

  return {
    // `package.json` est la seule source de vérité pour la version, et
    // on l'importe plutôt que de recopier « 0.1.0 » ici : une constante
    // recopiée dérive, et personne ne s'en aperçoit avant de lire un
    // tableau faux six mois plus tard.
    appVersion: declared ?? pkg.version,
    appBuild: readBuild(),
  };
}

function readBuild(): string | null {
  for (const name of BUILD_SOURCES) {
    const value = clean(process.env[name]);
    // Le raccourcissement vient APRÈS le nettoyage et pas avant : un
    // SHA complet fait 40 signes, il ne doit pas être écarté pour
    // dépassement avant d'avoir été raccourci à 12.
    if (value) return value.slice(0, SHORT_SHA_LENGTH);
  }
  return null;
}

/**
 * Une variable d'environnement absente et une variable vide sont la
 * même chose : `VERCEL_GIT_COMMIT_SHA=` (posée mais non renseignée) ne
 * doit pas devenir une révision « » qui passerait le contrôle de
 * complétude.
 */
function clean(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
