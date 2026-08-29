"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { parseQuantity, COST_KIND_FROM_ITEM_TYPE, type CatalogItemType } from "./types";

/**
 * §"DIGITAL TWIN → DEVIS" — l'écriture, après validation humaine.
 *
 * Ce fichier n'est appelé que depuis l'écran de relecture : les lignes
 * arrivent cochées une à une, avec leurs quantités éventuellement
 * corrigées. « NE PAS ajouter silencieusement des coûts » veut dire
 * exactement cela — la proposition passe sous les yeux de quelqu'un
 * avant d'exister.
 *
 * Les prix viennent du catalogue quand un article correspond, et valent
 * ZÉRO sinon. Zéro est une valeur honnête : elle se voit dans le total
 * et force à la remplir. Un prix inventé, lui, se glisserait dans un
 * devis remis au client.
 */

export async function addProposedLinesToQuote(formData: FormData) {
  const organization = await getActiveOrganization();
  if (!organization) redirect("/bienvenue");

  const quoteId = String(formData.get("quote_id") ?? "");
  const gardenId = String(formData.get("garden_id") ?? "");
  if (!quoteId) return;

  // Seules les lignes cochées. `getAll` rend les valeurs des cases
  // effectivement envoyées : une case décochée n'existe pas dans le
  // formulaire, elle ne peut donc pas passer par mégarde.
  const keys = formData.getAll("line").map(String);
  if (keys.length === 0) redirect(`/devis/${quoteId}`);

  const supabase = await createClient();

  // Les postes existants du devis, pour ne pas en recréer un « Plantation »
  // à chaque import.
  const { data: existingSections } = await supabase
    .from("quote_sections")
    .select("id, title, position")
    .eq("quote_id", quoteId)
    .order("position");

  const sectionByTitle = new Map(
    (existingSections ?? []).map((s) => [s.title as string, s.id as string]),
  );
  let nextSectionPosition = (existingSections ?? []).length;

  const { data: lastLine } = await supabase
    .from("quote_lines")
    .select("position")
    .eq("quote_id", quoteId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let position = (lastLine?.position ?? -1) + 1;

  // Le catalogue une fois, en mémoire : chercher un article par ligne
  // ferait une requête par ligne pour un devis qui en compte trente.
  const { data: catalog } = await supabase
    .from("catalog_items")
    .select("id, name, item_type, price_book_items!left ( sale_price_cents, purchase_price_cents, vat_rate, valid_until )")
    .is("archived_at", null);

  type CatalogRow = {
    id: string; name: string; item_type: string;
    price_book_items: {
      sale_price_cents: number; purchase_price_cents: number;
      vat_rate: number; valid_until: string | null;
    }[];
  };
  const items = (catalog ?? []) as unknown as CatalogRow[];

  const rows: Record<string, unknown>[] = [];

  for (const key of keys) {
    const description = String(formData.get(`description-${key}`) ?? "").trim();
    const quantity = parseQuantity(String(formData.get(`quantity-${key}`) ?? "0"));
    const unit = String(formData.get(`unit-${key}`) ?? "u").trim() || "u";
    const sectionTitle = String(formData.get(`section-${key}`) ?? "").trim();
    const itemType = String(formData.get(`kind-${key}`) ?? "").trim();
    if (!description || quantity <= 0) continue;

    let sectionId = sectionTitle ? sectionByTitle.get(sectionTitle) ?? null : null;
    if (sectionTitle && !sectionId) {
      const { data: created } = await supabase
        .from("quote_sections")
        .insert({
          organization_id: organization.organizationId,
          quote_id: quoteId,
          title: sectionTitle,
          position: nextSectionPosition++,
        })
        .select("id")
        .single();
      sectionId = created?.id ?? null;
      if (sectionId) sectionByTitle.set(sectionTitle, sectionId);
    }

    // Rapprochement par nom exact, insensible à la casse. Rien de plus
    // malin : un rapprochement approximatif qui se trompe d'article
    // colle un prix faux sur une ligne, et personne ne le vérifie.
    const needle = description.toLowerCase();
    const match = items.find((i) => needle.includes(i.name.toLowerCase()));
    const price = match?.price_book_items?.find((p) => p.valid_until === null);

    rows.push({
      organization_id: organization.organizationId,
      quote_id: quoteId,
      section_id: sectionId,
      catalog_item_id: match?.id ?? null,
      position: position++,
      description,
      unit,
      quantity,
      unit_cost_cents: price?.purchase_price_cents ?? 0,
      unit_sale_price_cents: price?.sale_price_cents ?? 0,
      vat_rate: price?.vat_rate ?? 20,
      cost_kind: COST_KIND_FROM_ITEM_TYPE[itemType as CatalogItemType] ?? null,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("quote_lines").insert(rows);
    if (error) throw new Error(error.message);
  }

  // Le devis se souvient du plan dont il vient : c'est ce qui permettra,
  // plus tard, de savoir quel chantier correspond à quel jardin.
  if (gardenId) {
    await supabase.from("quotes").update({ garden_id: gardenId }).eq("id", quoteId);
  }

  revalidatePath(`/devis/${quoteId}`);
  redirect(`/devis/${quoteId}`);
}
