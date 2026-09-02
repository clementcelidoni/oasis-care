"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization, requireOrganization } from "@/lib/auth/organization";

/**
 * §27 RECHERCHES RÉCENTES et §28 FAVORIS.
 *
 * Deux écritures de confort. Ni l'une ni l'autre ne doit jamais faire
 * échouer ce qu'elle accompagne : ouvrir un devis marche même si
 * l'enregistrement de « récemment ouvert » échoue, et c'est pour ça que
 * `recordOpen` avale son erreur au lieu de la lever.
 */

/** §23 — appelé au moment d'ouvrir un résultat, sans bloquer la navigation. */
export async function recordOpen(formData: FormData) {
  const organization = await getActiveOrganization();
  if (!organization) return;

  const entityType = String(formData.get("entity_type") ?? "");
  const entityId = String(formData.get("entity_id") ?? "");
  const title = String(formData.get("title") ?? "");
  const url = String(formData.get("url") ?? "");
  if (!entityType || !entityId || !title || !url.startsWith("/")) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_recent_item", {
    p_organization_id: organization.organizationId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_title: title,
    p_url: url,
  });

  // Volontairement silencieux. Une liste « récemment ouverts »
  // incomplète est un désagrément ; une navigation qui échoue parce
  // qu'on n'a pas pu l'enregistrer serait un défaut.
  if (error) console.error("récemment ouvert :", error.message);
}

/**
 * §28 FAVORIS — épingler, ou dépingler.
 *
 * Une seule action pour les deux sens : l'étoile est un interrupteur, et
 * deux actions séparées obligeraient chaque écran à savoir dans quel
 * état il se trouve avant de choisir laquelle appeler.
 */
export async function toggleFavorite(formData: FormData) {
  const organization = await requireOrganization();

  const entityType = String(formData.get("entity_type") ?? "");
  const entityId = String(formData.get("entity_id") ?? "");
  const title = String(formData.get("title") ?? "");
  const url = String(formData.get("url") ?? "");
  if (!entityType || !entityId || !url.startsWith("/")) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const userId = user.user?.id;
  if (!userId) return;

  const { data: existing } = await supabase
    .from("user_favorites")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organization.organizationId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from("user_favorites").delete().eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("user_favorites").insert({
      user_id: userId,
      organization_id: organization.organizationId,
      entity_type: entityType,
      entity_id: entityId,
      title,
      url,
    });
    if (error) throw new Error(error.message);
  }

  // Les favoris s'affichent dans la palette, donc dans la mise en page.
  revalidatePath("/", "layout");
}

/** Ce que la palette montre quand le champ est vide. */
export async function loadQuickLists() {
  const organization = await getActiveOrganization();
  if (!organization) return { recents: [], favorites: [] };

  const supabase = await createClient();
  const [{ data: recents }, { data: favorites }] = await Promise.all([
    supabase
      .from("user_recent_items")
      .select("id, entity_type, title, url")
      .eq("organization_id", organization.organizationId)
      .order("opened_at", { ascending: false })
      .limit(5),
    supabase
      .from("user_favorites")
      .select("id, entity_type, title, url")
      .eq("organization_id", organization.organizationId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return {
    recents: (recents ?? []) as { id: string; entity_type: string; title: string; url: string }[],
    favorites: (favorites ?? []) as { id: string; entity_type: string; title: string; url: string }[],
  };
}
