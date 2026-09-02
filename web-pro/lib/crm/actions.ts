"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";

/**
 * Server Actions for the CRM.
 *
 * Every one of these resolves the organization server-side rather than
 * taking an organization id from the form. A hidden field naming the
 * organization would be the obvious thing to write and the obvious
 * thing to tamper with — RLS would still refuse it, but there is no
 * reason to send the attempt at all.
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

export async function createCustomer(formData: FormData) {
  const organization = await requireOrganization();

  const displayName = text(formData, "display_name");
  if (!displayName) return;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crm_customers")
    .insert({
      organization_id: organization.organizationId,
      display_name: displayName,
      kind: text(formData, "kind") ?? "individual",
      lifecycle_stage: text(formData, "lifecycle_stage") ?? "lead",
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      billing_address_line1: text(formData, "billing_address_line1"),
      billing_postal_code: text(formData, "billing_postal_code"),
      billing_city: text(formData, "billing_city"),
      source: text(formData, "source"),
      notes: text(formData, "notes"),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath("/crm", "layout");
  redirect(`/crm/clients/${data.id}`);
}

export async function updateProspectStatus(formData: FormData) {
  const customerId = String(formData.get("customer_id") ?? "");
  const status = String(formData.get("prospect_status") ?? "");
  if (!customerId || !status) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("crm_customers")
    .update({ prospect_status: status, updated_at: new Date().toISOString() })
    .eq("id", customerId);

  if (error) throw new Error(error.message);
  revalidatePath("/crm", "layout");
}

export async function convertLead(formData: FormData) {
  const customerId = String(formData.get("customer_id") ?? "");
  if (!customerId) return;

  const supabase = await createClient();
  // A Postgres function, not an update from here: it also writes the
  // audit event, and the two must not be able to disagree.
  const { error } = await supabase.rpc("convert_lead_to_customer", {
    customer_id: customerId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/crm", "layout");
}

export async function addContact(formData: FormData) {
  const organization = await requireOrganization();

  const customerId = String(formData.get("customer_id") ?? "");
  const lastName = text(formData, "last_name");
  if (!customerId || !lastName) return;

  const supabase = await createClient();
  const { error } = await supabase.from("crm_contacts").insert({
    organization_id: organization.organizationId,
    customer_id: customerId,
    last_name: lastName,
    first_name: text(formData, "first_name"),
    job_title: text(formData, "job_title"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/crm/clients/${customerId}`);
}

export async function addSite(formData: FormData) {
  const organization = await requireOrganization();

  const customerId = String(formData.get("customer_id") ?? "");
  const name = text(formData, "name");
  if (!customerId || !name) return;

  const supabase = await createClient();
  const { error } = await supabase.from("crm_customer_sites").insert({
    organization_id: organization.organizationId,
    customer_id: customerId,
    name,
    site_type: text(formData, "site_type") ?? "residence",
    address_line1: text(formData, "address_line1"),
    postal_code: text(formData, "postal_code"),
    city: text(formData, "city"),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/crm/clients/${customerId}`);
}

/**
 * Creates a real `gardens` row and attaches it to the site.
 *
 * `gardens.id` has no database default — the table is written by the
 * iOS app, which generates its own UUIDs and upserts on them. So the id
 * must be supplied here too; omitting it fails with a not-null
 * violation, which is exactly how this was discovered.
 */
export async function createGardenForSite(formData: FormData) {
  const organization = await requireOrganization();

  const siteId = String(formData.get("site_id") ?? "");
  const customerId = String(formData.get("customer_id") ?? "");
  const name = text(formData, "garden_name");
  if (!siteId || !name) return;

  const supabase = await createClient();
  const gardenId = crypto.randomUUID();

  const { error: gardenError } = await supabase.from("gardens").insert({
    id: gardenId,
    workspace_id: organization.workspaceId,
    name,
  });
  if (gardenError) throw new Error(gardenError.message);

  const { error: linkError } = await supabase
    .from("crm_customer_sites")
    .update({ garden_id: gardenId })
    .eq("id", siteId);
  if (linkError) throw new Error(linkError.message);

  revalidatePath(`/crm/clients/${customerId}`);
}

export async function addActivity(formData: FormData) {
  const organization = await requireOrganization();

  const customerId = String(formData.get("customer_id") ?? "");
  if (!customerId) return;

  const supabase = await createClient();
  const { error } = await supabase.from("crm_activities").insert({
    organization_id: organization.organizationId,
    customer_id: customerId,
    activity_type: text(formData, "activity_type") ?? "note",
    subject: text(formData, "subject"),
    body: text(formData, "body"),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/crm/clients/${customerId}`);
}

export async function createOpportunity(formData: FormData) {
  const organization = await requireOrganization();

  const customerId = String(formData.get("customer_id") ?? "");
  const title = text(formData, "title");
  if (!customerId || !title) return;

  const rawValue = text(formData, "estimated_value");
  // Euros in the form, centimes in the database.
  const parsed = rawValue ? Number(rawValue.replace(",", ".")) : NaN;
  const cents = Number.isFinite(parsed) ? Math.round(parsed * 100) : null;

  const supabase = await createClient();
  const { error } = await supabase.from("crm_opportunities").insert({
    organization_id: organization.organizationId,
    customer_id: customerId,
    title,
    stage: text(formData, "stage") ?? "qualification",
    estimated_value_cents: cents,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/crm/clients/${customerId}`);
  revalidatePath("/crm/opportunites");
}
