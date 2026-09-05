/**
 * Le miroir TypeScript de `admin_audit_events` (0075 § 3, colonnes
 * vérifiées en production).
 *
 * Les noms restent ceux des colonnes. `old_value` et `new_value` sont
 * `unknown` et non `Record<string, unknown>` : ce sont des `jsonb`, la
 * base n'y impose aucune forme, et prétendre le contraire ferait écrire
 * des accès `.plan` qui compilent et cassent à l'exécution. L'écran les
 * affiche tels qu'enregistrés, ce qui est aussi la seule façon honnête
 * de montrer une trace.
 */
export type EvenementAudit = {
  id: string;
  /** `on delete set null` : un admin supprimé laisse sa trace, sans son nom. */
  admin_user_id: string | null;
  /** Le rôle AU MOMENT DU GESTE, recopié — pas celui d'aujourd'hui. */
  admin_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  old_value: unknown;
  new_value: unknown;
  /** `not null` et non vide en base : il n'existe pas d'acte sans motif. */
  reason: string;
  ip: string | null;
  user_agent: string | null;
  session_metadata: unknown;
  occurred_at: string;
};

/**
 * Une fiche d'administrateur, telle que `admin_list_platform_admins()`
 * la rend (0081 § 3.f).
 *
 * `has_verified_mfa` est calculé en SQL depuis `auth.mfa_factors`, qu'on
 * ne peut pas lire autrement : le schéma `auth` n'est pas exposé à
 * PostgREST. C'est la SEULE mesure de couverture du second facteur dont
 * dispose cette application.
 */
export type FicheAdministrateur = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  revoked_at: string | null;
  note: string | null;
  has_verified_mfa: boolean;
  last_sign_in_at: string | null;
};
