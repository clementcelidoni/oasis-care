import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ==================================================================
 * ADMIN MFA — spec p.32 : « Préparer OU EXIGER une authentification
 * renforcée pour les administrateurs lorsque disponible. »
 * ==================================================================
 *
 * Ce fichier PRÉPARE. Il ne pose pas l'enrôlement, et c'est délibéré :
 * ce jalon ne livre pas d'écran d'inscription d'un facteur, donc
 * basculer la politique sur « exiger » aujourd'hui enfermerait dehors
 * le seul administrateur existant, sans porte pour rentrer.
 *
 * ------------------------------------------------------------------
 * CE QUI EXISTE DÉJÀ, ET QU'IL N'Y A DONC PAS À CONSTRUIRE
 * ------------------------------------------------------------------
 * L'audit l'a vérifié sur la vraie base : le schéma `auth` de ce projet
 * porte déjà `mfa_factors` (13 colonnes), `mfa_challenges`,
 * `mfa_amr_claims`, `webauthn_credentials` et `webauthn_challenges`, et
 * `auth.sessions` porte une colonne `aal`. L'infrastructure est là,
 * simplement inutilisée : aucun facteur n'est enrôlé, les deux comptes
 * se connectent par Apple, Google ou lien magique.
 *
 * Le niveau d'assurance d'une session (AAL) se lit donc sans rien
 * ajouter :
 *   • `aal1` — un seul facteur (lien magique, Apple, Google) ;
 *   • `aal2` — un second facteur a été présenté.
 *
 * `nextLevel` dit ce que la session POURRAIT atteindre : il vaut
 * `aal2` dès qu'un facteur vérifié existe sur le compte. C'est ce qui
 * distingue « cette personne n'a pas de second facteur » de « cette
 * personne en a un mais ne l'a pas présenté sur cette session » — deux
 * situations qui n'appellent pas la même phrase à l'écran.
 *
 * ------------------------------------------------------------------
 * LE CRAN `require` EST RÉEL, ET C'EST LE POINT IMPORTANT
 * ------------------------------------------------------------------
 * Ce fichier ne rend qu'une DÉCISION — le booléen `blocking` — et ne
 * redirige jamais : la garde (`lib/auth/guard.ts`) reste le seul
 * endroit du code qui ferme une porte, et c'est elle qui consulte
 * `admin.mfa.blocking` juste après avoir résolu l'identité.
 *
 * Mais la décision, elle, MORD. Un réglage de durcissement qui ne
 * change rien est pire qu'un réglage absent : l'exploitant croit avoir
 * fermé une porte qui est restée grande ouverte. Avec
 * `ADMIN_MFA_POLICY=require`, un administrateur dont la session n'est
 * pas `aal2` est renvoyé vers `/second-facteur` et n'atteint aucun
 * écran du Control Center.
 *
 * Conséquence à connaître AVANT de basculer la variable : ce jalon ne
 * livre pas d'écran d'enrôlement. Passer à `require` sans qu'un facteur
 * soit enrôlé dans Supabase enferme dehors les administrateurs
 * concernés — `/second-facteur` le leur dit et explique où enrôler,
 * mais la porte reste fermée jusque-là. C'est un choix d'exploitation,
 * pas un accident.
 */

export type MfaPolicy = "off" | "encourage" | "require";

/**
 * La politique vient de l'environnement, pas du code : la durcir sera
 * un changement de configuration du déploiement, pas un déploiement.
 *
 * Par défaut « encourage » — la bannière s'affiche, personne n'est
 * bloqué. Toute valeur non reconnue retombe sur ce défaut plutôt que
 * de désactiver le contrôle : une faute de frappe dans une variable
 * d'environnement ne doit pas assouplir la sécurité en silence.
 */
export function mfaPolicy(): MfaPolicy {
  const raw = (process.env.ADMIN_MFA_POLICY ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "require") return raw;
  return "encourage";
}

export type MfaState = {
  policy: MfaPolicy;
  /** Le niveau de la session en cours. `null` si le serveur Auth n'a pas répondu. */
  currentLevel: "aal1" | "aal2" | null;
  /** Le niveau atteignable : `aal2` si un facteur vérifié existe sur le compte. */
  nextLevel: "aal1" | "aal2" | null;
  /** Un second facteur est enrôlé et vérifié sur ce compte. */
  enrolled: boolean;
  /** Ce second facteur a été présenté sur CETTE session. */
  satisfied: boolean;
  /**
   * La politique exige un second facteur et la session ne l'a pas.
   * Toujours `false` tant que `ADMIN_MFA_POLICY` n'est pas `require`.
   * `requireAdmin()` le consulte à chaque rendu et renvoie vers
   * `/second-facteur` quand il est vrai.
   */
  blocking: boolean;
};

/**
 * Le type de Supabase est `'aal1' | 'aal2' | (string & {})` : il laisse
 * volontairement la porte ouverte à un `aal3` futur. On la referme ici
 * plutôt que de propager l'incertitude dans toute l'interface — un
 * niveau qu'on ne connaît pas est traité comme inconnu, jamais comme
 * satisfaisant. C'est le sens sûr de l'erreur.
 */
function normalizeLevel(level: string | null): "aal1" | "aal2" | null {
  return level === "aal1" || level === "aal2" ? level : null;
}

/**
 * Lit le niveau d'assurance de la session en cours.
 *
 * Ne lève jamais : une console d'administration qui tomberait en panne
 * parce que la lecture d'un niveau MFA a échoué serait un déni de
 * service que personne n'a demandé. En cas de doute, le niveau est
 * « inconnu ».
 *
 * CE QUE « INCONNU » DÉCLENCHE DÉPEND DE LA POLITIQUE, et c'est le sens
 * sûr de l'erreur dans les deux cas : sous `encourage`, une bannière ;
 * sous `require`, un refus. Fermer sur une absence de réponse est la
 * règle que cette application s'est donnée partout ailleurs
 * (`proxy.ts`, `getCurrentUser()`), et la seule cohérente avec « ici la
 * RLS ne reprend pas la main ».
 */
export async function readMfaState(supabase: SupabaseClient): Promise<MfaState> {
  const policy = mfaPolicy();

  let currentLevel: MfaState["currentLevel"] = null;
  let nextLevel: MfaState["nextLevel"] = null;

  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && data) {
      currentLevel = normalizeLevel(data.currentLevel);
      nextLevel = normalizeLevel(data.nextLevel);
    }
  } catch {
    // Niveau inconnu : voir ci-dessus.
  }

  const enrolled = nextLevel === "aal2";
  const satisfied = currentLevel === "aal2";

  return {
    policy,
    currentLevel,
    nextLevel,
    enrolled,
    satisfied,
    // `require` seul bloque — et il bloque AUSSI quand le niveau est
    // inconnu. Exiger `currentLevel !== null` ici ferait échouer
    // OUVERT : une panne du serveur d'authentification suffirait à
    // désactiver le second facteur pour tout le monde, sans un mot.
    // C'est précisément le comportement que cette application a refusé
    // d'hériter de `web-pro/proxy.ts`.
    blocking: policy === "require" && !satisfied,
  };
}

/**
 * La phrase à afficher, ou `null` s'il n'y a rien à dire.
 *
 * Elle est calculée ici plutôt que dans le composant : ce sont trois
 * situations distinctes qui se ressemblent beaucoup à l'écran, et les
 * confondre donnerait à un administrateur déjà protégé le sentiment
 * qu'il ne l'est pas.
 */
export function mfaNotice(state: MfaState): { tone: "warning" | "info"; message: string } | null {
  if (state.policy === "off") return null;
  if (state.satisfied) return null;

  if (state.enrolled) {
    return {
      tone: "warning",
      message:
        "Votre second facteur n'a pas été présenté sur cette session. Reconnectez-vous pour l'utiliser.",
    };
  }

  if (state.currentLevel === null) {
    return {
      tone: "info",
      message:
        "Niveau d'authentification inconnu : le serveur d'authentification n'a pas répondu.",
    };
  }

  return {
    tone: "warning",
    message:
      "Aucune authentification à deux facteurs sur ce compte. L'infrastructure Supabase est en place ; l'écran d'enrôlement reste à livrer.",
  };
}
