"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import type {
  TwinDocument, TwinObject, TwinArea, RevisionState, RevisionSummary,
  LinkablePlant,
} from "./types";

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
    .select("id, name, latitude, longitude")
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
        "id, object_type, position_x_meters, position_y_meters, rotation_radians, width_meters, height_meters, z_index, label, canopy_diameter_meters, linked_entity_id, linked_entity_kind",
      )
      .eq("garden_id", gardenId)
      .is("deleted_at", null)
      .order("z_index"),
  ]);

  return {
    gardenId: garden.id,
    gardenName: garden.name,
    latitude: garden.latitude,
    longitude: garden.longitude,
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
      linkedEntityId: o.linked_entity_id,
      linkedEntityKind: o.linked_entity_kind,
    })),
  };
}

/**
 * Les plantes du carnet, proposées au rattachement d'un objet du plan.
 *
 * §11C : « chaque élément du plan peut être associé à une vraie entité
 * Oasis… toucher l'objet ouvre la vraie fiche. » Ce sont les mêmes
 * lignes que la liste Végétaux de l'iPhone.
 *
 * Les plantes du jardin courant d'abord : rattacher un arbre du plan à
 * une plante déjà rattachée à ce jardin est le cas courant, chercher
 * dans tout le carnet est l'exception.
 */
export async function listLinkablePlants(gardenId: string): Promise<LinkablePlant[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("plants")
    .select("id, custom_name, common_name, scientific_name, garden_id")
    .eq("is_archived", false)
    .order("custom_name")
    .limit(500);

  const rows = (data ?? []).map((p) => ({
    id: p.id,
    customName: p.custom_name,
    commonName: p.common_name,
    scientificName: p.scientific_name,
    gardenId: p.garden_id,
  }));

  return rows.sort((a, b) => {
    const aHere = a.gardenId === gardenId ? 0 : 1;
    const bHere = b.gardenId === gardenId ? 0 : 1;
    return aHere - bHere || a.customName.localeCompare(b.customName, "fr");
  });
}

type SavePayload = {
  gardenId: string;
  boundary: { id: string; points: { xMeters: number; yMeters: number }[] } | null;
  areas: TwinArea[];
  objects: TwinObject[];
  deletedAreaIds: string[];
  deletedObjectIds: string[];
  /**
   * Dernière modification connue au moment du chargement. Sert à la
   * détection de conflit — voir `saveTwin`.
   */
  baseModifiedAt: string | null;
};

/**
 * Horodatage de la dernière écriture sur ce jardin, tous appareils
 * confondus. §CONCURRENCY.
 */
export async function twinLastModified(gardenId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("garden_twin_last_modified", {
    p_garden_id: gardenId,
  });
  if (error) return null;
  return (data as string) ?? null;
}

/**
 * Enregistre l'état de l'éditeur.
 *
 * Upsert plutôt que delete-puis-insert : les ids sont stables, donc une
 * ligne modifiée reste la même ligne. Un delete/insert changerait les
 * ids à chaque sauvegarde et ferait, côté iPhone, disparaître puis
 * réapparaître tout le jardin à chaque synchronisation.
 *
 * Les suppressions sont DOUCES (`deleted_at`) — contrairement au Sync
 * Engine iOS, qui supprime en dur. Ce n'est pas un alignement mais un
 * choix : une ligne réellement effacée est indiscernable d'une ligne qui
 * n'a jamais existé, donc la suppression ne pourrait jamais remonter
 * jusqu'au téléphone. C'est `pullDigitalTwin` côté Swift qui applique
 * ces suppressions, et le restore filtre désormais `deleted_at` — sans
 * quoi un appareil neuf ressusciterait tout ce qui a été supprimé ici.
 */
export async function saveTwin(
  payload: SavePayload,
): Promise<{ ok: boolean; error?: string; conflict?: boolean; modifiedAt?: string | null }> {
  const organization = await getActiveOrganization();
  if (!organization) return { ok: false, error: "Aucune organisation active." };

  const supabase = await createClient();
  const workspaceId = organization.workspaceId;
  const now = new Date().toISOString();

  // §CONCURRENCY — « Ne pas écraser silencieusement le travail d'un
  // autre utilisateur. » Si quelqu'un (ou l'iPhone) a écrit depuis notre
  // chargement, on refuse et on le dit, plutôt que d'aplatir son travail.
  if (payload.baseModifiedAt) {
    const { data: current } = await supabase.rpc("garden_twin_last_modified", {
      p_garden_id: payload.gardenId,
    });
    if (current && new Date(current as string) > new Date(payload.baseModifiedAt)) {
      return { ok: false, conflict: true, modifiedAt: current as string };
    }
  }

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
        linked_entity_id: o.linkedEntityId,
        linked_entity_kind: o.linkedEntityKind,
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
  const { data: after } = await supabase.rpc("garden_twin_last_modified", {
    p_garden_id: payload.gardenId,
  });
  return { ok: true, modifiedAt: (after as string) ?? now };
}

// ---------------------------------------------------------------
// Révisions — §"VERSIONS DU PROJET"
// ---------------------------------------------------------------

export async function listRevisions(gardenId: string): Promise<RevisionSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("digital_twin_revisions")
    .select("id, label, state, created_at, snapshot")
    .eq("garden_id", gardenId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  return (data ?? []).map((r) => {
    const snapshot = r.snapshot as { areas?: unknown[]; objects?: unknown[] } | null;
    return {
      id: r.id,
      label: r.label,
      state: r.state as RevisionState,
      createdAt: r.created_at,
      objectCount: snapshot?.objects?.length ?? 0,
      areaCount: snapshot?.areas?.length ?? 0,
    };
  });
}

/**
 * Fige l'état courant sous un nom.
 *
 * L'instantané est stocké en JSON plutôt que par références : une
 * révision « existant » doit continuer de montrer le terrain d'avant
 * travaux même après que le plan courant ait entièrement changé.
 */
export async function saveRevision(input: {
  gardenId: string;
  label: string;
  state: RevisionState;
  snapshot: { boundary: unknown; areas: unknown[]; objects: unknown[] };
}): Promise<{ ok: boolean; error?: string }> {
  const organization = await getActiveOrganization();
  if (!organization) return { ok: false, error: "Aucune organisation active." };

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase.from("digital_twin_revisions").insert({
    workspace_id: organization.workspaceId,
    garden_id: input.gardenId,
    label: input.label,
    state: input.state,
    snapshot: input.snapshot,
    created_by: user.user?.id ?? null,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/digital-twin/${input.gardenId}`);
  return { ok: true };
}

export async function loadRevision(revisionId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("digital_twin_revisions")
    .select("id, label, state, snapshot")
    .eq("id", revisionId)
    .maybeSingle();
  return data ?? null;
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
