"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { recordAudit } from "@/lib/audit/record";

/**
 * §11S côté PROFESSIONNEL — inviter, livrer, révoquer.
 *
 * Ces actions vivent à part de `lib/portal/actions.ts`, qui est le côté
 * client. Les deux moitiés du portail n'ont ni les mêmes droits ni les
 * mêmes garde-fous, et les mêler dans un fichier ferait qu'un jour l'un
 * appellerait une fonction de l'autre.
 *
 * Aucune ne prend d'identifiant d'organisation depuis le formulaire :
 * `invite_client` et `deliver_garden_to_client` le retrouvent
 * eux-mêmes depuis la fiche client, et vérifient la permission.
 */

/**
 * Créer le lien d'invitation.
 *
 * On ne l'ENVOIE pas : Oasis Care Pro n'a pas de service d'e-mail, et
 * un bouton « Envoyer » qui n'envoie rien serait pire que pas de
 * bouton. La fonction rend un jeton, l'écran affiche le lien, et le
 * professionnel le transmet comme il transmet déjà ses devis.
 */
export async function inviteClient(formData: FormData) {
  const organization = await requireOrganization();

  const customerId = String(formData.get("customer_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  if (!customerId || !email) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_client", {
    p_customer_id: customerId,
    p_email: email,
  });
  if (error) throw new Error(error.message);

  // Le jeton lui-même ne va PAS dans le journal : il ouvre l'accès aux
  // documents du client, et un journal lisible par toute l'équipe n'est
  // pas l'endroit où le ranger.
  await recordAudit(organization.organizationId, "portalInvited", "customer", customerId, {
    email,
  });

  revalidatePath(`/crm/clients/${customerId}`);
}

/** Annuler une invitation qui n'a pas été acceptée. */
export async function cancelInvitation(formData: FormData) {
  await requireOrganization();

  const invitationId = String(formData.get("invitation_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  if (!invitationId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("client_invitations")
    .delete()
    .eq("id", invitationId)
    .is("accepted_at", null);
  if (error) throw new Error(error.message);

  revalidatePath(`/crm/clients/${customerId}`);
}

/**
 * Fermer le portail d'un client.
 *
 * On révoque, on ne supprime pas : la ligne dit qui avait accès et
 * jusqu'à quand. Une suppression effacerait la trace en même temps que
 * le droit.
 *
 * Ne touche PAS aux jardins déjà livrés. Ils appartiennent au client
 * maintenant, et les lui reprendre parce qu'on ferme un portail serait
 * l'inverse de ce que « livrer » veut dire.
 */
export async function revokePortalAccess(formData: FormData) {
  const organization = await requireOrganization();

  const accessId = String(formData.get("access_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  if (!accessId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("client_portal_access")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", accessId);
  if (error) throw new Error(error.message);

  await recordAudit(organization.organizationId, "portalRevoked", "customer", customerId, {
    access_id: accessId,
  });

  revalidatePath(`/crm/clients/${customerId}`);
}

/**
 * §JARDIN PRO → PARTICULIER, « FONCTION MAJEURE ».
 *
 * Le jardin CHANGE DE PROPRIÉTAIRE : il passe dans l'espace de travail
 * personnel du client, celui que son iPhone synchronise. Le
 * professionnel garde un accès `professional` pour continuer à
 * entretenir le plan — révocable par le client, ce qui est le sens même
 * de la livraison.
 *
 * Le devis, les coûts et les marges ne bougent pas : §"LE PROFESSIONNEL
 * CONSERVE".
 */
export async function deliverGarden(formData: FormData) {
  const organization = await requireOrganization();

  const gardenId = String(formData.get("garden_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  if (!gardenId || !customerId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("deliver_garden_to_client", {
    p_garden_id: gardenId,
    p_customer_id: customerId,
  });
  if (error) throw new Error(error.message);

  // La livraison fait CHANGER LE JARDIN DE PROPRIÉTAIRE. C'est
  // l'opération la moins réversible du produit : elle mérite sa ligne.
  await recordAudit(organization.organizationId, "gardenDelivered", "garden", gardenId, {
    customer_id: customerId,
  });

  revalidatePath(`/crm/clients/${customerId}`);
  // Le jardin a quitté l'espace de l'organisation : la liste du Digital
  // Twin n'est plus à jour.
  revalidatePath("/digital-twin", "layout");
}
