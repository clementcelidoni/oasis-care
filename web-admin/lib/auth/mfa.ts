import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ==================================================================
 * ADMIN MFA — spec p.32 : « Préparer OU EXIGER une authentification
 * renforcée pour les administrateurs lorsque disponible. »
 * ==================================================================
 *
 * Ce fichier CALCULE UNE DÉCISION et n'en applique aucune : il ne
 * redirige pas, il ne refuse pas. `lib/auth/guard.ts` reste le seul
 * endroit du code qui ferme une porte, et il consulte `blocking` juste
 * après avoir résolu l'identité.
 *
 * ------------------------------------------------------------------
 * DEUX SOURCES, ET LEUR ORDRE EST LA PARTIE IMPORTANTE
 * ------------------------------------------------------------------
 * Depuis la migration 0081, l'exigence de second facteur vit EN BASE —
 * `platform_security_settings (mfa_required, mfa_required_from)`, réglée
 * depuis `/parametres/securite` par un porteur de
 * `platform.security.write`, journalisée. C'est la source normale : la
 * durcir ne demande plus un redéploiement.
 *
 * `ADMIN_MFA_POLICY` reste dans l'environnement, et devient une
 * SURCHARGE D'EXPLOITATION à deux crans :
 *
 *   off       — l'exigence est levée quoi que dise la base. C'EST LA
 *               SORTIE DE SECOURS, et elle a un usage précis : si
 *               l'enrôlement TOTP se révélait désactivé au niveau du
 *               projet Supabase, plus personne ne pourrait poser de
 *               facteur, et la seule façon de rentrer serait celle-ci.
 *   require   — l'exigence s'applique quoi que dise la base. Utile pour
 *               durcir un déploiement avant même que 0081 y soit
 *               appliquée.
 *   encourage — le défaut : LA BASE DÉCIDE. C'est le cas normal.
 *
 * Toute valeur non reconnue retombe sur `encourage` : une faute de
 * frappe dans une variable d'environnement ne doit pas assouplir la
 * sécurité en silence, ni la durcir par surprise.
 *
 * ------------------------------------------------------------------
 * ON NE FERME JAMAIS LA PORTE SUR QUELQU'UN QUI N'A PAS DE FACTEUR
 * ------------------------------------------------------------------
 * C'est la règle structurelle du sujet, et 0081 § 2 la répète : un
 * administrateur sans second facteur doit pouvoir entrer pour en poser
 * un. Elle tient ici par une seule chose — `/second-facteur` vit HORS du
 * groupe `(control)`, n'appelle pas la garde, et PORTE MAINTENANT
 * L'ÉCRAN D'ENRÔLEMENT. Quelqu'un que `blocking` renvoie là-bas n'est
 * pas enfermé dehors : il est enfermé DANS l'enrôlement, ce qui est le
 * comportement voulu.
 *
 * En base, la même règle s'écrit autrement et couvre le cas où
 * l'interface serait contournée : `platform_admin_require_mfa()` est
 * appelée par TOUTES les écritures administratives de 0081 et par AUCUNE
 * lecture.
 *
 * ------------------------------------------------------------------
 * D'OÙ VIENT LE NIVEAU D'ASSURANCE, ET POURQUOI LA BASE EST MEILLEURE
 * ------------------------------------------------------------------
 * Deux lectures possibles, et elles ne se valent pas :
 *
 *   • `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` SANS
 *     argument ne parle PAS au serveur Auth. Le SDK appelle
 *     `getSession()` et DÉCODE le JWT localement, sans revérifier sa
 *     signature (`GoTrueClient`, `_getAuthenticatorAssuranceLevel`).
 *     Ce n'est sûr que parce que `resolveAdmin()` a d'abord appelé
 *     `getCurrentUser()` → `getUser()`, qui, lui, fait vérifier le jeton
 *     par le serveur. CETTE DÉPENDANCE D'ORDRE EST RÉELLE : lire l'AAL
 *     sans avoir appelé `getUser()` avant laisserait passer un cookie
 *     forgé annonçant `aal2`. Ne déplacez pas cet appel ailleurs.
 *     Le `nextLevel` du SDK est pire encore : il est dérivé de
 *     `session.user.factors`, c'est-à-dire de l'objet utilisateur STOCKÉ
 *     DANS LE COOKIE, et il reste donc périmé juste après un enrôlement.
 *
 *   • `platform_admin_mfa_state()` (0081) lit `request.jwt.claims.aal`,
 *     que PostgREST a placé là APRÈS avoir vérifié la signature, et
 *     compte les facteurs directement dans `auth.mfa_factors`. C'est une
 *     preuve serveur, et elle ne peut pas être périmée.
 *
 * On préfère donc la base dès qu'elle répond, et on ne retombe sur le
 * SDK que si 0081 n'est pas encore appliquée.
 */

export type MfaPolicy = "off" | "encourage" | "require";

/**
 * La surcharge d'exploitation. Voir l'en-tête : `encourage` (le défaut)
 * signifie « la base décide », pas « ne rien exiger ».
 */
export function mfaPolicy(): MfaPolicy {
  const raw = (process.env.ADMIN_MFA_POLICY ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "require") return raw;
  return "encourage";
}

export type MfaState = {
  /** La surcharge d'environnement, telle quelle. */
  policy: MfaPolicy;

  /**
   * Ce que la base dit, ou `null` partout quand 0081 n'est pas appliquée
   * — auquel cas `databaseUnavailable` porte la raison. `null` n'est
   * jamais traduit en `false` : « la base n'a rien dit » et « la base dit
   * non » ne sont pas la même information, et l'écran de réglage doit
   * pouvoir les distinguer.
   */
  databaseRequired: boolean | null;
  databaseRequiredFrom: string | null;
  /** L'exigence de la base mord-elle DÉJÀ (délai de grâce écoulé) ? */
  databaseInForce: boolean | null;
  databaseUnavailable: string | null;

  /** Comptés dans `auth.mfa_factors`, jamais dans le cookie. */
  verifiedFactors: number | null;
  unverifiedFactors: number | null;

  /** Le niveau de la session en cours. `null` si personne n'a pu le dire. */
  currentLevel: "aal1" | "aal2" | null;
  /** Le niveau atteignable : `aal2` si un facteur vérifié existe. */
  nextLevel: "aal1" | "aal2" | null;

  /** Un second facteur est enrôlé et vérifié sur ce compte. */
  enrolled: boolean;
  /** Ce facteur a été présenté sur CETTE session. */
  satisfied: boolean;

  /** L'exigence s'applique, toutes sources confondues. */
  required: boolean;
  /** Qui l'impose — pour que l'écran de réglage dise la vérité. */
  requiredBy: "environnement" | "base" | null;

  /**
   * L'exigence s'applique et la session ne la satisfait pas.
   * `requireAdmin()` renvoie alors vers `/second-facteur`, qui porte
   * l'écran d'enrôlement.
   */
  blocking: boolean;
};

/**
 * Le type de Supabase est `'aal1' | 'aal2' | (string & {})` : il laisse
 * volontairement la porte ouverte à un `aal3` futur. On la referme ici
 * plutôt que de propager l'incertitude — un niveau qu'on ne connaît pas
 * est traité comme inconnu, jamais comme satisfaisant.
 */
function normalizeLevel(level: string | null | undefined): "aal1" | "aal2" | null {
  return level === "aal1" || level === "aal2" ? level : null;
}

type EtatBase = {
  required: boolean;
  requiredFrom: string | null;
  inForce: boolean;
  verified: number;
  unverified: number;
  currentLevel: "aal1" | "aal2" | null;
  satisfied: boolean;
};

/**
 * Interroge `platform_admin_mfa_state()`.
 *
 * Rend `null` — et une raison — plutôt que de lever : une console
 * d'administration qui tomberait en panne parce que la lecture d'un
 * niveau MFA a échoué serait un déni de service que personne n'a
 * demandé. Ce que « inconnu » déclenche est décidé plus bas, et c'est
 * le sens sûr de l'erreur : sous exigence, une absence de réponse
 * ferme.
 */
async function lireEtatBase(
  supabase: SupabaseClient,
): Promise<{ etat: EtatBase | null; indisponible: string | null }> {
  try {
    const { data, error } = await supabase.rpc("platform_admin_mfa_state");

    if (error) {
      // PGRST202 / 42883 : la migration 0081 n'est pas appliquée, ou le
      // cache de schéma de PostgREST a une minute de retard. C'est le
      // cas NORMAL avant déploiement, pas une panne — on le nomme.
      if (error.code === "PGRST202" || error.code === "42883") {
        return {
          etat: null,
          indisponible:
            "La migration 0081 n'est pas appliquée : la base ne porte pas encore la politique de second facteur. Seule la variable d'environnement ADMIN_MFA_POLICY décide.",
        };
      }
      return {
        etat: null,
        indisponible: `La base n'a pas répondu sur l'état du second facteur : ${error.message} (${error.code ?? "sans code"}).`,
      };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { etat: null, indisponible: "La base n'a rendu aucune ligne d'état MFA." };
    }

    return {
      etat: {
        required: row.policy_required === true,
        requiredFrom: row.required_from ?? null,
        inForce: row.policy_in_force === true,
        verified: Number(row.verified_factors ?? 0),
        unverified: Number(row.unverified_factors ?? 0),
        currentLevel: normalizeLevel(row.current_level),
        satisfied: row.satisfied === true,
      },
      indisponible: null,
    };
  } catch (error) {
    return {
      etat: null,
      indisponible: `La lecture de l'état du second facteur a échoué : ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * L'état complet, tel que la garde et les écrans le consultent.
 *
 * NE LÈVE JAMAIS. Voir `lireEtatBase`.
 *
 * ATTENTION À L'ORDRE D'APPEL : cette fonction suppose que
 * `getCurrentUser()` a déjà fait vérifier le jeton par le serveur Auth.
 * C'est vrai dans `resolveAdmin()`, et c'est la seule raison pour
 * laquelle la retombée SDK est sûre. Voir l'en-tête du fichier.
 */
export async function readMfaState(supabase: SupabaseClient): Promise<MfaState> {
  const policy = mfaPolicy();
  const { etat, indisponible } = await lireEtatBase(supabase);

  // La retombée SDK ne sert QUE si la base n'a pas répondu.
  let sdkCurrent: "aal1" | "aal2" | null = null;
  let sdkNext: "aal1" | "aal2" | null = null;
  if (etat === null) {
    try {
      const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!error && data) {
        sdkCurrent = normalizeLevel(data.currentLevel);
        sdkNext = normalizeLevel(data.nextLevel);
      }
    } catch {
      // Niveau inconnu : voir plus bas ce que l'inconnu déclenche.
    }
  }

  const currentLevel = etat ? etat.currentLevel : sdkCurrent;
  const enrolled = etat ? etat.verified > 0 : sdkNext === "aal2";
  const nextLevel: "aal1" | "aal2" | null = etat
    ? etat.verified > 0
      ? "aal2"
      : "aal1"
    : sdkNext;

  // `satisfied` demande LES DEUX : un facteur posé ET une session qui
  // l'a réellement présenté. Un facteur enrôlé puis jamais rechallengé
  // laisse la session en `aal1` — c'est exactement le cas qu'un contrôle
  // naïf laisserait passer.
  const satisfied = etat ? etat.satisfied : enrolled && currentLevel === "aal2";

  // L'exigence. `off` lève tout : c'est la sortie de secours, elle doit
  // être inconditionnelle pour servir à quelque chose.
  let required: boolean;
  let requiredBy: MfaState["requiredBy"];
  if (policy === "off") {
    required = false;
    requiredBy = null;
  } else if (policy === "require") {
    required = true;
    requiredBy = "environnement";
  } else {
    // `encourage` : la base décide. Si elle n'a pas répondu, elle n'exige
    // rien — et c'est ASSUMÉ. Fermer sur une base muette enfermerait
    // dehors toute l'équipe le jour où PostgREST bafouille, alors que
    // les ÉCRITURES, elles, restent refusées côté SQL par
    // `platform_admin_require_mfa()` : la protection réelle ne dépend pas
    // de cette ligne.
    required = etat?.inForce === true;
    requiredBy = required ? "base" : null;
  }

  return {
    policy,
    databaseRequired: etat ? etat.required : null,
    databaseRequiredFrom: etat ? etat.requiredFrom : null,
    databaseInForce: etat ? etat.inForce : null,
    databaseUnavailable: indisponible,
    verifiedFactors: etat ? etat.verified : null,
    unverifiedFactors: etat ? etat.unverified : null,
    currentLevel,
    nextLevel,
    enrolled,
    satisfied,
    required,
    requiredBy,
    // Bloque AUSSI quand le niveau est inconnu sous exigence. Exiger
    // `currentLevel !== null` ici ferait échouer OUVERT : une panne du
    // serveur d'authentification suffirait à désactiver le second
    // facteur pour tout le monde, sans un mot.
    blocking: required && !satisfied,
  };
}

/**
 * La phrase à afficher dans la coquille, ou `null` s'il n'y a rien à
 * dire.
 *
 * Quatre situations qui se ressemblent beaucoup à l'écran, et les
 * confondre donnerait à un administrateur déjà protégé le sentiment
 * qu'il ne l'est pas.
 */
export function mfaNotice(
  state: MfaState,
): { tone: "warning" | "info"; message: string } | null {
  if (state.policy === "off") return null;
  if (state.satisfied) return null;

  if (state.enrolled) {
    return {
      tone: "warning",
      message:
        "Votre second facteur n'a pas été présenté sur cette session. Reconnectez-vous pour l'utiliser — les écritures administratives sont refusées tant qu'elle reste en aal1.",
    };
  }

  if (state.unverifiedFactors !== null && state.unverifiedFactors > 0) {
    return {
      tone: "warning",
      message:
        "Un enrôlement de second facteur a été commencé sans être terminé. Reprenez-le depuis Paramètres : un facteur non vérifié ne protège rien et gêne le suivant.",
    };
  }

  if (state.currentLevel === null) {
    return {
      tone: "info",
      message:
        "Niveau d'authentification inconnu : ni la base ni le serveur d'authentification n'ont su le dire.",
    };
  }

  return {
    tone: "warning",
    message:
      "Aucune authentification à deux facteurs sur ce compte. Posez-en une depuis Paramètres : le Control Center administre toute la plateforme, un mot de passe volé ne doit pas suffire.",
  };
}
