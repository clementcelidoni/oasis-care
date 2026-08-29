"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "./organization";
import { BUSINESS_TYPES, type BusinessType } from "./permissions";

/**
 * Modifier l'identité de l'organisation.
 *
 * Le type d'activité n'était réglable qu'à la création, et il gouverne
 * tout le menu : une entreprise qui ajoute une activité de pépinière
 * n'avait aucun moyen de le dire, et les écrans correspondants
 * restaient invisibles pour toujours. La spec prévoit pourtant
 * « Paysagiste et pépiniériste » exactement pour ce cas.
 *
 * L'autorisation est vérifiée EN BASE — la politique « Admins can
 * update their organization » de la migration 0043 exige
 * `organization.manageUsers`. Ce qui suit ne fait que masquer le
 * formulaire à ceux qui n'y ont pas droit ; c'est RLS qui refuse.
 */
export async function updateOrganizationProfile(formData: FormData) {
  const organization = await requireOrganization();

  const name = String(formData.get("name") ?? "").trim();
  const businessType = String(formData.get("business_type") ?? "");

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (name) patch.name = name;
  // Une valeur inventée serait de toute façon refusée par la contrainte
  // de la table, mais autant ne pas envoyer la tentative.
  if (BUSINESS_TYPES.includes(businessType as BusinessType)) {
    patch.business_type = businessType;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("business_organizations")
    .update(patch)
    .eq("id", organization.organizationId);
  if (error) throw new Error(error.message);

  // Le menu est rendu par la mise en page : sans ce rafraîchissement,
  // les modules nouvellement débloqués n'apparaîtraient qu'au prochain
  // rechargement complet, et on croirait que rien n'a changé.
  revalidatePath("/", "layout");
  revalidatePath("/parametres");
}
