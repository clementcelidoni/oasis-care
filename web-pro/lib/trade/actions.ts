"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import {
  inputToCents, parseQuantity, parseQuantityOr, parseVatRate,
} from "@/lib/quotes/types";

/**
 * §11M achats, §11N commandes clients.
 *
 * DEUX CHOSES NE SE SAISISSENT PAS ICI, et c'est délibéré.
 *
 * L'état d'avancement — partiellement reçue, reçue, livrée — se déduit
 * des réceptions et des livraisons, en base. Le laisser à la main
 * garantirait qu'il finisse par mentir : quelqu'un reçoit une palette
 * et oublie de changer le statut.
 *
 * Et les quantités de stock ne bougent que par
 * `record_nursery_movement`, comme au Milestone 8. Livrer passe donc
 * par un mouvement `sell`, qui consomme la réservation au lieu de s'y
 * ajouter.
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

// ---------------------------------------------------------------
// Fournisseurs
// ---------------------------------------------------------------

export async function createSupplier(formData: FormData) {
  const organization = await requireOrganization();
  const name = text(formData, "name");
  if (!name) return;

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({
    organization_id: organization.organizationId,
    name,
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    city: text(formData, "city"),
    payment_terms: text(formData, "payment_terms"),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/fournisseurs");
}

export async function updateSupplier(formData: FormData) {
  const id = String(formData.get("supplier_id") ?? "");
  if (!id) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of [
    "name", "email", "phone", "website", "city", "postal_code",
    "address_line1", "siret", "vat_number", "payment_terms", "notes",
  ]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/fournisseurs");
}

export async function archiveSupplier(formData: FormData) {
  const id = String(formData.get("supplier_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  // Archivé, pas supprimé : les commandes passées le citent, et les
  // lots reçus gardent son nom comme origine.
  const { error } = await supabase
    .from("suppliers")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/fournisseurs");
}

// ---------------------------------------------------------------
// Commandes fournisseurs
// ---------------------------------------------------------------

export async function createPurchaseOrder(formData: FormData) {
  const organization = await requireOrganization();
  const supplierId = text(formData, "supplier_id");
  if (!supplierId) return;

  const supabase = await createClient();
  const { data: number, error: numberError } = await supabase.rpc("next_document_number", {
    p_organization_id: organization.organizationId,
    p_kind: "purchase",
    p_prefix: "CF",
  });
  if (numberError) throw new Error(numberError.message);

  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({
      organization_id: organization.organizationId,
      supplier_id: supplierId,
      number,
      expected_on: text(formData, "expected_on"),
      created_by: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/achats");
  redirect(`/achats/${data.id}`);
}

export async function updatePurchaseOrder(formData: FormData) {
  const id = String(formData.get("purchase_order_id") ?? "");
  if (!id) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["reference", "expected_on", "notes"]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }
  if (formData.has("status")) {
    const status = text(formData, "status");
    // Seuls `sent` et `cancelled` se posent à la main. Les deux autres
    // se déduisent des réceptions — voir l'en-tête.
    if (status === "sent" || status === "cancelled" || status === "draft") {
      patch.status = status;
      if (status === "sent") patch.sent_at = new Date().toISOString();
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("purchase_orders").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/achats/${id}`);
  revalidatePath("/achats");
  revalidatePath("/pepiniere/stock");
}

export async function addPurchaseLine(formData: FormData) {
  const organization = await requireOrganization();
  const orderId = String(formData.get("purchase_order_id") ?? "");
  const description = text(formData, "description");
  if (!orderId || !description) return;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("purchase_order_lines")
    .select("position")
    .eq("purchase_order_id", orderId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const isPlant = String(formData.get("is_plant") ?? "") === "on";

  const { error } = await supabase.from("purchase_order_lines").insert({
    organization_id: organization.organizationId,
    purchase_order_id: orderId,
    position: (last?.position ?? -1) + 1,
    description,
    unit: text(formData, "unit") ?? "u",
    quantity: parseQuantityOr(String(formData.get("quantity") ?? "1"), 1),
    unit_cost_cents: inputToCents(String(formData.get("unit_cost") ?? "0")),
    vat_rate: parseVatRate(String(formData.get("vat_rate") ?? "20")),
    is_plant: isPlant,
    // Renseignés seulement pour une ligne de végétaux : ils servent à
    // fabriquer le lot à la réception sans tout ressaisir.
    species_name: isPlant ? (text(formData, "species_name") ?? description) : null,
    cultivar: isPlant ? text(formData, "cultivar") : null,
    container_size: isPlant ? text(formData, "container_size") : null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/achats/${orderId}`);
  revalidatePath("/pepiniere/stock");
}

export async function deletePurchaseLine(formData: FormData) {
  const orderId = String(formData.get("purchase_order_id") ?? "");
  const lineId = String(formData.get("line_id") ?? "");
  if (!orderId || !lineId) return;

  const supabase = await createClient();
  const { error } = await supabase.from("purchase_order_lines").delete().eq("id", lineId);
  if (error) throw new Error(error.message);

  revalidatePath(`/achats/${orderId}`);
  revalidatePath("/pepiniere/stock");
}

/**
 * Réceptionner une livraison du fournisseur.
 *
 * §"RÉCEPTION VÉGÉTAUX : peut créer automatiquement NurseryLot APRÈS
 * VALIDATION." La case « créer le lot » est décochée par défaut : un
 * lot surgi tout seul dans l'inventaire serait exactement l'ajout
 * silencieux que la spec proscrit ailleurs.
 */
export async function receiveGoods(formData: FormData) {
  const organization = await requireOrganization();
  const orderId = String(formData.get("purchase_order_id") ?? "");
  if (!orderId) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const lineIds = formData.getAll("line").map(String);
  if (lineIds.length === 0) return;

  const { data: receipt, error: receiptError } = await supabase
    .from("goods_receipts")
    .insert({
      organization_id: organization.organizationId,
      purchase_order_id: orderId,
      received_on: text(formData, "received_on") ?? new Date().toISOString().slice(0, 10),
      delivery_note_reference: text(formData, "delivery_note_reference"),
      received_by: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (receiptError) throw new Error(receiptError.message);

  for (const lineId of lineIds) {
    const quantity = parseQuantity(String(formData.get(`quantity-${lineId}`) ?? "0"));
    if (quantity <= 0) continue;

    const createLot = String(formData.get(`create-lot-${lineId}`) ?? "") === "on";
    const { error } = await supabase.rpc("receive_purchase_line", {
      p_goods_receipt_id: receipt.id,
      p_purchase_order_line_id: lineId,
      p_quantity: quantity,
      p_create_lot: createLot,
      p_lot_code: text(formData, `lot-code-${lineId}`),
      p_location_id: text(formData, "location_id"),
    });
    // Les refus de la fonction sont écrits pour être lus : « il ne
    // reste que 40 à recevoir », « seule une ligne de végétaux peut
    // donner un lot ». On les laisse remonter tels quels.
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/achats/${orderId}`);
  revalidatePath("/pepiniere");
  revalidatePath("/pepiniere/stock");
}

// ---------------------------------------------------------------
// Commandes clients
// ---------------------------------------------------------------

export async function createSalesOrder(formData: FormData) {
  const organization = await requireOrganization();
  const customerId = text(formData, "customer_id");
  if (!customerId) return;

  const supabase = await createClient();
  const { data: number, error: numberError } = await supabase.rpc("next_document_number", {
    p_organization_id: organization.organizationId,
    p_kind: "sales",
    p_prefix: "CC",
  });
  if (numberError) throw new Error(numberError.message);

  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("sales_orders")
    .insert({
      organization_id: organization.organizationId,
      customer_id: customerId,
      number,
      requested_on: text(formData, "requested_on"),
      created_by: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/pepiniere/commandes");
  redirect(`/pepiniere/commandes/${data.id}`);
}

export async function updateSalesOrder(formData: FormData) {
  const id = String(formData.get("sales_order_id") ?? "");
  if (!id) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["reference", "requested_on", "notes"]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }
  if (formData.has("status")) {
    const status = text(formData, "status");
    // Comme pour les achats : seuls les états décidés se saisissent.
    if (status === "draft" || status === "confirmed" || status === "cancelled") {
      patch.status = status;
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sales_orders").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/pepiniere/commandes/${id}`);
  revalidatePath("/pepiniere/commandes");
}

/**
 * Ajoute une ligne, et réserve le stock si un lot est désigné.
 *
 * Réserver au moment de la commande est le comportement attendu : le
 * client repart en pensant que ses plantes sont à lui. Ne pas le faire
 * laisserait le même stock vendable à quelqu'un d'autre.
 */
export async function addSalesLine(formData: FormData) {
  const organization = await requireOrganization();
  const orderId = String(formData.get("sales_order_id") ?? "");
  const description = text(formData, "description");
  if (!orderId || !description) return;

  const quantity = parseQuantityOr(String(formData.get("quantity") ?? "1"), 1);
  const lotId = text(formData, "lot_id");
  const supabase = await createClient();

  // La réservation D'ABORD : si le disponible ne suffit pas, la
  // fonction refuse et aucune ligne n'est écrite. L'ordre inverse
  // laisserait une ligne promettant un stock qui n'existe pas.
  if (lotId) {
    const { error } = await supabase.rpc("record_nursery_movement", {
      p_lot_id: lotId,
      p_kind: "reserve",
      p_quantity: Math.round(quantity),
      p_reason: "Commande client",
    });
    if (error) throw new Error(error.message);
  }

  const { data: last } = await supabase
    .from("sales_order_lines")
    .select("position")
    .eq("sales_order_id", orderId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("sales_order_lines").insert({
    organization_id: organization.organizationId,
    sales_order_id: orderId,
    lot_id: lotId,
    position: (last?.position ?? -1) + 1,
    description,
    unit: text(formData, "unit") ?? "u",
    quantity,
    unit_sale_price_cents: inputToCents(String(formData.get("unit_sale_price") ?? "0")),
    vat_rate: parseVatRate(String(formData.get("vat_rate") ?? "20")),
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/pepiniere/commandes/${orderId}`);
  revalidatePath("/pepiniere/stock");
}

export async function deleteSalesLine(formData: FormData) {
  const orderId = String(formData.get("sales_order_id") ?? "");
  const lineId = String(formData.get("line_id") ?? "");
  if (!orderId || !lineId) return;

  const supabase = await createClient();
  const { data: line } = await supabase
    .from("sales_order_lines")
    .select("lot_id, quantity")
    .eq("id", lineId)
    .maybeSingle();
  if (!line) return;

  /**
   * LA GARDE EST ICI, PAS SEULEMENT À L'ÉCRAN.
   *
   * `SalesLines.tsx` ne montre la croix que si rien n'a été livré.
   * C'était la seule protection : masquer un bouton n'empêche ni un
   * envoi fabriqué, ni la course ordinaire — deux personnes sur la même
   * commande, l'une livre pendant que l'autre a la page ouverte depuis
   * dix minutes.
   *
   * Supprimer une ligne partiellement livrée libérerait la TOTALITÉ de
   * la réservation, y compris la part déjà sortie de la pépinière : le
   * stock disponible se mettrait à compter des plantes qui sont chez le
   * client.
   */
  const { count: deliveredLines } = await supabase
    .from("delivery_lines")
    .select("id", { count: "exact", head: true })
    .eq("sales_order_line_id", lineId);

  if ((deliveredLines ?? 0) > 0) {
    await flash(
      "error",
      "Cette ligne a déjà été livrée en tout ou partie : elle ne peut plus être supprimée. Passez par un avoir ou un retour.",
    );
    return;
  }

  await supabase.from("sales_order_lines").delete().eq("id", lineId);

  // Le stock réservé pour cette ligne redevient disponible : l'oublier
  // le laisserait bloqué pour une commande qui n'existe plus.
  if (line?.lot_id) {
    await supabase.rpc("record_nursery_movement", {
      p_lot_id: line.lot_id,
      p_kind: "unreserve",
      p_quantity: Math.round(Number(line.quantity)),
      p_reason: "Ligne de commande supprimée",
    });
  }

  revalidatePath(`/pepiniere/commandes/${orderId}`);
  revalidatePath("/pepiniere/stock");
}

/**
 * Livrer.
 *
 * Le moment où le stock quitte réellement la pépinière. La fonction en
 * base écrit la ligne de livraison, sort le stock par un mouvement
 * `sell` — qui consomme la réservation — et met à jour l'état de la
 * commande. Les trois ensemble, ou aucun.
 */
export async function createDelivery(formData: FormData) {
  const organization = await requireOrganization();
  const orderId = String(formData.get("sales_order_id") ?? "");
  if (!orderId) return;

  const lineIds = formData.getAll("line").map(String);
  if (lineIds.length === 0) return;

  const supabase = await createClient();
  const { data: number, error: numberError } = await supabase.rpc("next_document_number", {
    p_organization_id: organization.organizationId,
    p_kind: "delivery",
    p_prefix: "BL",
  });
  if (numberError) throw new Error(numberError.message);

  const { data: delivery, error: deliveryError } = await supabase
    .from("deliveries")
    .insert({
      organization_id: organization.organizationId,
      sales_order_id: orderId,
      number,
      delivered_on: text(formData, "delivered_on") ?? new Date().toISOString().slice(0, 10),
      carrier: text(formData, "carrier"),
      received_by_name: text(formData, "received_by_name"),
      received_at: text(formData, "received_by_name") ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (deliveryError) throw new Error(deliveryError.message);

  for (const lineId of lineIds) {
    const quantity = parseQuantity(String(formData.get(`quantity-${lineId}`) ?? "0"));
    if (quantity <= 0) continue;

    const { error } = await supabase.rpc("deliver_sales_order_line", {
      p_delivery_id: delivery.id,
      p_sales_order_line_id: lineId,
      p_quantity: quantity,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/pepiniere/commandes/${orderId}`);
  revalidatePath("/pepiniere");
  revalidatePath("/pepiniere/stock");
}
