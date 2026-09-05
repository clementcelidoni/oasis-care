"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { can, currentAdmin, requireAdmin } from "@/lib/auth/guard";
import { createPrivilegedClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PLATFORM_ROLES, roleLabel, type PlatformRole } from "@/lib/auth/roles";

/**
 * ==================================================================
 * LES ÉCRITURES DE « PARAMÈTRES » ET D'« ÉQUIPE »
 * ==================================================================
 *
 * Aucune de ces fonctions n'écrit dans une table. Elles appellent les
 * fonctions `security definer` de la migration 0081, qui sont le SEUL
 * chemin : `platform_admins`, `platform_admin_invitations` et
 * `platform_security_settings` n'ont aucune politique d'écriture, et
 * `authenticated` n'y a aucun droit `insert`/`update`/`delete`.
 *
 * Chaque fonction de 0081 exige `platform_admin_can(…)`, refuse un motif
 * vide, relève l'ancienne valeur, écrit la nouvelle, et rend
 * l'identifiant de sa ligne de journal. LA TRACE N'EST PAS UN EFFET DE
 * BORD : c'est la valeur de retour. Si `record_admin_event()` refuse,
 * l'écriture est annulée avec elle — il n'existe pas d'état « changé
 * mais non tracé ». Ce fichier n'a donc rien à journaliser lui-même, et
 * ne doit surtout pas essayer : une seconde ligne écrite depuis
 * TypeScript pourrait manquer là où la première ne peut pas.
 *
 * ------------------------------------------------------------------
 * TROIS BARRIÈRES, ET AUCUNE NE SUPPOSE QUE LES AUTRES ONT TENU
 * ------------------------------------------------------------------
 *   1. `requireAdmin()` ici. Une Server Action est une URL : elle ne
 *      passe PAS par le layout, et sans cet appel elle serait la seule
 *      porte du Control Center laissée ouverte.
 *   2. `can(admin, …)` ici aussi, qui rend un MESSAGE plutôt qu'une
 *      redirection — dans un formulaire, une redirection perd la saisie
 *      et n'explique rien.
 *   3. `platform_admin_can(…)` dans la fonction SQL, la seule barrière
 *      qu'aucun remaniement de ce fichier ne peut déplacer. Et, depuis
 *      0081, `platform_admin_require_mfa()` juste après : une session
 *      qui n'a pas présenté son second facteur n'écrit rien, même avec
 *      la bonne permission.
 */

export type EtatFormulaire = {
  statut: "vierge" | "ok" | "erreur";
  message: string | null;
};

export const ETAT_VIERGE: EtatFormulaire = { statut: "vierge", message: null };

/**
 * Traduit le refus d'une fonction de 0081.
 *
 * Les messages de 0081 sont écrits en français et disent exactement ce
 * qui a été refusé et pourquoi — « On ne se révoque pas soi-même »,
 * « Dernier super-administrateur actif », « Second facteur exigé ». On
 * les affiche TELS QUELS plutôt que de les remplacer par une phrase de
 * notre cru. Le SQLSTATE ne sert qu'à choisir la mise en contexte.
 */
function messageDeLErreur(operation: string, error: { message: string; code?: string }): string {
  switch (error.code) {
    case "42501":
      return `${operation} : la base a refusé. ${error.message}`;
    case "23514":
    case "23505":
    case "23503":
      return error.message;
    case "PGRST202":
    case "42883":
      return (
        `${operation} : la fonction n'existe pas dans la base. La migration ` +
        "0081_control_center_suite.sql n'est probablement pas appliquée — ou le cache de " +
        "schéma de PostgREST n'a pas encore été rechargé."
      );
    default:
      return `${operation} : ${error.message} (${error.code ?? "sans code"}).`;
  }
}

function lireTexte(formData: FormData, nom: string): string | null {
  const brut = formData.get(nom);
  if (typeof brut !== "string") return null;
  const valeur = brut.trim();
  return valeur.length === 0 ? null : valeur;
}

function lireIdentifiant(formData: FormData, nom: string): string | null {
  const valeur = lireTexte(formData, nom);
  // Un uuid, ou rien. Sans ce contrôle, une chaîne arbitraire partirait
  // dans un paramètre `uuid` et PostgREST répondrait par une erreur de
  // conversion illisible plutôt que par « compte inconnu ».
  return valeur !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valeur)
    ? valeur
    : null;
}

function lireRole(formData: FormData, nom = "role"): PlatformRole | null {
  const valeur = lireTexte(formData, nom);
  return valeur !== null && (PLATFORM_ROLES as readonly string[]).includes(valeur)
    ? (valeur as PlatformRole)
    : null;
}

/**
 * L'adresse, normalisée EXACTEMENT comme la base le fait.
 *
 * `platform_admin_invitations.email` a pour contrainte
 * `email = lower(btrim(email))` : une adresse envoyée en capitales
 * serait refusée par la contrainte plutôt que par une validation, avec
 * un message de contrainte que personne ne veut lire. On normalise donc
 * du même geste ici, et l'écran affiche ce qui sera réellement écrit.
 */
function lireAdresse(formData: FormData): string | null {
  const brut = formData.get("email");
  if (typeof brut !== "string") return null;
  const valeur = brut.trim().toLowerCase();
  if (valeur.indexOf("@") < 1 || valeur.length > 320) return null;
  return valeur;
}

const REFUS_GESTION =
  "Nommer, changer de rôle ou révoquer un administrateur demande la permission " +
  "platform.admins.manage, que la migration 0081 réserve au seul super-administrateur — " +
  "et son garde-fou refuse littéralement de l'accorder à un autre rôle. Ce n'est pas un " +
  "oubli de configuration : c'est la règle.";

// ==================================================================
// 1. Nommer un administrateur qui a déjà un compte
// ==================================================================

export async function nommerAdministrateur(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "platform.admins.manage")) {
    return { statut: "erreur", message: REFUS_GESTION };
  }

  const userId = lireIdentifiant(formData, "userId");
  if (userId === null) {
    return {
      statut: "erreur",
      message:
        "Identifiant de compte absent ou mal formé. Il se trouve sur la fiche de la personne, dans « Afficher détails techniques ».",
    };
  }

  const role = lireRole(formData);
  if (role === null) {
    return { statut: "erreur", message: "Rôle absent ou inconnu du catalogue." };
  }

  const motif = lireTexte(formData, "motif");
  if (motif === null) {
    return {
      statut: "erreur",
      message:
        "Motif obligatoire : donner à quelqu'un le droit de voir toutes les entreprises se justifie au moment où on le fait.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_grant_platform_admin", {
    p_user_id: userId,
    p_role: role,
    p_reason: motif,
    p_note: lireTexte(formData, "note"),
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Nommer cet administrateur", error) };
  }

  revalidatePath("/equipe");
  return {
    statut: "ok",
    message: `Nommé « ${roleLabel(role)} », et journalisé. La personne verra le Control Center à sa prochaine visite.`,
  };
}

// ==================================================================
// 2. Changer le rôle
// ==================================================================

export async function changerRole(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "platform.admins.manage")) {
    return { statut: "erreur", message: REFUS_GESTION };
  }

  const userId = lireIdentifiant(formData, "userId");
  const role = lireRole(formData);
  const motif = lireTexte(formData, "motif");

  if (userId === null) return { statut: "erreur", message: "Compte absent du formulaire." };
  if (role === null) return { statut: "erreur", message: "Rôle absent ou inconnu du catalogue." };
  if (motif === null) {
    return {
      statut: "erreur",
      message: "Motif obligatoire : un changement de rôle change ce que la personne peut faire.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_change_platform_admin_role", {
    p_user_id: userId,
    p_role: role,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Changer ce rôle", error) };
  }

  revalidatePath("/equipe");
  return { statut: "ok", message: `Rôle changé en « ${roleLabel(role)} », et journalisé.` };
}

// ==================================================================
// 3. Révoquer
// ==================================================================

/**
 * LES DEUX GARDE-FOUS SONT DÉJÀ MONTRÉS À L'ÉCRAN — le bouton de son
 * propre compte n'existe pas, celui du dernier super-administrateur est
 * désactivé avec la raison affichée. Ils sont revérifiés ici, et une
 * troisième fois par la fonction SQL, et une quatrième par le
 * déclencheur `platform_admins_last_super_admin_guard`.
 *
 * Ce n'est pas de la ceinture et des bretelles : une Server Action est
 * une URL, et un formulaire peut lui être posté sans passer par
 * l'écran qui a désactivé le bouton.
 */
export async function revoquerAdministrateur(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "platform.admins.manage")) {
    return { statut: "erreur", message: REFUS_GESTION };
  }

  const userId = lireIdentifiant(formData, "userId");
  const motif = lireTexte(formData, "motif");

  if (userId === null) return { statut: "erreur", message: "Compte absent du formulaire." };
  if (motif === null) {
    return {
      statut: "erreur",
      message: "Motif obligatoire : une révocation se relit un jour, et il faut qu'elle se comprenne.",
    };
  }

  if (userId === admin.userId) {
    return {
      statut: "erreur",
      message:
        "On ne se révoque pas soi-même : vous vous enfermeriez dehors, et si vous êtes le dernier super-administrateur, vous enfermeriez toute l'équipe. Demandez à un collègue.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_revoke_platform_admin", {
    p_user_id: userId,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Révoquer cet administrateur", error) };
  }

  revalidatePath("/equipe");
  return {
    statut: "ok",
    message:
      "Révoqué et journalisé. Les sessions d'assistance que cette personne avait ouvertes sont refermées dans le même geste.",
  };
}

// ==================================================================
// 4. Inviter quelqu'un qui n'a pas encore de compte
// ==================================================================

/**
 * L'origine du déploiement, telle que la requête la porte.
 *
 * Elle sert à construire le lien de retour de l'e-mail d'invitation.
 * Aucune variable d'environnement à tenir à jour, donc pas de lien qui
 * pointe vers `localhost:3100` depuis la production le jour où l'on
 * oublie de la changer.
 */
async function origineDuDeploiement(): Promise<string | null> {
  const entetes = await headers();
  const hote = entetes.get("x-forwarded-host") ?? entetes.get("host");
  if (!hote) return null;
  const protocole =
    entetes.get("x-forwarded-proto") ??
    (hote.startsWith("localhost") || hote.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocole}://${hote}`;
}

/**
 * ------------------------------------------------------------------
 * POURQUOI IL FAUT LES DEUX MOITIÉS, ET DANS CET ORDRE
 * ------------------------------------------------------------------
 * (1) LA BASE D'ABORD. `admin_invite_platform_admin()` enregistre
 *     l'INTENTION — cette adresse, ce rôle, ce motif, jusqu'à cette date
 *     — et la journalise. Elle ne peut pas faire plus : aucune ligne de
 *     SQL ne peut créer un utilisateur `auth`.
 *
 * (2) LE COMPTE ENSUITE, par `auth.admin.inviteUserByEmail()`, donc par
 *     `service_role`, donc côté serveur uniquement. CETTE MOITIÉ N'EST
 *     PAS FACULTATIVE ICI, et c'est une particularité de ce déploiement
 *     qu'il faut connaître : la page de connexion appelle
 *     `signInWithOtp({ shouldCreateUser: false })`. Un collègue sans
 *     compte ne peut donc PAS se créer le sien par lien magique — le
 *     Control Center refuse délibérément de fabriquer des comptes. Sans
 *     cet appel, l'invitation resterait une intention que personne ne
 *     pourrait jamais réclamer.
 *
 * (3) LA RÉCLAMATION, enfin, se fait toute seule : à la première visite,
 *     `resolveAdmin()` appelle `claim_platform_admin_invitation()` quand
 *     `admin_me()` refuse. Voir `lib/auth/guard.ts`.
 *
 * SI (2) ÉCHOUE, (1) TIENT TOUJOURS — et on le dit. L'invitation est
 * enregistrée ; il ne manque que le courriel. Annuler (1) par
 * compensation serait pire : deux écritures qui se défont mutuellement
 * hors transaction finissent toujours par laisser un état bâtard.
 */
export async function inviterAdministrateur(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "platform.admins.manage")) {
    return { statut: "erreur", message: REFUS_GESTION };
  }

  const email = lireAdresse(formData);
  if (email === null) {
    return { statut: "erreur", message: "Adresse e-mail absente ou mal formée." };
  }

  const role = lireRole(formData);
  if (role === null) return { statut: "erreur", message: "Rôle absent ou inconnu du catalogue." };

  const motif = lireTexte(formData, "motif");
  if (motif === null) {
    return {
      statut: "erreur",
      message: "Motif obligatoire : on n'invite pas quelqu'un dans l'administration sans dire pourquoi.",
    };
  }

  const joursBrut = lireTexte(formData, "jours");
  const jours = joursBrut === null ? 14 : Number.parseInt(joursBrut, 10);
  if (!Number.isInteger(jours) || jours < 1 || jours > 90) {
    return {
      statut: "erreur",
      message:
        "Une invitation vaut entre 1 et 90 jours. Elle EXPIRE, et c'est voulu : une invitation sans fin est une porte laissée entrouverte.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_invite_platform_admin", {
    p_email: email,
    p_role: role,
    p_reason: motif,
    p_note: lireTexte(formData, "note"),
    p_valid_days: jours,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Enregistrer cette invitation", error) };
  }

  revalidatePath("/equipe");

  // ---- (2) Le compte et le courriel -------------------------------
  const origine = await origineDuDeploiement();
  try {
    const privilegie = createPrivilegedClient(admin, "platform.admins.manage", motif);
    const { error: erreurInvite } = await privilegie.auth.admin.inviteUserByEmail(email, {
      // Toujours `/auth/callback`, jamais un paramètre de destination :
      // le Control Center a une seule porte d'entrée, et une redirection
      // ouverte est une redirection à valider, à tester et à réparer un
      // jour. Cette URL doit figurer dans la liste des redirections
      // autorisées du projet Supabase, sinon le lien retombera sur le
      // site par défaut.
      redirectTo: origine ? `${origine}/auth/callback` : undefined,
    });

    if (erreurInvite) {
      return {
        statut: "erreur",
        message:
          `L'invitation est ENREGISTRÉE et journalisée pour ${email} (rôle « ${roleLabel(role)} »), ` +
          `mais le courriel n'est pas parti : ${erreurInvite.message}. ` +
          "Le compte doit exister pour que l'invitation puisse être réclamée — la connexion par " +
          "lien magique de cette application ne crée volontairement aucun compte. Faites créer le " +
          "compte depuis le tableau de bord Supabase, puis dites à la personne de se connecter : " +
          "son invitation sera réclamée automatiquement.",
      };
    }
  } catch (erreur) {
    return {
      statut: "erreur",
      message:
        `L'invitation est ENREGISTRÉE et journalisée pour ${email}, mais l'envoi du courriel a ` +
        `échoué : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    };
  }

  return {
    statut: "ok",
    message:
      `Invitation enregistrée et courriel envoyé à ${email} (rôle « ${roleLabel(role)} », ${jours} jours). ` +
      "À sa première connexion, son rôle lui sera attribué automatiquement, et la ligne de journal " +
      "portera VOTRE nom — c'est vous qui avez décidé, pas elle.",
  };
}

export async function retirerInvitation(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "platform.admins.manage")) {
    return { statut: "erreur", message: REFUS_GESTION };
  }

  const email = lireAdresse(formData);
  const motif = lireTexte(formData, "motif");

  if (email === null) return { statut: "erreur", message: "Adresse absente du formulaire." };
  if (motif === null) return { statut: "erreur", message: "Motif obligatoire." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_revoke_platform_admin_invitation", {
    p_email: email,
    p_reason: motif,
  });

  if (error) {
    return { statut: "erreur", message: messageDeLErreur("Retirer cette invitation", error) };
  }

  revalidatePath("/equipe");
  return {
    statut: "ok",
    message:
      "Invitation retirée et journalisée. Si un compte a déjà été créé pour cette adresse, il " +
      "existe toujours — il n'est simplement plus administrateur en devenir.",
  };
}

// ==================================================================
// 5. La politique de second facteur de l'équipe
// ==================================================================

/**
 * ATTENTION À L'ORDRE D'EXPLOITATION, et c'est la seule chose vraiment
 * dangereuse de ce fichier.
 *
 * Basculer l'exigence AVANT que l'équipe ne se soit enrôlée renvoie tout
 * le monde sur `/second-facteur`. Ce n'est plus un enfermement depuis
 * que cette page porte l'écran d'enrôlement — chacun peut poser son
 * facteur et revenir. Mais un cas reste ouvert : si l'enrôlement TOTP
 * était désactivé au niveau du PROJET Supabase, personne ne pourrait
 * plus poser de facteur, et la seule sortie serait
 * `ADMIN_MFA_POLICY=off` dans l'environnement, suivie d'un
 * redéploiement.
 *
 * D'où l'ordre recommandé, écrit aussi à l'écran : livrer, s'enrôler,
 * VÉRIFIER qu'une session `aal2` s'obtient réellement, et seulement
 * alors exiger.
 *
 * `admin_set_mfa_policy()` est d'ailleurs la seule fonction de 0081 qui
 * ne s'auto-exige pas le second facteur : la protéger par elle-même
 * serait une porte fermée à clé de l'intérieur.
 */
export async function reglerPolitiqueMfa(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const admin = await requireAdmin();
  if (!can(admin, "platform.security.write")) {
    return {
      statut: "erreur",
      message: `Le rôle « ${roleLabel(admin.role)} » ne porte pas la permission platform.security.write : la politique de second facteur de l'équipe lui est fermée.`,
    };
  }

  const exige = formData.get("exige") === "oui";
  const motif = lireTexte(formData, "motif");
  if (motif === null) {
    return {
      statut: "erreur",
      message: "Motif obligatoire : exiger ou lever le second facteur change qui peut agir, cela se justifie.",
    };
  }

  // La date de mise en application. Vide = tout de suite. Elle n'a de
  // sens que si l'on exige : la base refuse d'ailleurs un délai de grâce
  // sans exigence (`platform_security_settings_grace_coherent`).
  const aPartirDe = lireTexte(formData, "aPartirDe");
  let quand: string | null = null;
  if (exige && aPartirDe !== null) {
    const date = new Date(aPartirDe);
    if (Number.isNaN(date.getTime())) {
      return { statut: "erreur", message: "Date de mise en application illisible." };
    }
    quand = date.toISOString();
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_mfa_policy", {
    p_required: exige,
    p_required_from: quand,
    p_reason: motif,
  });

  if (error) {
    return {
      statut: "erreur",
      message: messageDeLErreur("Régler la politique de second facteur", error),
    };
  }

  revalidatePath("/parametres");
  revalidatePath("/parametres/securite");
  revalidatePath("/", "layout");

  if (!exige) {
    return {
      statut: "ok",
      message:
        "Exigence levée et journalisée. Les écritures administratives redeviennent possibles sans second facteur — c'est un retour en arrière, pas un réglage de confort.",
    };
  }

  return {
    statut: "ok",
    message: quand
      ? `Exigence enregistrée et journalisée : elle mordra le ${new Date(quand).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}. D'ici là, prévenez l'équipe et vérifiez que chacun s'est enrôlé.`
      : "Exigence enregistrée et journalisée, et elle s'applique DÈS MAINTENANT. Toute session sans second facteur est renvoyée vers l'écran d'enrôlement.",
  };
}

// ==================================================================
// 6. La trace des gestes de second facteur
// ==================================================================

/**
 * POURQUOI CETTE FONCTION EXISTE, ALORS QUE TOUT LE RESTE DU FICHIER
 * REFUSE DE JOURNALISER DEPUIS TYPESCRIPT.
 *
 * Parce qu'ici il n'y a pas de fonction SQL à appeler : l'enrôlement
 * d'un facteur TOTP et son retrait appartiennent au service Auth de
 * Supabase, qui n'écrit rien dans `admin_audit_events`. Aucune ligne de
 * SQL ne peut créer ni supprimer un facteur, donc aucune fonction de
 * 0081 ne peut porter cette trace.
 *
 * LE RETRAIT EST LE GESTE QUI COMPTE. Retirer un facteur vérifié fait
 * RETOMBER le compte sous l'exigence, et c'est exactement le geste qu'un
 * compte compromis tenterait. Il doit se relire dans le journal.
 *
 * ET LA TRACE NE DOIT JAMAIS BLOQUER LE GESTE. Si `record_admin_event()`
 * refuse — un analyste en lecture seule, par exemple, qui a parfaitement
 * le droit de protéger son propre compte mais à qui la base interdit
 * nommément d'écrire une ligne de journal —, l'enrôlement reste valide.
 * On rend l'échec, l'écran le dit, et personne ne se retrouve empêché de
 * se protéger par une écriture d'audit.
 */
export async function journaliserGesteMfa(
  action: "mfa.enrolled" | "mfa.unenrolled",
  detail: { friendlyName?: string | null },
): Promise<{ tracee: boolean; message: string | null }> {
  // `currentAdmin()` et NON `requireAdmin()`, et c'est un cas où la
  // différence compte. `requireAdmin()` redirige vers `/second-facteur`
  // quand la session ne satisfait pas l'exigence — or c'est EXACTEMENT
  // l'état dans lequel on se trouve juste après avoir retiré son
  // facteur : la ligne de journal du retrait ne serait jamais écrite, et
  // l'appelant recevrait une navigation surprise à la place. Le geste le
  // plus intéressant à tracer serait le seul qu'on ne tracerait pas.
  //
  // Rien n'est ouvert pour autant : `record_admin_event()` refuse en SQL
  // quiconque n'est pas administrateur de plateforme, impose `auth.uid()`
  // comme auteur, et cette fonction n'écrit rien d'autre.
  const admin = await currentAdmin();
  if (!admin) {
    return { tracee: false, message: "Session non reconnue : rien n'a été journalisé." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_admin_event", {
    p_action: action,
    p_target_type: "platform_admin",
    p_target_id: admin.userId,
    p_target_label: admin.email,
    p_old_value: null,
    // Ni le secret, ni l'URI, ni le QR code : le SDK dit explicitement de
    // ne jamais les journaliser, et un journal d'administration est
    // précisément l'endroit où ils survivraient le plus longtemps.
    p_new_value: { friendlyName: detail.friendlyName ?? null },
    p_reason:
      action === "mfa.enrolled"
        ? "Second facteur enrôlé et vérifié par son porteur."
        : "Second facteur retiré par son porteur.",
  });

  if (error) {
    return {
      tracee: false,
      message: `Le geste a bien eu lieu, mais il n'a pas pu être journalisé : ${error.message}`,
    };
  }

  revalidatePath("/parametres");
  revalidatePath("/equipe");
  revalidatePath("/", "layout");
  return { tracee: true, message: null };
}
