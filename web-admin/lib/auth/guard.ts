import "server-only";

import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { readMfaState, type MfaState } from "@/lib/auth/mfa";
import { isPlatformPermission, type PlatformPermission } from "@/lib/auth/roles";

/**
 * ==================================================================
 * LA GARDE — la séparation forte entre « normal user » et
 * « platform admin » (spec p.32)
 * ==================================================================
 *
 * Se connecter NE SUFFIT PAS. Les deux comptes de production sont des
 * utilisateurs ordinaires d'Oasis Care ; l'un d'eux est propriétaire
 * d'une entreprise Pro. Ni l'un ni l'autre n'est administrateur de
 * plateforme, et la spec p.32 interdit explicitement de confondre les
 * deux : « Ne pas considérer simplement organization owner comme admin
 * Oasis Care. »
 *
 * ------------------------------------------------------------------
 * OÙ VIT LE CONTRÔLE, ET POURQUOI PAS AILLEURS
 * ------------------------------------------------------------------
 * Ici, côté serveur, et une deuxième fois dans PostgreSQL.
 *
 *   • Pas dans un composant client : il suffirait de couper JavaScript.
 *   • Pas dans `proxy.ts` SEULEMENT : la documentation de Next dit de
 *     ne pas faire du proxy la couche d'autorisation, et Oasis Care Pro
 *     a déjà écrit noir sur blanc que le sien « FAILS OPEN ». Le proxy
 *     de cette application est un filet extérieur, pas la porte.
 *   • Pas dans la seule RLS : les lectures d'administration traversent
 *     les organisations, la RLS ne les couvre donc plus.
 *
 * La porte, c'est cette fonction, appelée par la coquille ET par chaque
 * page. Et derrière elle, chaque fonction de 0075 recommence le
 * contrôle en SQL : `if not public.is_platform_admin() then raise`.
 * Deux barrières indépendantes, dont aucune ne suppose que l'autre a
 * fait son travail.
 *
 * ------------------------------------------------------------------
 * CE QU'UN VISITEUR APPREND, ET CE QU'IL N'APPREND PAS
 * ------------------------------------------------------------------
 * Un compte qui n'est pas administrateur de plateforme reçoit un 404.
 * Pas « accès refusé », pas « réservé aux administrateurs » : rien qui
 * confirme que la page existe. Un 403 sur `/organisations` apprendrait
 * à un curieux qu'il y a quelque chose à `/organisations`.
 *
 * Le cas d'un administrateur LÉGITIME dont le rôle ne couvre pas la
 * page est différent : il sait déjà que le Control Center existe, il y
 * est. Lui répondre 404 le ferait douter de l'application au lieu de sa
 * permission. Il est donc envoyé vers un écran qui le lui dit
 * clairement (moindre privilège, spec p.30).
 */

export type AdminIdentity = {
  userId: string;
  email: string | null;
  role: string;
  permissions: string[];
  since: string | null;
  mfa: MfaState;
};

export function can(admin: AdminIdentity, permission: PlatformPermission): boolean {
  return admin.permissions.includes(permission);
}

/**
 * Levée quand `admin_me()` n'existe pas encore dans la base.
 *
 * Ce n'est PAS un refus d'accès et il ne faut surtout pas le traiter
 * comme tel : un 404 poli ferait chercher un bug d'autorisation pendant
 * une heure, alors que la cause est « la migration 0075 n'est pas
 * appliquée ». On préfère une panne bruyante et exacte.
 */
export class ControlCenterNotDeployed extends Error {
  constructor(detail: string) {
    super(
      "Le socle du Control Center est absent de la base : " +
        detail +
        " — appliquez supabase/migrations/0075_control_center.sql, puis posez le premier " +
        "administrateur à la main (voir la section 6 de la migration). " +
        "Si la migration vient d'être appliquée, le cache de schéma de PostgREST peut " +
        "avoir une minute de retard : rechargez-le avant de chercher plus loin.",
    );
    this.name = "ControlCenterNotDeployed";
  }
}

/**
 * La fiche de l'appelant, résolue UNE fois par requête.
 *
 * `cache()` de React déduplique l'appel à l'intérieur d'un même rendu :
 * la coquille et la page appellent toutes deux la garde, et il n'y a
 * qu'un aller-retour vers la base. Le cache ne survit pas à la requête
 * — c'est ce qu'on veut : une révocation prend effet au rafraîchissement
 * suivant, pas au bout d'un TTL.
 *
 * Rend `null` pour « connecté, mais pas administrateur de plateforme ».
 * Redirige vers `/login` pour « pas connecté du tout ».
 */
const resolveAdmin = cache(async (): Promise<AdminIdentity | null> => {
  // (1) L'identité, vérifiée auprès du serveur Auth — jamais le cookie
  //     seul. R3 de la migration 0075.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // (2) Est-ce un administrateur de plateforme ? La question est posée
  //     à la BASE, pas à un jeton ni à une liste dans le code. La
  //     réponse vient de `platform_admins`, une table sans aucune
  //     politique d'écriture : personne ne s'y ajoute depuis le
  //     navigateur.
  //
  //     Appelée avec la session de l'administrateur, jamais avec
  //     `service_role` : `admin_me()` s'authentifie par `auth.uid()`,
  //     qui serait nul sous une clé de service.
  const { data, error } = await supabase.rpc("admin_me");

  if (error) {
    // 42501 — `admin_me()` a levé « Accès refusé ». C'est la réponse
    // NORMALE pour un utilisateur ordinaire, pas une panne :
    //
    //     if not public.is_platform_admin() then
    //       raise exception 'Accès refusé : réservé aux administrateurs
    //         de la plateforme Oasis Care.' using errcode = '42501';
    //
    // PostgREST reporte le SQLSTATE dans `error.code`. Le message est
    // testé EN PLUS du code, et pas à sa place : si un jour la couche
    // REST changeait sa façon de reporter le SQLSTATE, un
    // non-administrateur recevrait une erreur 500 au lieu d'un 404 —
    // ce qui, en plus d'être laid, lui apprendrait qu'il vient de
    // toucher quelque chose.
    const refused =
      error.code === "42501" ||
      (typeof error.message === "string" && error.message.includes("Accès refusé"));
    if (refused) return null;

    // PGRST202 : PostgREST ne trouve pas la fonction dans son cache de
    // schéma. 42883 : Postgres ne la connaît pas du tout.
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new ControlCenterNotDeployed("la fonction admin_me() est introuvable");
    }

    throw new Error(
      `Impossible de résoudre l'identité administrateur : ${error.message} (${error.code ?? "sans code"}).`,
    );
  }

  // `admin_me()` rend une table : une ligne pour un administrateur,
  // aucune si sa fiche a disparu entre le contrôle et la lecture.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  const permissions: string[] = Array.isArray(row.permissions) ? row.permissions : [];

  return {
    userId: row.user_id,
    email: user.email ?? null,
    role: row.role,
    permissions,
    since: row.since ?? null,
    mfa: await readMfaState(supabase),
  };
});

/**
 * La garde. À appeler en PREMIÈRE instruction de chaque page, de chaque
 * layout et de chaque Server Action du Control Center.
 *
 * @param permission Si fournie, le rôle doit la porter. La chaîne est
 *   typée : une permission mal orthographiée ne compile pas. Une
 *   permission qui n'existerait pas dans le catalogue refuserait tout
 *   le monde en silence, ce qui ressemble exactement à un
 *   fonctionnement normal — le pire mode de défaillance d'un contrôle
 *   d'accès.
 */
export async function requireAdmin(permission?: PlatformPermission): Promise<AdminIdentity> {
  const admin = await resolveAdmin();

  // Connecté, mais pas des nôtres. Il n'apprend pas ce qu'il a manqué.
  if (!admin) notFound();

  // Le second facteur, quand l'exploitation l'exige (spec p.32 :
  // « préparer OU EXIGER une authentification renforcée »). Le contrôle
  // est ici, après l'identité et AVANT la permission : un
  // administrateur dont la session n'est pas de niveau `aal2` n'atteint
  // aucun écran, quel que soit son rôle.
  //
  // `blocking` est faux tant que `ADMIN_MFA_POLICY` ne vaut pas
  // `require` — voir `lib/auth/mfa.ts`, qui est le seul endroit où la
  // décision se calcule. Cette ligne est le seul endroit où elle
  // s'applique.
  //
  // `/second-facteur` vit HORS du groupe `(control)` : sa page est
  // servie par le layout racine et n'appelle pas cette garde, sans quoi
  // la redirection se renverrait à elle-même indéfiniment.
  if (admin.mfa.blocking) redirect("/second-facteur");

  if (permission !== undefined) {
    // Garde-fou de développement : une chaîne hors catalogue est une
    // faute de frappe, pas une politique. On le dit fort.
    if (!isPlatformPermission(permission)) {
      throw new Error(
        `Permission inconnue du catalogue : « ${permission} ». Voir lib/auth/roles.ts et la table platform_admin_permissions.`,
      );
    }

    if (!admin.permissions.includes(permission)) {
      // Un administrateur légitime au rôle trop étroit : on le lui dit.
      redirect(`/role-insuffisant?permission=${encodeURIComponent(permission)}`);
    }
  }

  return admin;
}

/**
 * La même chose, sans refuser : pour la coquille, qui doit savoir QUI
 * est là afin de n'afficher que les entrées ouvertes à son rôle.
 *
 * Rend `null` plutôt que de renvoyer un non-administrateur : la
 * décision de fermer appartient à `requireAdmin()`, et la dupliquer
 * ici multiplierait les endroits capables de laisser passer quelqu'un.
 */
export async function currentAdmin(): Promise<AdminIdentity | null> {
  return resolveAdmin();
}
