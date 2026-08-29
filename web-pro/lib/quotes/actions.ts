"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { inputToCents, parseQuantity, type QuoteStatus } from "./types";

/**
 * §11E — devis.
 *
 * Comme pour le CRM, l'organisation est toujours résolue côté serveur :
 * un champ caché la nommant serait la chose évidente à écrire et la
 * chose évidente à trafiquer. RLS refuserait de toute façon, mais il n'y
 * a aucune raison d'envoyer la tentative.
 *
 * CE QUE CES ACTIONS NE FONT PAS : envoyer. « NE PAS envoyer
 * automatiquement des devis » figure dans la liste des interdits.
 * Marquer un devis « envoyé » enregistre un fait — l'utilisateur l'a
 * transmis — et ne déclenche aucun courriel.
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

export async function createQuote(formData: FormData) {
  const organization = await getActiveOrganization();
  if (!organization) redirect("/bienvenue");

  const customerId = text(formData, "customer_id");
  if (!customerId) return;

  const supabase = await createClient();

  const { data: number, error: numberError } = await supabase.rpc("next_quote_number", {
    p_organization_id: organization.organizationId,
  });
  if (numberError) throw new Error(numberError.message);

  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      organization_id: organization.organizationId,
      customer_id: customerId,
      garden_id: text(formData, "garden_id"),
      opportunity_id: text(formData, "opportunity_id"),
      number,
      title: text(formData, "title") ?? "Devis",
      // Un mois, l'usage courant. Modifiable sur la fiche : ce n'est pas
      // une règle, seulement un défaut qui évite un champ vide.
      valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
      created_by: user.user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/devis");
  redirect(`/devis/${data.id}`);
}

export async function updateQuote(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  if (!quoteId) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["title", "introduction", "terms", "internal_notes", "valid_until"]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }
  if (formData.has("global_discount_percent")) {
    const raw = parseQuantity(String(formData.get("global_discount_percent") ?? "0"));
    patch.global_discount_percent = Math.min(100, Math.max(0, raw));
  }

  const supabase = await createClient();
  const { error } = await supabase.from("quotes").update(patch).eq("id", quoteId);
  if (error) throw new Error(error.message);

  revalidatePath(`/devis/${quoteId}`);
}

/**
 * Change l'état du devis.
 *
 * Les horodatages accompagnent le changement plutôt que d'être saisis :
 * « envoyé le » est la date où l'on a cliqué, personne ne doit la taper.
 * Aucun courriel n'est émis — voir l'en-tête du fichier.
 */
export async function setQuoteStatus(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  const status = String(formData.get("status") ?? "") as QuoteStatus;
  if (!quoteId || !status) return;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "sent") patch.sent_at = now;
  if (status === "viewed") patch.viewed_at = now;
  if (status === "accepted" || status === "rejected") patch.decided_at = now;
  if (status === "rejected") patch.rejection_reason = text(formData, "rejection_reason");

  const supabase = await createClient();
  const { error } = await supabase.from("quotes").update(patch).eq("id", quoteId);
  if (error) throw new Error(error.message);

  revalidatePath(`/devis/${quoteId}`);
  revalidatePath("/devis");
}

// ---------------------------------------------------------------
// Sections et lignes
// ---------------------------------------------------------------

export async function addSection(formData: FormData) {
  const organization = await getActiveOrganization();
  if (!organization) return;
  const quoteId = String(formData.get("quote_id") ?? "");
  const title = text(formData, "title");
  if (!quoteId || !title) return;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("quote_sections")
    .select("position")
    .eq("quote_id", quoteId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("quote_sections").insert({
    organization_id: organization.organizationId,
    quote_id: quoteId,
    title,
    position: (last?.position ?? -1) + 1,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/devis/${quoteId}`);
}

export async function deleteSection(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  const sectionId = String(formData.get("section_id") ?? "");
  if (!quoteId || !sectionId) return;

  const supabase = await createClient();
  // Les lignes ne sont PAS supprimées avec la section : `on delete set
  // null` les renvoie dans le bloc sans section. Supprimer un titre par
  // erreur ne doit jamais emporter le chiffrage avec lui.
  const { error } = await supabase.from("quote_sections").delete().eq("id", sectionId);
  if (error) throw new Error(error.message);

  revalidatePath(`/devis/${quoteId}`);
}

/**
 * Ajoute une ligne, en photographiant le prix du catalogue s'il y en a
 * un.
 *
 * §HISTORIQUE — la ligne garde SA copie. `catalog_item_id` ne sert
 * ensuite qu'à savoir d'où elle vient, jamais à relire un prix.
 */
export async function addLine(formData: FormData) {
  const organization = await getActiveOrganization();
  if (!organization) return;
  const quoteId = String(formData.get("quote_id") ?? "");
  if (!quoteId) return;

  const supabase = await createClient();
  const catalogItemId = text(formData, "catalog_item_id");

  let description = text(formData, "description") ?? "";
  let unit = text(formData, "unit") ?? "u";
  let costCents = 0;
  let saleCents = 0;
  let vatRate = 20;

  if (catalogItemId) {
    const { data: item } = await supabase
      .from("catalog_items")
      .select("name, unit")
      .eq("id", catalogItemId)
      .maybeSingle();
    if (item) {
      description = description || item.name;
      unit = item.unit;
    }
    // Le tarif EN COURS de la grille par défaut : `valid_until is null`.
    const { data: price } = await supabase
      .from("price_book_items")
      .select("purchase_price_cents, sale_price_cents, vat_rate, price_books!inner(is_default)")
      .eq("catalog_item_id", catalogItemId)
      .is("valid_until", null)
      .eq("price_books.is_default", true)
      .maybeSingle();
    if (price) {
      costCents = price.purchase_price_cents;
      saleCents = price.sale_price_cents;
      vatRate = price.vat_rate;
    }
  }

  // Une saisie manuelle l'emporte toujours sur le tarif : c'est
  // l'utilisateur qui chiffre, le catalogue ne fait que proposer.
  if (formData.has("unit_sale_price")) {
    const typed = String(formData.get("unit_sale_price") ?? "").trim();
    if (typed !== "") saleCents = inputToCents(typed);
  }
  if (formData.has("unit_cost")) {
    const typed = String(formData.get("unit_cost") ?? "").trim();
    if (typed !== "") costCents = inputToCents(typed);
  }
  if (formData.has("vat_rate")) {
    const typed = String(formData.get("vat_rate") ?? "").trim();
    if (typed !== "") vatRate = parseQuantity(typed);
  }

  if (!description) return;

  const { data: last } = await supabase
    .from("quote_lines")
    .select("position")
    .eq("quote_id", quoteId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("quote_lines").insert({
    organization_id: organization.organizationId,
    quote_id: quoteId,
    section_id: text(formData, "section_id"),
    catalog_item_id: catalogItemId,
    position: (last?.position ?? -1) + 1,
    description,
    unit,
    quantity: parseQuantity(String(formData.get("quantity") ?? "1")) || 1,
    unit_cost_cents: costCents,
    unit_sale_price_cents: saleCents,
    vat_rate: vatRate,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/devis/${quoteId}`);
}

export async function updateLine(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  const lineId = String(formData.get("line_id") ?? "");
  if (!quoteId || !lineId) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (formData.has("description")) patch.description = text(formData, "description") ?? "";
  if (formData.has("unit")) patch.unit = text(formData, "unit") ?? "u";
  if (formData.has("quantity")) {
    patch.quantity = parseQuantity(String(formData.get("quantity") ?? "0"));
  }
  if (formData.has("unit_cost")) {
    patch.unit_cost_cents = inputToCents(String(formData.get("unit_cost") ?? "0"));
  }
  if (formData.has("unit_sale_price")) {
    patch.unit_sale_price_cents = inputToCents(String(formData.get("unit_sale_price") ?? "0"));
  }
  if (formData.has("vat_rate")) patch.vat_rate = parseQuantity(String(formData.get("vat_rate") ?? "20"));
  if (formData.has("discount_percent")) {
    const raw = parseQuantity(String(formData.get("discount_percent") ?? "0"));
    patch.discount_percent = Math.min(100, Math.max(0, raw));
  }
  if (formData.has("section_id")) patch.section_id = text(formData, "section_id");

  const supabase = await createClient();
  const { error } = await supabase.from("quote_lines").update(patch).eq("id", lineId);
  if (error) throw new Error(error.message);

  revalidatePath(`/devis/${quoteId}`);
}

export async function deleteLine(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  const lineId = String(formData.get("line_id") ?? "");
  if (!quoteId || !lineId) return;

  const supabase = await createClient();
  const { error } = await supabase.from("quote_lines").delete().eq("id", lineId);
  if (error) throw new Error(error.message);

  revalidatePath(`/devis/${quoteId}`);
}

// ---------------------------------------------------------------
// Révisions
// ---------------------------------------------------------------

/**
 * Fige le devis tel qu'il est.
 *
 * Instantané JSON, comme les révisions du Digital Twin : une version
 * remise au client doit continuer de montrer ce qu'il a reçu, même
 * après que le devis courant ait entièrement changé.
 */
export async function captureQuoteRevision(formData: FormData) {
  const organization = await getActiveOrganization();
  if (!organization) return;
  const quoteId = String(formData.get("quote_id") ?? "");
  const label = text(formData, "label") ?? "Version";
  if (!quoteId) return;

  const supabase = await createClient();
  const [{ data: quote }, { data: sections }, { data: lines }, { data: totals }] =
    await Promise.all([
      supabase.from("quotes").select("*").eq("id", quoteId).maybeSingle(),
      supabase.from("quote_sections").select("*").eq("quote_id", quoteId).order("position"),
      supabase.from("quote_lines").select("*").eq("quote_id", quoteId).order("position"),
      supabase.from("quote_totals").select("*").eq("quote_id", quoteId).maybeSingle(),
    ]);

  if (!quote) return;

  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("quote_revisions").insert({
    organization_id: organization.organizationId,
    quote_id: quoteId,
    label,
    snapshot: { quote, sections: sections ?? [], lines: lines ?? [], totals },
    total_excluding_vat_cents: totals?.total_excluding_vat_cents ?? 0,
    created_by: user.user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/devis/${quoteId}`);
}
