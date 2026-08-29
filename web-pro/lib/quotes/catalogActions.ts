"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization, requireOrganization } from "@/lib/auth/organization";
import { inputToCents, parseQuantity, type CatalogItem } from "./types";

/**
 * §11D — bibliothèque de prix.
 *
 * Le prix n'est pas dans l'article : il vit dans une grille tarifaire
 * datée. Changer un prix ne modifie donc rien, il ferme une période et
 * en ouvre une autre — c'est `set_price_book_price` en base qui le fait,
 * en une seule opération, parce que laissé à l'application ce geste
 * finirait tôt ou tard par un simple UPDATE qui effacerait l'historique.
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * La grille par défaut de l'organisation, créée à la première demande.
 *
 * Créée paresseusement plutôt qu'à l'inscription : une entreprise qui
 * ne chiffre jamais n'a pas besoin d'une grille vide dans ses écrans.
 */
export async function defaultPriceBookId(): Promise<string | null> {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("price_books")
    .select("id")
    .eq("is_default", true)
    .is("archived_at", null)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("price_books")
    .insert({
      organization_id: organization.organizationId,
      name: "Tarif courant",
      is_default: true,
    })
    .select("id")
    .single();
  if (error) return null;
  return data.id;
}

/**
 * Le catalogue avec son tarif en cours.
 *
 * Une seule requête plutôt qu'une par article : `price_book_items` est
 * joint sur `valid_until is null`, qui est exactement la définition de
 * « le prix d'aujourd'hui ».
 */
export async function listCatalog(search?: string, type?: string): Promise<CatalogItem[]> {
  const supabase = await createClient();

  let request = supabase
    .from("catalog_items")
    .select(`
      id, item_type, name, reference, unit, description,
      price_book_items!left (
        purchase_price_cents, sale_price_cents, vat_rate, valid_until,
        price_books!inner ( is_default )
      )
    `)
    .is("archived_at", null)
    .order("name")
    .limit(500);

  if (type) request = request.eq("item_type", type);
  if (search) {
    const safe = search.replace(/[%,()]/g, " ");
    request = request.or(`name.ilike.%${safe}%,reference.ilike.%${safe}%`);
  }

  const { data } = await request;

  return (data ?? []).map((row) => {
    // PostgREST rend les jointures imbriquées sous forme de TABLEAU,
    // même quand la relation est unique — d'où le `unknown` puis la
    // forme réelle, et le `.some()` sur `price_books`.
    const prices = (row.price_book_items ?? []) as unknown as {
      purchase_price_cents: number; sale_price_cents: number; vat_rate: number;
      valid_until: string | null; price_books: { is_default: boolean }[] | { is_default: boolean } | null;
    }[];
    // Le tarif en cours de la grille par défaut. Les périodes closes
    // remontent aussi dans la jointure : on ne garde que celle ouverte.
    const isDefault = (b: typeof prices[number]["price_books"]) =>
      Array.isArray(b) ? b.some((x) => x.is_default) : Boolean(b?.is_default);
    const current = prices.find((p) => p.valid_until === null && isDefault(p.price_books));
    return {
      id: row.id,
      item_type: row.item_type,
      name: row.name,
      reference: row.reference,
      unit: row.unit,
      description: row.description,
      purchase_price_cents: current?.purchase_price_cents ?? null,
      sale_price_cents: current?.sale_price_cents ?? null,
      vat_rate: current?.vat_rate ?? null,
    } as CatalogItem;
  });
}

export async function createCatalogItem(formData: FormData) {
  const organization = await requireOrganization();

  const name = text(formData, "name");
  if (!name) return;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_items")
    .insert({
      organization_id: organization.organizationId,
      item_type: text(formData, "item_type") ?? "material",
      name,
      reference: text(formData, "reference"),
      unit: text(formData, "unit") ?? "u",
      description: text(formData, "description"),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Un article sans prix n'est pas chiffrable : si l'utilisateur en a
  // saisi un, on l'enregistre dans la foulée plutôt que de le renvoyer
  // vers un second écran.
  const sale = String(formData.get("sale_price") ?? "").trim();
  if (sale !== "") {
    const bookId = await defaultPriceBookId();
    if (bookId) {
      await supabase.rpc("set_price_book_price", {
        p_price_book_id: bookId,
        p_catalog_item_id: data.id,
        p_purchase_price_cents: inputToCents(String(formData.get("purchase_price") ?? "0")),
        p_sale_price_cents: inputToCents(sale),
        p_vat_rate: parseQuantity(String(formData.get("vat_rate") ?? "20")) || 20,
      });
    }
  }

  revalidatePath("/catalogue");
}

export async function setCatalogPrice(formData: FormData) {
  const catalogItemId = String(formData.get("catalog_item_id") ?? "");
  if (!catalogItemId) return;

  const bookId = await defaultPriceBookId();
  if (!bookId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_price_book_price", {
    p_price_book_id: bookId,
    p_catalog_item_id: catalogItemId,
    p_purchase_price_cents: inputToCents(String(formData.get("purchase_price") ?? "0")),
    p_sale_price_cents: inputToCents(String(formData.get("sale_price") ?? "0")),
    p_vat_rate: parseQuantity(String(formData.get("vat_rate") ?? "20")) || 20,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/catalogue");
}

/**
 * Archive au lieu de supprimer.
 *
 * Un article supprimé casserait la traçabilité des lignes de devis qui
 * le citent — `catalog_item_id` deviendrait nul et on perdrait d'où
 * venait le chiffrage. Les montants, eux, ne bougeraient pas : ils sont
 * photographiés sur la ligne.
 */
export async function archiveCatalogItem(formData: FormData) {
  const id = String(formData.get("catalog_item_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("catalog_items")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/catalogue");
}
