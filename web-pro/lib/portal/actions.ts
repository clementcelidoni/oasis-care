"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";

/**
 * §11S côté CLIENT.
 *
 * Deux gestes, et deux seulement : accepter l'invitation, et retirer
 * l'accès du professionnel à son jardin. Le portail est en lecture pour
 * tout le reste — un client ne modifie ni son devis ni sa facture, et
 * lui en donner le pouvoir depuis ici ferait de chaque écran un
 * formulaire à protéger.
 */

/**
 * §"Le client crée un compte Oasis Care (gratuit)" — puis ce lien
 * rattache ce compte à sa fiche.
 *
 * `accept_client_invitation` est en `security definer` : celui qui
 * accepte n'est encore membre de rien et n'a aucun droit sur la table
 * des invitations. Le jeton est sa seule preuve, et la fonction vérifie
 * qu'il n'a pas expiré et n'a pas déjà servi.
 */
export async function acceptInvitation(formData: FormData) {
  const user = await getCurrentUser();
  const token = String(formData.get("token") ?? "");
  if (!token) return;
  if (!user) redirect(`/login?next=/invitation/${encodeURIComponent(token)}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_client_invitation", { p_token: token });
  if (error) throw new Error(error.message);

  revalidatePath("/portail", "layout");
  redirect("/portail");
}

/**
 * §PERMISSIONS JARDIN — « Le propriétaire peut retirer l'accès du
 * professionnel. »
 *
 * Ce que ça retire, et rien d'autre : l'accès au JARDIN. Les devis, les
 * factures et les chantiers restent visibles dans le portail — ils
 * appartiennent à l'entreprise, pas au jardin, et un client qui coupe
 * l'accès de son paysagiste au plan ne renonce pas à ses factures.
 */
export async function revokeProfessionalAccess(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const gardenId = String(formData.get("garden_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  if (!gardenId || !userId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_garden_access", {
    p_garden_id: gardenId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/portail/jardins");
}
