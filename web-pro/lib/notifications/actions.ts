"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";

/**
 * §41 NOTIFICATIONS — les deux seules écritures du centre.
 *
 * Rien ici ne touche à `notifications` : une notification est écrite par
 * le produit, jamais par la personne qui la lit. Ce fichier n'écrit que
 * dans `notification_reads`, et uniquement pour le compte connecté.
 *
 * C'est tout l'intérêt d'avoir sorti l'état « lu » de la notification
 * (migration 0060) : un stock faible concerne la pépinière entière, mais
 * le fait de l'avoir vu ne concerne qu'une personne. Si « lu » vivait
 * sur la notification, le premier qui ouvre l'écran effacerait l'alerte
 * pour ses cinq collègues.
 */

/**
 * Le nombre de notifications qu'un « Tout marquer comme lu » traite en
 * une fois.
 *
 * Une borne plutôt qu'une boucle : la requête reste prévisible, et le
 * cas où elle ne suffirait pas se répare tout seul — le bouton est
 * toujours là au rechargement, avec le reste du compteur.
 */
const MARK_ALL_LIMIT = 1000;

/** Le compte connecté, ou rien à faire. */
async function currentUserId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Les deux endroits que l'état « lu » modifie.
 *
 * La pastille du header vit dans `app/(app)/layout.tsx` : sans
 * l'invalidation de la mise en page, le compteur resterait à trois
 * pendant qu'on regarde une liste entièrement lue.
 */
function revalidateNotificationSurfaces() {
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

/** §41 « Marquer comme lue » — une notification, pour moi seul. */
export async function markNotificationRead(formData: FormData) {
  const organization = await requireOrganization();

  const notificationId = String(formData.get("notification_id") ?? "").trim();
  if (!notificationId) return;

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return;

  // On relit la notification avant de l'acquitter. La RLS de
  // `notifications` ne renvoie que celles de mon entreprise qui me sont
  // destinées : un identifiant fabriqué ne trouve donc rien, et on sort
  // sans laisser la clé étrangère lever une erreur illisible.
  const { data: visible } = await supabase
    .from("notifications")
    .select("id")
    .eq("id", notificationId)
    .eq("organization_id", organization.organizationId)
    .maybeSingle();
  if (!visible) return;

  const { error } = await supabase
    .from("notification_reads")
    .upsert(
      { notification_id: notificationId, user_id: userId },
      // Deux clics sur le même bouton ne sont pas une erreur : le
      // second ne doit rien casser ni écraser la date du premier.
      { onConflict: "notification_id,user_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);

  revalidateNotificationSurfaces();
}

/** §41 « Tout marquer comme lu » — la liste entière, pour moi seul. */
export async function markAllNotificationsRead() {
  const organization = await requireOrganization();

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return;

  // L'imbrication `notification_reads` passe par la RLS de cette table,
  // qui ne montre que MES lignes : un tableau vide veut donc bien dire
  // « je ne l'ai pas lue », et pas « personne ne l'a lue ».
  const { data: rows, error: readError } = await supabase
    .from("notifications")
    .select("id, notification_reads ( user_id )")
    .eq("organization_id", organization.organizationId)
    .order("created_at", { ascending: false })
    .limit(MARK_ALL_LIMIT);
  if (readError) throw new Error(readError.message);

  const unread = (rows ?? []).filter(
    (row) => (row.notification_reads as { user_id: string }[]).length === 0,
  );
  if (unread.length === 0) return;

  const { error } = await supabase.from("notification_reads").upsert(
    unread.map((row) => ({ notification_id: row.id as string, user_id: userId })),
    { onConflict: "notification_id,user_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);

  revalidateNotificationSurfaces();
}
