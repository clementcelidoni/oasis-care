"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { gardenWorkspaceId, NO_GARDEN_WORKSPACE } from "./workspace";
import type { PlanImage } from "./types";

/**
 * Plans importés — §"IMPORT DE PLAN" et §"CALIBRATION".
 *
 * Le fichier va dans Supabase Storage, la ligne ne garde qu'un chemin.
 * Le chemin commence par l'id du workspace : c'est ce que les politiques
 * RLS du bucket vérifient (migration 0045), donc l'isolation entre
 * entreprises couvre aussi les fichiers.
 */

const BUCKET = "garden-plans";

/** Formats réellement affichables dans un canvas, sans conversion. */
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;

export async function listPlanImages(gardenId: string): Promise<PlanImage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("garden_plan_images")
    .select("*")
    .eq("garden_id", gardenId)
    .is("deleted_at", null)
    .order("created_at");

  if (!data) return [];

  return Promise.all(
    data.map(async (row) => {
      // Bucket privé : il faut une URL signée, une URL publique
      // renverrait 403. Une heure suffit largement pour une session
      // d'édition, et une fuite de lien expire d'elle-même.
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, 3600);

      return {
        id: row.id,
        url: signed?.signedUrl ?? null,
        positionX: row.position_x_meters,
        positionY: row.position_y_meters,
        rotationRadians: row.rotation_radians,
        opacity: row.opacity,
        isVisible: row.is_visible,
        calibration:
          row.calibration_point_ax != null &&
          row.calibration_point_bx != null &&
          row.calibration_real_distance_meters != null
            ? {
                ax: row.calibration_point_ax,
                ay: row.calibration_point_ay,
                bx: row.calibration_point_bx,
                by: row.calibration_point_by,
                realDistanceMeters: row.calibration_real_distance_meters,
              }
            : null,
        originalFilename: row.original_filename,
      } satisfies PlanImage;
    }),
  );
}

export async function uploadPlanImage(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const gardenId = String(formData.get("garden_id") ?? "");
  const file = formData.get("file");
  if (!gardenId || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier." };
  }
  if (!ACCEPTED.includes(file.type)) {
    // Le PDF est refusé explicitement : un canvas ne sait pas le
    // dessiner sans moteur de rendu, et accepter le fichier pour
    // n'afficher qu'un cadre vide serait pire qu'un refus clair.
    return {
      ok: false,
      error:
        file.type === "application/pdf"
          ? "Le PDF n'est pas encore pris en charge. Exportez votre plan en PNG ou JPEG."
          : "Format non pris en charge. Utilisez PNG, JPEG ou WebP.",
    };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Fichier trop volumineux (25 Mo maximum)." };
  }

  // Le chemin de stockage ET la ligne portent l’espace du JARDIN : la
  // première partie du chemin est exactement ce que vérifie la RLS du
  // bucket, donc s’y tromper rangerait le fichier hors de portée de son
  // propre jardin.
  const workspaceId = await gardenWorkspaceId(gardenId);
  if (!workspaceId) return { ok: false, error: NO_GARDEN_WORKSPACE };

  const supabase = await createClient();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${workspaceId}/${gardenId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error } = await supabase.from("garden_plan_images").insert({
    workspace_id: workspaceId,
    garden_id: gardenId,
    storage_path: path,
    original_filename: file.name,
    content_type: file.type,
  });
  if (error) {
    // La ligne a échoué : on retire le fichier, sinon il resterait
    // orphelin dans le bucket sans que rien ne le référence.
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, error: error.message };
  }

  revalidatePath(`/digital-twin/${gardenId}`);
  return { ok: true };
}

export async function updatePlanImage(input: {
  id: string;
  gardenId: string;
  positionX?: number;
  positionY?: number;
  rotationRadians?: number;
  opacity?: number;
  isVisible?: boolean;
  calibration?: {
    ax: number; ay: number; bx: number; by: number; realDistanceMeters: number;
  } | null;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.positionX !== undefined) patch.position_x_meters = input.positionX;
  if (input.positionY !== undefined) patch.position_y_meters = input.positionY;
  if (input.rotationRadians !== undefined) patch.rotation_radians = input.rotationRadians;
  if (input.opacity !== undefined) patch.opacity = input.opacity;
  if (input.isVisible !== undefined) patch.is_visible = input.isVisible;
  if (input.calibration !== undefined) {
    patch.calibration_point_ax = input.calibration?.ax ?? null;
    patch.calibration_point_ay = input.calibration?.ay ?? null;
    patch.calibration_point_bx = input.calibration?.bx ?? null;
    patch.calibration_point_by = input.calibration?.by ?? null;
    patch.calibration_real_distance_meters = input.calibration?.realDistanceMeters ?? null;
  }

  const { error } = await supabase
    .from("garden_plan_images")
    .update(patch)
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/digital-twin/${input.gardenId}`);
  return { ok: true };
}

export async function deletePlanImage(
  id: string,
  gardenId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("garden_plan_images")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/digital-twin/${gardenId}`);
  return { ok: true };
}
