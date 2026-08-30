"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { inputToCents, parseQuantity } from "@/lib/quotes/types";

/**
 * §11O facturation, §DÉPENSES / TRÉSORERIE.
 *
 * CE MODULE N'EST PAS UNE COMPTABILITÉ CERTIFIÉE, et le document
 * l'interdit deux fois. Il n'y a ni NF525, ni archivage probant, ni
 * journal comptable. Il tient des factures avec assez de rigueur pour
 * qu'un expert-comptable s'en serve, et un export pour les lui donner.
 *
 * AUCUN PAIEMENT N'EST AUTOMATISÉ. « NE PAS automatiser des paiements »
 * figure dans la liste des interdits : enregistrer un encaissement, ici,
 * c'est constater qu'il a eu lieu — jamais le déclencher.
 *
 * ET AUCUNE FACTURE N'EST ENVOYÉE. Comme pour les devis, marquer une
 * facture « émise » enregistre un fait ; c'est l'utilisateur qui la
 * transmet.
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

// ---------------------------------------------------------------
// Factures
// ---------------------------------------------------------------

export async function createInvoice(formData: FormData) {
  const organization = await requireOrganization();
  const customerId = text(formData, "customer_id");
  if (!customerId) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: organization.organizationId,
      customer_id: customerId,
      project_id: text(formData, "project_id"),
      created_by: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/factures");
  redirect(`/factures/${data.id}`);
}

/** Le pont depuis un devis accepté : les montants sont recopiés, jamais relus. */
export async function invoiceFromQuote(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  if (!quoteId) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invoice_from_quote", {
    p_quote_id: quoteId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/factures");
  revalidatePath(`/devis/${quoteId}`);
  redirect(`/factures/${data as string}`);
}

export async function updateInvoice(formData: FormData) {
  const id = String(formData.get("invoice_id") ?? "");
  if (!id) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["introduction", "terms", "internal_notes", "due_on"]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update(patch).eq("id", id);
  // Le déclencheur en base refuse de toucher au contenu d'une facture
  // émise, avec un message qui explique pourquoi et quoi faire à la
  // place. On le laisse remonter tel quel.
  if (error) throw new Error(error.message);

  revalidatePath(`/factures/${id}`);
}

export async function addInvoiceLine(formData: FormData) {
  const organization = await requireOrganization();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const description = text(formData, "description");
  if (!invoiceId || !description) return;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("invoice_lines")
    .select("position")
    .eq("invoice_id", invoiceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("invoice_lines").insert({
    organization_id: organization.organizationId,
    invoice_id: invoiceId,
    position: (last?.position ?? -1) + 1,
    description,
    unit: text(formData, "unit") ?? "u",
    quantity: parseQuantity(String(formData.get("quantity") ?? "1")) || 1,
    unit_price_cents: inputToCents(String(formData.get("unit_price") ?? "0")),
    vat_rate: parseQuantity(String(formData.get("vat_rate") ?? "20")) || 20,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/factures/${invoiceId}`);
}

export async function deleteInvoiceLine(formData: FormData) {
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const lineId = String(formData.get("line_id") ?? "");
  if (!invoiceId || !lineId) return;

  const supabase = await createClient();
  const { error } = await supabase.from("invoice_lines").delete().eq("id", lineId);
  if (error) throw new Error(error.message);

  revalidatePath(`/factures/${invoiceId}`);
}

/**
 * Émettre.
 *
 * Le numéro est attribué ici et nulle part ailleurs : le donner à la
 * création laisserait un trou dans la séquence à chaque brouillon
 * abandonné, et c'est la première chose qu'un comptable regarde.
 *
 * Rien n'est envoyé. L'utilisateur transmet la facture lui-même.
 */
export async function issueInvoice(formData: FormData) {
  const id = String(formData.get("invoice_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_invoice", {
    p_invoice_id: id,
    p_due_in_days: Math.round(parseQuantity(String(formData.get("due_in_days") ?? "30"))) || 30,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/factures/${id}`);
  revalidatePath("/factures");
}

export async function cancelInvoice(formData: FormData) {
  const id = String(formData.get("invoice_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/factures/${id}`);
  revalidatePath("/factures");
}

// ---------------------------------------------------------------
// Avoirs
// ---------------------------------------------------------------

/**
 * Le mécanisme de correction.
 *
 * On ne rature pas une facture émise : on émet un avoir qui la corrige,
 * et les deux documents restent. Plus lourd que de retoucher une ligne,
 * et c'est le but.
 */
export async function createCreditNote(formData: FormData) {
  const organization = await requireOrganization();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const description = text(formData, "description");
  const amount = inputToCents(String(formData.get("amount") ?? "0"));
  if (!invoiceId || !description || amount <= 0) return;

  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("customer_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return;

  const { data: number, error: numberError } = await supabase.rpc("next_document_number", {
    p_organization_id: organization.organizationId,
    p_kind: "credit",
    p_prefix: "AV",
  });
  if (numberError) throw new Error(numberError.message);

  const { data: user } = await supabase.auth.getUser();
  const { data: note, error } = await supabase
    .from("credit_notes")
    .insert({
      organization_id: organization.organizationId,
      invoice_id: invoiceId,
      customer_id: invoice.customer_id,
      number,
      reason: text(formData, "reason") ?? "",
      issued_on: new Date().toISOString().slice(0, 10),
      // Émis immédiatement : un avoir en brouillon ne corrige rien, et
      // on ne l'écrit que lorsqu'on a décidé de créditer.
      issued_at: new Date().toISOString(),
      created_by: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: lineError } = await supabase.from("credit_note_lines").insert({
    organization_id: organization.organizationId,
    credit_note_id: note.id,
    position: 0,
    description,
    quantity: 1,
    unit_price_cents: amount,
    vat_rate: parseQuantity(String(formData.get("vat_rate") ?? "20")) || 20,
  });
  if (lineError) throw new Error(lineError.message);

  revalidatePath(`/factures/${invoiceId}`);
  revalidatePath("/factures");
}

// ---------------------------------------------------------------
// Encaissements
// ---------------------------------------------------------------

/**
 * Constater un règlement, et l'affecter à une facture.
 *
 * Constater, jamais déclencher : Oasis ne touche à aucun compte
 * bancaire. §"NE PAS automatiser des paiements."
 */
export async function recordPayment(formData: FormData) {
  const organization = await requireOrganization();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const amount = inputToCents(String(formData.get("amount") ?? "0"));
  if (!invoiceId || amount <= 0) return;

  const supabase = await createClient();
  const { data: invoice } = await supabase
    .from("invoices")
    .select("customer_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return;

  const { data: user } = await supabase.auth.getUser();
  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      organization_id: organization.organizationId,
      customer_id: invoice.customer_id,
      amount_cents: amount,
      method: text(formData, "method") ?? "transfer",
      received_on: text(formData, "received_on") ?? new Date().toISOString().slice(0, 10),
      reference: text(formData, "reference"),
      recorded_by: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // L'affectation recalcule le statut de la facture dans la même
  // opération : séparés, un encaissement enregistré sans mise à jour
  // laisserait une facture soldée affichée comme impayée.
  const { error: allocationError } = await supabase.rpc("allocate_payment", {
    p_payment_id: payment.id,
    p_invoice_id: invoiceId,
    p_amount_cents: amount,
  });
  if (allocationError) throw new Error(allocationError.message);

  revalidatePath(`/factures/${invoiceId}`);
  revalidatePath("/factures");
}

// ---------------------------------------------------------------
// Dépenses
// ---------------------------------------------------------------

export async function recordExpense(formData: FormData) {
  const organization = await requireOrganization();
  const description = text(formData, "description");
  const amount = inputToCents(String(formData.get("amount") ?? "0"));
  if (!description || amount <= 0) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const projectId = text(formData, "project_id");
  const { error } = await supabase.from("business_expenses").insert({
    organization_id: organization.organizationId,
    description,
    amount_cents: amount,
    vat_cents: inputToCents(String(formData.get("vat") ?? "0")),
    spent_on: text(formData, "spent_on") ?? new Date().toISOString().slice(0, 10),
    supplier_id: text(formData, "supplier_id"),
    project_id: projectId,
    payment_method: text(formData, "payment_method"),
    invoice_reference: text(formData, "invoice_reference"),
    recorded_by: user.user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/factures/tresorerie");
  // Une dépense rattachée à un chantier change son coût réel : sans
  // cette invalidation, la fiche du chantier afficherait l'ancien.
  if (projectId) revalidatePath(`/projets/${projectId}`);
}

export async function deleteExpense(formData: FormData) {
  const id = String(formData.get("expense_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { data } = await supabase
    .from("business_expenses")
    .delete()
    .eq("id", id)
    .select("project_id")
    .maybeSingle();

  revalidatePath("/factures/tresorerie");
  if (data?.project_id) revalidatePath(`/projets/${data.project_id}`);
}

// ---------------------------------------------------------------
// Retards
// ---------------------------------------------------------------

/**
 * Marque en retard ce qui l'est.
 *
 * Appelé au chargement de la liste plutôt que par une tâche planifiée :
 * Oasis n'en a pas encore, et un statut faux entre deux passages serait
 * pire que pas de statut du tout.
 */
export async function refreshOverdue(): Promise<number> {
  const organization = await requireOrganization();
  const supabase = await createClient();
  const { data } = await supabase.rpc("refresh_overdue_invoices", {
    p_organization_id: organization.organizationId,
  });
  return (data as number) ?? 0;
}

/**
 * Facturer un chantier.
 *
 * Un chantier terminé se facture au DEVIS qui l'a fait naître, pas à ce
 * qu'il a coûté : les ressources d'un chantier sont au prix d'achat, et
 * facturer à ce prix-là reviendrait à travailler gratuitement. C'est
 * exactement l'inverse de la règle du Milestone 6, et pour la même
 * raison — coût et prix de vente ne se confondent jamais.
 *
 * Sans devis, on ne peut inventer aucun montant : la facture est créée
 * vide, rattachée au chantier et à son client, et l'écran dit pourquoi.
 */
export async function invoiceFromProject(formData: FormData) {
  const organization = await requireOrganization();
  const projectId = String(formData.get("project_id") ?? "");
  if (!projectId) return;

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, customer_id, quote_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return;

  // Une facture déjà rattachée à ce chantier : on y retourne plutôt que
  // d'en fabriquer une seconde.
  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("project_id", projectId)
    .is("archived_at", null)
    .neq("status", "cancelled")
    .maybeSingle();
  if (existing) redirect(`/factures/${existing.id}`);

  if (project.quote_id) {
    const { data, error } = await supabase.rpc("create_invoice_from_quote", {
      p_quote_id: project.quote_id,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/factures");
    revalidatePath(`/projets/${projectId}`);
    redirect(`/factures/${data as string}`);
  }

  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      organization_id: organization.organizationId,
      customer_id: project.customer_id,
      project_id: projectId,
      introduction: project.name,
      created_by: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/factures");
  revalidatePath(`/projets/${projectId}`);
  redirect(`/factures/${data.id}`);
}
