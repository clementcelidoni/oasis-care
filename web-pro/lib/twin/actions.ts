"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import type { TwinDocument, TwinObject, TwinArea } from "./types";

/**
 * Lecture et écriture du Digital Twin.
 *
 * Ces tables sont celles de la Phase 6 : l'iPhone y écrit déjà. Deux
 * conséquences dont il faut se souvenir à chaque insert.
 *
 * 1. `id` n'a AUCUNE valeur par défaut sur `gardens`, `garden_areas`,
 *    `garden_map_objects` et `garden_boundaries` — l'app iOS génère ses
 *    propres UUID et fait un upsert dessus. Le web doit donc fournir
 *    l'id lui-même.
 * 2. `points` est encodé par Swift depuis `[GardenCoordinate]`, soit
 *    `[{"xMeters":…,"yMeters":…}]`. Écrire une autre forme (des paires
 *    [x,y], ou du snake_case) casserait l'affichage côté iPhone.
 */

export async function loadTwin(gardenId: string): Promise<TwinDocument | null> {
  const supabase = await createClient();

  const { data: garden } = await supabase
    .from("gardens")
    .select("id, name")
    .eq("id", gardenId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!garden) return null;

  const [{ data: boundary }, { data: areas }, { data: objects }] = await Promise.all([
    supabase
      .from("garden_boundaries")
      .select("id, points")
      .eq("garden_id", gardenId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("garden_areas")
      .select("id, area_type, name, points")
      .eq("garden_id", gardenId)
      .is("deleted_at", null),
    supabase
      .from("garden_map_objects")
      .select(
        "id, object_type, position_x_meters, position_y_meters, rotation_radians, width_meters, height_meters, z_index, label, canopy_diameter_meters",
      )
      .eq("garden_id", gardenId)
      .is("deleted_at", null)
      .order("z_index"),
  ]);

  return {
    gardenId: garden.id,
    gardenName: garden.name,
    boundary: boundary ? { id: boundary.id, points: boundary.points ?? [] } : null,
    areas: (areas ?? []).map((a) => ({
      id: a.id,
      areaType: a.area_type,
      name: a.name ?? "",
      points: a.points ?? [],
    })),
    objects: (objects ?? []).map((o) => ({
      id: o.id,
      objectType: o.object_type,
      position: { xMeters: o.position_x_meters, yMeters: o.position_y_meters },
      rotationRadians: o.rotation_radians ?? 0,
      widthMeters: o.width_meters,
      heightMeters: o.height_meters,
      zIndex: o.z_index ?? 0,
      label: o.label,
      canopyDiameterMeters: o.canopy_diameter_meters,
    })),
  };
}

type SavePayload = {
  gardenId: string;
  boundary: { id: string; points: { xMeters: number; yMeters: number }[] } | null;
  areas: TwinArea[];
  objects: TwinObject[];
  deletedAreaIds: string[];
  deletedObjectIds: string[];
};

/**
 * Enregistre l'état de l'éditeur.
 *
 * Upsert plutôt que delete-puis-insert : les ids sont stables, donc une
 * ligne modifiée reste la même ligne. Un delete/insert changerait les
 * ids à chaque sauvegarde et ferait, côté iPhone, disparaître puis
 * réapparaître tout le jardin à chaque synchronisation.
 *
 * Les suppressions sont douces (`deleted_at`), comme le fait déjà le
 * Sync Engine iOS — un `delete` brutal empêcherait l'autre appareil de
 * jamais apprendre que l'objet a disparu.
 */
export async function saveTwin(payload: SavePayload): Promise<{ ok: boolean; error?: string }> {
  const organization = await getActiveOrganization();
  if (!organization) return { ok: false, error: "Aucune organisation active." };

  const supabase = await createClient();
  const workspaceId = organization.workspaceId;
  const now = new Date().toISOString();

  if (payload.boundary) {
    const { error } = await supabase.from("garden_boundaries").upsert(
      {
        id: payload.boundary.id,
        workspace_id: workspaceId,
        garden_id: payload.gardenId,
        points: payload.boundary.points,
        updated_at: now,
        deleted_at: null,
      },
      { onConflict: "id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  if (payload.areas.length > 0) {
    const { error } = await supabase.from("garden_areas").upsert(
      payload.areas.map((a) => ({
        id: a.id,
        workspace_id: workspaceId,
        garden_id: payload.gardenId,
        area_type: a.areaType,
        name: a.name,
        points: a.points,
        updated_at: now,
        deleted_at: null,
      })),
      { onConflict: "id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  if (payload.objects.length > 0) {
    const { error } = await supabase.from("garden_map_objects").upsert(
      payload.objects.map((o) => ({
        id: o.id,
        workspace_id: workspaceId,
        garden_id: payload.gardenId,
        object_type: o.objectType,
        position_x_meters: o.position.xMeters,
        position_y_meters: o.position.yMeters,
        rotation_radians: o.rotationRadians,
        width_meters: o.widthMeters,
        height_meters: o.heightMeters,
        z_index: o.zIndex,
        label: o.label,
        canopy_diameter_meters: o.canopyDiameterMeters,
        updated_at: now,
        deleted_at: null,
      })),
      { onConflict: "id" },
    );
    if (error) return { ok: false, error: error.message };
  }

  if (payload.deletedAreaIds.length > 0) {
    const { error } = await supabase
      .from("garden_areas")
      .update({ deleted_at: now, updated_at: now })
      .in("id", payload.deletedAreaIds);
    if (error) return { ok: false, error: error.message };
  }

  if (payload.deletedObjectIds.length > 0) {
    const { error } = await supabase
      .from("garden_map_objects")
      .update({ deleted_at: now, updated_at: now })
      .in("id", payload.deletedObjectIds);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/digital-twin/${payload.gardenId}`);
  return { ok: true };
}

/** Crée un jardin depuis le web, en fournissant l'id (voir plus haut). */
export async function createGarden(formData: FormData) {
  const organization = await getActiveOrganization();
  if (!organization) return;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const supabase = await createClient();
  const { error } = await supabase.from("gardens").insert({
    id: crypto.randomUUID(),
    workspace_id: organization.workspaceId,
    name,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/digital-twin");
}
