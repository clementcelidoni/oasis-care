"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  requireOrganization,
  ACTIVE_ORGANIZATION_COOKIE,
} from "@/lib/auth/organization";
import { ROLES, type Role } from "@/lib/auth/permissions";

/**
 * §14 ÉQUIPE — « Inviter un membre », « Modifier rôle », « Désactiver
 * accès ».
 *
 * Ces trois gestes touchent QUI PEUT ENTRER dans le logiciel. Ils sont
 * donc écrits avec la même prudence qu'une porte : la politique RLS de
 * `organization_members` (migration 0043) exige déjà
 * `organization.manageUsers`, et rien de ce qui suit ne peut la
 * contourner. Ce que ce fichier ajoute par-dessus, ce sont les trois
 * garde-fous que la base ne peut PAS poser toute seule, parce qu'ils
 * relèvent du bon sens et non du droit d'accès :
 *
 *  1. On ne se modifie pas soi-même. Un administrateur qui se rétrograde
 *     par erreur ne peut plus revenir en arrière — il faudrait quelqu'un
 *     d'autre, et dans une entreprise de trois personnes il n'y a
 *     souvent personne d'autre.
 *  2. Le DERNIER propriétaire actif reste propriétaire et reste actif.
 *     Une organisation sans propriétaire est une organisation dont plus
 *     personne ne peut confier les clés.
 *  3. Seul un propriétaire nomme un propriétaire.
 *
 * Le retour d'information passe par un code dans l'URL plutôt que par
 * un état React : ces gestes sont des clics uniques, sans champ à
 * préserver, et un code dans l'URL survit au rechargement. Aucune de
 * ces valeurs ne contient de donnée personnelle — surtout pas une
 * adresse e-mail, qui n'a rien à faire dans un historique de
 * navigation.
 */

const TEAM_PATH = "/entreprise/equipe";

/**
 * `custom` est délibérément absent des rôles attribuables ici.
 *
 * Il ne veut rien dire tant que `custom_permissions` n'est pas
 * renseigné, et l'attribuer depuis une simple liste déroulante
 * reviendrait à retirer tous les droits à quelqu'un en croyant lui en
 * donner de sur-mesure.
 */
function isAssignableRole(value: string): value is Role {
  return value !== "custom" && (ROLES as readonly string[]).includes(value);
}

function back(code: string): never {
  revalidatePath(TEAM_PATH);
  redirect(`${TEAM_PATH}?message=${code}`);
}

// ---------------------------------------------------------------
// §14 « Modifier rôle »
// ---------------------------------------------------------------

export async function updateMemberRole(formData: FormData) {
  const organization = await requireOrganization();
  const user = await getCurrentUser();

  const memberId = String(formData.get("member_id") ?? "");
  const nextRole = String(formData.get("role") ?? "");
  if (!memberId || !isAssignableRole(nextRole)) back("role-invalide");

  const supabase = await createClient();

  // L'appartenance est relue en base plutôt que prise dans le
  // formulaire : un identifiant de membre posté à la main pourrait
  // désigner une autre organisation, et `.eq(organization_id)` est ce
  // qui l'en empêche avant même que RLS ne s'en mêle.
  const { data: member } = await supabase
    .from("organization_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("organization_id", organization.organizationId)
    .maybeSingle();
  if (!member) back("membre-introuvable");

  if (member.user_id === user?.id) back("soi-meme");
  if (member.role === nextRole) back("aucun-changement");
  if (nextRole === "owner" && organization.role !== "owner") back("proprietaire-reserve");

  if (member.role === "owner" && (await lastActiveOwner(organization.organizationId))) {
    back("dernier-proprietaire");
  }

  const { error } = await supabase
    .from("organization_members")
    .update({ role: nextRole, updated_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("organization_id", organization.organizationId);
  if (error) throw new Error(error.message);

  // Le rôle gouverne le menu latéral et la moitié des boutons du
  // produit : c'est toute la mise en page qu'il faut réinvalider, pas
  // seulement cet écran.
  revalidatePath("/", "layout");
  redirect(`${TEAM_PATH}?message=role-modifie`);
}

// ---------------------------------------------------------------
// §14 « Désactiver accès » — et le rétablir
// ---------------------------------------------------------------

/**
 * `archived_at` plutôt qu'un `delete`.
 *
 * Supprimer la ligne effacerait aussi la trace de qui a fait quoi : les
 * chantiers, les devis et les pointages continuent de référencer cette
 * personne. Un accès coupé se rétablit ; une ligne supprimée ne se
 * retrouve pas.
 */
export async function setMemberAccess(formData: FormData) {
  const organization = await requireOrganization();
  const user = await getCurrentUser();

  const memberId = String(formData.get("member_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!memberId) back("membre-introuvable");

  const supabase = await createClient();
  const { data: member } = await supabase
    .from("organization_members")
    .select("id, user_id, role, archived_at")
    .eq("id", memberId)
    .eq("organization_id", organization.organizationId)
    .maybeSingle();
  if (!member) back("membre-introuvable");

  if (member.user_id === user?.id) back("soi-meme");

  if (!active && member.role === "owner" && (await lastActiveOwner(organization.organizationId))) {
    back("dernier-proprietaire");
  }

  const { error } = await supabase
    .from("organization_members")
    .update({
      archived_at: active ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", memberId)
    .eq("organization_id", organization.organizationId);
  if (error) throw new Error(error.message);

  revalidatePath("/", "layout");
  redirect(`${TEAM_PATH}?message=${active ? "acces-retabli" : "acces-desactive"}`);
}

/** Vrai s'il ne reste qu'un seul propriétaire actif dans l'organisation. */
async function lastActiveOwner(organizationId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .is("archived_at", null);
  return (count ?? 0) <= 1;
}

// ---------------------------------------------------------------
// §14 « Inviter un membre »
// ---------------------------------------------------------------

export type InviteResult =
  | { status: "idle" }
  | { status: "done"; email: string }
  | { status: "error"; message: string };

/**
 * L'invitation CRÉE UNE LIGNE ET UN LIEN. Elle n'envoie rien.
 *
 * Le projet n'a aucun service d'envoi d'e-mail — ni Resend, ni
 * Postmark, ni Edge Function de messagerie. Un bouton « Envoyer » ne
 * ferait donc que mentir, et l'écran `/parametres` disait déjà cette
 * limite plutôt que de la maquiller. On produit le lien, la personne le
 * colle dans son propre courriel : c'est exactement ce que fait déjà
 * l'invitation au portail client.
 *
 * Contrairement aux gestes ci-dessus, celui-ci a un champ de saisie à
 * préserver, d'où un résultat rendu à l'écran plutôt qu'un code dans
 * l'URL — on ne remet pas une adresse e-mail dans une barre d'adresse.
 */
export async function inviteMember(
  _previous: InviteResult,
  formData: FormData,
): Promise<InviteResult> {
  const organization = await requireOrganization();
  const user = await getCurrentUser();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "");

  // Une validation volontairement grossière : la seule vérification qui
  // vaille pour une adresse, c'est qu'elle reçoive le message. Ici on
  // écarte les fautes de frappe évidentes, rien de plus.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { status: "error", message: "Cette adresse e-mail ne semble pas valide." };
  }
  if (!isAssignableRole(role)) {
    return { status: "error", message: "Choisissez un rôle." };
  }
  if (role === "owner" && organization.role !== "owner") {
    return {
      status: "error",
      message: "Seul un propriétaire peut inviter un autre propriétaire.",
    };
  }

  const supabase = await createClient();

  // Une seule invitation en attente par adresse. Deux liens valides
  // pour la même personne, c'est un lien de trop qui traîne dans une
  // boîte mail — et personne ne sait plus lequel révoquer.
  const { data: existing } = await supabase
    .from("organization_invitations")
    .select("id")
    .eq("organization_id", organization.organizationId)
    .eq("status", "pending")
    .ilike("email", email)
    .maybeSingle();
  if (existing) {
    return {
      status: "error",
      message:
        "Une invitation est déjà en attente pour cette adresse. Révoquez-la avant d'en créer une autre.",
    };
  }

  const { error } = await supabase.from("organization_invitations").insert({
    organization_id: organization.organizationId,
    email,
    role,
    invited_by: user?.id ?? null,
  });
  if (error) return { status: "error", message: error.message };

  revalidatePath(TEAM_PATH);
  return { status: "done", email };
}

/** Le lien cesse d'ouvrir la porte, sans effacer la trace de l'invitation. */
export async function revokeInvitation(formData: FormData) {
  const organization = await requireOrganization();

  const invitationId = String(formData.get("invitation_id") ?? "");
  if (!invitationId) back("invitation-introuvable");

  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("organization_id", organization.organizationId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  revalidatePath(TEAM_PATH);
  redirect(`${TEAM_PATH}?message=invitation-revoquee`);
}

// ---------------------------------------------------------------
// L'autre bout du lien
// ---------------------------------------------------------------

/**
 * Accepter une invitation d'équipe.
 *
 * Tout le contrôle est dans `accept_organization_invitation()` (0043) :
 * jeton existant, encore en attente, non expiré, et surtout ÉMIS POUR
 * L'ADRESSE DU DEMANDEUR. Le jeton seul ne suffit donc pas — quelqu'un
 * qui intercepterait le lien n'entrerait pas avec son propre compte.
 *
 * Le cookie d'organisation active est posé au passage : sans lui, un
 * invité qui appartient déjà à une autre entreprise atterrirait dans
 * celle-là, se demanderait où est passée l'invitation qu'il vient
 * d'accepter, et recliquerait sur un lien désormais consommé.
 */
export async function acceptTeamInvitation(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/");

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/invitation/equipe/${encodeURIComponent(token)}`);

  const supabase = await createClient();
  const { data: organizationId, error } = await supabase.rpc(
    "accept_organization_invitation",
    { invitation_token: token },
  );
  if (error) throw new Error(error.message);

  if (typeof organizationId === "string") {
    const store = await cookies();
    store.set(ACTIVE_ORGANIZATION_COOKIE, organizationId, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath("/", "layout");
  redirect("/");
}
