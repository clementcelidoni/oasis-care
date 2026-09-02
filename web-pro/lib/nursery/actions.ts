"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { parseQuantity } from "@/lib/quotes/types";
import { DEFAULT_STAGES } from "./types";

/**
 * §11I à §11L — pépinière.
 *
 * AUCUNE ACTION ICI N'ÉCRIT UNE QUANTITÉ DIRECTEMENT. Tout passe par
 * `record_nursery_movement`, qui écrit le mouvement et applique son
 * effet dans la même opération. Un stock modifié sans trace est un
 * inventaire qu'on ne peut plus expliquer six mois plus tard — et
 * §MOUVEMENTS exige que « chaque mouvement soit audit-able ».
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

function count(formData: FormData, key: string): number {
  return Math.max(0, Math.round(parseQuantity(String(formData.get(key) ?? "0"))));
}

// ---------------------------------------------------------------
// Emplacements
// ---------------------------------------------------------------

export async function createLocation(formData: FormData) {
  const organization = await requireOrganization();
  const code = text(formData, "code");
  if (!code) return;

  const supabase = await createClient();
  const { error } = await supabase.from("nursery_locations").insert({
    organization_id: organization.organizationId,
    parent_id: text(formData, "parent_id"),
    code,
    name: text(formData, "name") ?? code,
    kind: text(formData, "kind") ?? "outdoorBlock",
    surface_m2: formData.get("surface_m2")
      ? parseQuantity(String(formData.get("surface_m2"))) || null : null,
    capacity: formData.get("capacity") ? count(formData, "capacity") || null : null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/pepiniere/emplacements");
}

export async function archiveLocation(formData: FormData) {
  const id = String(formData.get("location_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  // Archivé, pas supprimé : les mouvements citent cet emplacement, et
  // le faire disparaître effacerait d'où venaient les plantes.
  const { error } = await supabase
    .from("nursery_locations")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/pepiniere/emplacements");
}

// ---------------------------------------------------------------
// Étapes de production
// ---------------------------------------------------------------

/**
 * Installe les étapes du document si l'organisation n'en a aucune.
 *
 * Paresseusement, à la première ouverture de la pépinière : une
 * entreprise purement paysagiste n'a aucune raison de trouver dix
 * étapes de production dans ses écrans.
 */
export async function ensureStages(): Promise<void> {
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { count: existing } = await supabase
    .from("nursery_stages")
    .select("id", { count: "exact", head: true });
  if ((existing ?? 0) > 0) return;

  await supabase.from("nursery_stages").insert(
    DEFAULT_STAGES.map((s, position) => ({
      organization_id: organization.organizationId,
      code: s.code,
      label: s.label,
      position,
      is_saleable: s.saleable,
    })),
  );
}

// ---------------------------------------------------------------
// Lots
// ---------------------------------------------------------------

export async function createLot(formData: FormData) {
  const organization = await requireOrganization();
  const lotCode = text(formData, "lot_code");
  const speciesName = text(formData, "species_name");
  if (!lotCode || !speciesName) return;

  const quantity = count(formData, "initial_quantity");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("nursery_lots")
    .insert({
      organization_id: organization.organizationId,
      lot_code: lotCode,
      species_name: speciesName,
      cultivar: text(formData, "cultivar"),
      origin: text(formData, "origin"),
      supplier_id: text(formData, "supplier_id"),
      supplier_lot_reference: text(formData, "supplier_lot_reference"),
      container_size: text(formData, "container_size"),
      stage_id: text(formData, "stage_id"),
      location_id: text(formData, "location_id"),
      status: text(formData, "status") ?? "inProduction",
      initial_quantity: quantity,
      // Volontairement zéro : la quantité entre par un mouvement de
      // réception, pour que le lot commence son journal par son origine
      // plutôt que par un solde surgi de nulle part.
      current_quantity: 0,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (quantity > 0) {
    const { error: movementError } = await supabase.rpc("record_nursery_movement", {
      p_lot_id: data.id,
      p_kind: "receive",
      p_quantity: quantity,
      p_reason: "Création du lot",
    });
    if (movementError) throw new Error(movementError.message);
  }

  revalidatePath("/pepiniere");
  redirect(`/pepiniere/lots/${data.id}`);
}

export async function updateLot(formData: FormData) {
  const id = String(formData.get("lot_id") ?? "");
  if (!id) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of [
    "species_name", "cultivar", "origin", "container_size", "plant_size",
    "supplier_lot_reference", "notes", "stage_id",
  ]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }
  // Le statut se change ici, mais JAMAIS les quantités : celles-ci
  // n'ont d'autre chemin que `record_nursery_movement`.
  if (formData.has("status")) patch.status = text(formData, "status");

  const supabase = await createClient();
  const { error } = await supabase.from("nursery_lots").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/pepiniere/lots/${id}`);
  revalidatePath("/pepiniere");
}

/** Le seul chemin qui fait bouger un stock. Voir l'en-tête du fichier. */
export async function recordMovement(formData: FormData) {
  const lotId = String(formData.get("lot_id") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!lotId || !kind) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_nursery_movement", {
    p_lot_id: lotId,
    p_kind: kind,
    p_quantity: count(formData, "quantity"),
    p_to_location_id: text(formData, "to_location_id"),
    p_reason: text(formData, "reason"),
  });
  // Les refus de la fonction — survente, réservation impossible — sont
  // des messages écrits pour être lus. On les laisse remonter tels
  // quels plutôt que de les remplacer par « une erreur est survenue ».
  if (error) throw new Error(error.message);

  revalidatePath(`/pepiniere/lots/${lotId}`);
  revalidatePath("/pepiniere");
  revalidatePath("/pepiniere/stock");
}

export async function splitLot(formData: FormData) {
  const lotId = String(formData.get("lot_id") ?? "");
  const newCode = text(formData, "new_lot_code");
  const quantity = count(formData, "quantity");
  if (!lotId || !newCode || quantity <= 0) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("split_nursery_lot", {
    p_lot_id: lotId,
    p_quantity: quantity,
    p_new_lot_code: newCode,
    p_to_location_id: text(formData, "to_location_id"),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/pepiniere");
  redirect(`/pepiniere/lots/${data as string}`);
}

// ---------------------------------------------------------------
// Rempotage, inspections, réservations
// ---------------------------------------------------------------

export async function recordRepotting(formData: FormData) {
  const organization = await requireOrganization();
  const lotId = String(formData.get("lot_id") ?? "");
  const toContainer = text(formData, "to_container");
  if (!lotId || !toContainer) return;

  const quantity = count(formData, "quantity");
  const losses = count(formData, "losses");
  const supabase = await createClient();

  const { error } = await supabase.from("repotting_events").insert({
    organization_id: organization.organizationId,
    lot_id: lotId,
    from_container: text(formData, "from_container"),
    to_container: toContainer,
    quantity,
    substrate: text(formData, "substrate"),
    labor_hours: formData.get("labor_hours")
      ? parseQuantity(String(formData.get("labor_hours"))) || null : null,
    losses,
    occurred_on: text(formData, "occurred_on") ?? new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error(error.message);

  // Les pertes du rempotage sortent réellement du stock. Les noter
  // seulement sur l'événement laisserait le lot faux, et l'écart ne se
  // verrait qu'à l'inventaire suivant.
  if (losses > 0) {
    await supabase.rpc("record_nursery_movement", {
      p_lot_id: lotId,
      p_kind: "loss",
      p_quantity: losses,
      p_reason: `Pertes au rempotage vers ${toContainer}`,
    });
  }

  // Le nouveau contenant devient celui du lot : c'est le sens même du
  // rempotage, et l'oublier ferait mentir l'étiquette.
  await supabase
    .from("nursery_lots")
    .update({ container_size: toContainer, updated_at: new Date().toISOString() })
    .eq("id", lotId);

  revalidatePath(`/pepiniere/lots/${lotId}`);
}

export async function recordInspection(formData: FormData) {
  const organization = await requireOrganization();
  const lotId = String(formData.get("lot_id") ?? "");
  if (!lotId) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase.from("nursery_inspections").insert({
    organization_id: organization.organizationId,
    lot_id: lotId,
    result: text(formData, "result") ?? "healthy",
    findings: text(formData, "findings"),
    action_taken: text(formData, "action_taken"),
    inspected_on: text(formData, "inspected_on") ?? new Date().toISOString().slice(0, 10),
    inspected_by: user.user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/pepiniere/lots/${lotId}`);
}

/**
 * Réserver du stock pour quelqu'un.
 *
 * Deux écritures : la réservation, qui dit pour qui, et le mouvement,
 * qui réduit le disponible. La fonction refuse de dépasser ce qui reste
 * réservable — c'est là que se joue la survente.
 */
export async function createReservation(formData: FormData) {
  const organization = await requireOrganization();
  const lotId = String(formData.get("lot_id") ?? "");
  const quantity = count(formData, "quantity");
  if (!lotId || quantity <= 0) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  // Le mouvement D'ABORD : s'il refuse, aucune réservation n'est écrite.
  // L'ordre inverse laisserait une réservation fantôme sur un stock qui
  // n'existe pas.
  const { error: movementError } = await supabase.rpc("record_nursery_movement", {
    p_lot_id: lotId,
    p_kind: "reserve",
    p_quantity: quantity,
    p_reason: text(formData, "notes") ?? "Réservation",
  });
  if (movementError) throw new Error(movementError.message);

  const { error } = await supabase.from("nursery_reservations").insert({
    organization_id: organization.organizationId,
    lot_id: lotId,
    customer_id: text(formData, "customer_id"),
    quantity,
    expires_on: text(formData, "expires_on"),
    notes: text(formData, "notes"),
    created_by: user.user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/pepiniere/lots/${lotId}`);
  revalidatePath("/pepiniere/stock");
}

export async function releaseReservation(formData: FormData) {
  const reservationId = String(formData.get("reservation_id") ?? "");
  const lotId = String(formData.get("lot_id") ?? "");
  if (!reservationId || !lotId) return;

  const supabase = await createClient();
  const { data: reservation } = await supabase
    .from("nursery_reservations")
    .select("quantity, status")
    .eq("id", reservationId)
    .maybeSingle();
  if (!reservation || reservation.status !== "active") return;

  await supabase.rpc("record_nursery_movement", {
    p_lot_id: lotId,
    p_kind: "unreserve",
    p_quantity: reservation.quantity,
    p_reason: "Réservation libérée",
  });

  await supabase
    .from("nursery_reservations")
    .update({ status: "released", updated_at: new Date().toISOString() })
    .eq("id", reservationId);

  revalidatePath(`/pepiniere/lots/${lotId}`);
  revalidatePath("/pepiniere/stock");
}
