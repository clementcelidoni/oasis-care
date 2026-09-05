import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * ==================================================================
 * LES LECTURES DE L'ÉQUIPE OASIS CARE ET DE LA MATRICE DES RÔLES
 * ==================================================================
 *
 * Tout passe par la session de l'administrateur — jamais par
 * `service_role`. Les trois sources se protègent elles-mêmes :
 *
 *   • `admin_list_platform_admins()` (0081 § 3.g) exige
 *     `platform.admins.read` et lève 42501 sinon. Elle est
 *     `security definer` parce que `auth.users` et `auth.mfa_factors`
 *     sont fermées à `authenticated` : sans elle, l'écran « Équipe »
 *     afficherait des identifiants sans adresses et ne saurait pas qui
 *     est protégé par un second facteur.
 *   • `platform_admin_invitations` a une politique de LECTURE seule, sur
 *     la même permission. Aucune politique d'écriture n'existe : les
 *     fonctions de 0081 sont le seul chemin.
 *   • `platform_admin_permissions` et `platform_admin_role_permissions`
 *     se lisent par tout administrateur de plateforme (0075).
 *
 * ------------------------------------------------------------------
 * POURQUOI UN TYPE DE RÉSULTAT PLUTÔT QU'UNE EXCEPTION
 * ------------------------------------------------------------------
 * Parce que « la migration 0081 n'est pas appliquée » n'est PAS une
 * panne, et ne doit pas s'afficher comme telle. C'est l'état normal de
 * ce dépôt jusqu'au déploiement, et le piège de semis de 0075 le rend
 * indiscernable d'un problème de droits si on ne le nomme pas : les
 * permissions neuves ne sont portées par personne tant que la migration
 * n'a pas rejoué la jointure, y compris pour le super-administrateur.
 * Un écran qui dirait « accès refusé » enverrait chercher un bug de rôle
 * pendant une heure.
 */

export type Lecture<T> =
  | { etat: "ok"; valeur: T }
  /** La fonction ou la table n'existe pas : 0081 n'est pas appliquée. */
  | { etat: "absent"; message: string }
  /** La base a refusé l'appelant : 42501. */
  | { etat: "refus"; message: string }
  /** Tout le reste : réseau, SQL, cache de schéma. */
  | { etat: "panne"; message: string };

const MIGRATION_ABSENTE =
  "La migration 0081_control_center_suite.sql n'est pas appliquée à cette base — ou le cache de " +
  "schéma de PostgREST n'a pas encore été rechargé. Ce n'est pas un problème de rôle : la " +
  "fonction n'existe pas encore.";

function classer<T>(error: { message: string; code?: string }): Lecture<T> {
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") {
    return { etat: "absent", message: MIGRATION_ABSENTE };
  }
  if (error.code === "42501") {
    return { etat: "refus", message: error.message };
  }
  return {
    etat: "panne",
    message: `${error.message} (${error.code ?? "sans code"})`,
  };
}

// ------------------------------------------------------------------
// 1. L'équipe
// ------------------------------------------------------------------

export type MembreEquipe = {
  userId: string;
  email: string | null;
  /** Le nom affiché du profil, s'il en a un. Souvent absent. */
  displayName: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  revokedAt: string | null;
  note: string | null;
  /**
   * Un facteur TOTP VÉRIFIÉ existe sur ce compte. Compté dans
   * `auth.mfa_factors`, pas dans un cookie : c'est la seule mesure qui
   * ne puisse pas être périmée.
   */
  hasVerifiedMfa: boolean;
  /** Dernière connexion, telle que le serveur Auth la connaît. */
  lastSignInAt: string | null;
};

export async function lireEquipe(): Promise<Lecture<MembreEquipe[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_platform_admins");

  if (error) return classer(error);

  const lignes = Array.isArray(data) ? data : [];
  return {
    etat: "ok",
    valeur: lignes.map((ligne) => ({
      userId: ligne.user_id,
      email: ligne.email ?? null,
      displayName: ligne.display_name ?? null,
      role: ligne.role,
      isActive: ligne.is_active === true,
      createdAt: ligne.created_at,
      revokedAt: ligne.revoked_at ?? null,
      note: ligne.note ?? null,
      hasVerifiedMfa: ligne.has_verified_mfa === true,
      lastSignInAt: ligne.last_sign_in_at ?? null,
    })),
  };
}

// ------------------------------------------------------------------
// 2. Les invitations
// ------------------------------------------------------------------

export type EtatInvitation = "enAttente" | "expiree" | "acceptee" | "retiree";

export type Invitation = {
  email: string;
  role: string;
  invitedByRole: string;
  reason: string;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  etat: EtatInvitation;
};

/**
 * L'ÉTAT SE DÉDUIT, IL NE SE STOCKE PAS.
 *
 * « Expirée » n'est pas une colonne : ce serait une valeur à tenir à
 * jour par un traitement planifié qui n'existe pas, et qui, le jour où
 * il tomberait en panne, laisserait des invitations mortes se présenter
 * comme vivantes. La base fait le même raisonnement dans
 * `claim_platform_admin_invitation()` : `expires_at > now()` est vérifié
 * au moment de réclamer, jamais avant. L'écran ne fait donc que
 * REFLÉTER ce que la base décidera ; il ne décide rien.
 */
function etatDe(ligne: {
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}): EtatInvitation {
  if (ligne.accepted_at) return "acceptee";
  if (ligne.revoked_at) return "retiree";
  return new Date(ligne.expires_at).getTime() <= Date.now() ? "expiree" : "enAttente";
}

export async function lireInvitations(): Promise<Lecture<Invitation[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("platform_admin_invitations")
    .select(
      "email, role, invited_by_role, reason, note, created_at, expires_at, accepted_at, revoked_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return classer(error);

  return {
    etat: "ok",
    valeur: (data ?? []).map((ligne) => ({
      email: ligne.email,
      role: ligne.role,
      invitedByRole: ligne.invited_by_role,
      reason: ligne.reason,
      note: ligne.note ?? null,
      createdAt: ligne.created_at,
      expiresAt: ligne.expires_at,
      acceptedAt: ligne.accepted_at ?? null,
      revokedAt: ligne.revoked_at ?? null,
      etat: etatDe(ligne),
    })),
  };
}

// ------------------------------------------------------------------
// 3. La matrice des rôles
// ------------------------------------------------------------------

export type CataloguePermission = {
  key: string;
  label: string;
  /** La colonne `is_write` de la base, celle sur laquelle raisonne le garde-fou. */
  isWrite: boolean;
};

export type MatriceRoles = {
  permissions: CataloguePermission[];
  /** Pour chaque rôle, les clés qu'il porte réellement EN BASE. */
  parRole: Record<string, string[]>;
};

/**
 * La matrice telle qu'elle est, pas telle qu'on la croit.
 *
 * C'est tout l'intérêt de la lire en base plutôt que de recopier
 * `lib/auth/roles.ts` : le piège de semis de 0075 se voit ICI et nulle
 * part ailleurs. Une permission ajoutée par une migration sans que la
 * jointure du super-administrateur soit rejouée apparaît au catalogue,
 * cochée pour PERSONNE — et l'écran correspondant disparaît du menu sans
 * la moindre erreur. Cet écran est le seul endroit du Control Center où
 * cette situation se lit d'un coup d'œil.
 */
export async function lireMatriceRoles(): Promise<Lecture<MatriceRoles>> {
  const supabase = await createClient();

  const [catalogue, matrice] = await Promise.all([
    supabase.from("platform_admin_permissions").select("key, label, is_write").order("key"),
    supabase.from("platform_admin_role_permissions").select("role, permission"),
  ]);

  if (catalogue.error) return classer(catalogue.error);
  if (matrice.error) return classer(matrice.error);

  const parRole: Record<string, string[]> = {};
  for (const ligne of matrice.data ?? []) {
    (parRole[ligne.role] ??= []).push(ligne.permission);
  }

  return {
    etat: "ok",
    valeur: {
      permissions: (catalogue.data ?? []).map((ligne) => ({
        key: ligne.key,
        label: ligne.label,
        isWrite: ligne.is_write === true,
      })),
      parRole,
    },
  };
}
