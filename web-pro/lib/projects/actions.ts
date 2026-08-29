"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization, requireOrganization } from "@/lib/auth/organization";
import { inputToCents, parseQuantity } from "@/lib/quotes/types";
import { DEFAULT_PHASES } from "./types";

/**
 * §11F — chantiers.
 *
 * L'AVANCEMENT NE SE DÉDUIT PAS DE LA DÉPENSE. Aucune action ici ne
 * touche à `progress_percent` en réponse à un coût saisi : avoir
 * consommé 80 % du budget ne veut pas dire que 80 % du chantier est
 * fait, et c'est justement leur écart qui renseigne le conducteur de
 * travaux.
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * §DEVIS ACCEPTÉ — « Bouton : Transformer en projet. »
 *
 * Tout le travail est fait par `create_project_from_quote` en base :
 * créer un chantier, ses phases et ses vingt ressources doit réussir en
 * entier ou pas du tout. Enchaîné depuis le web, un incident réseau au
 * milieu laisserait un chantier à moitié peuplé que rien ne distingue
 * d'un chantier normal.
 */
export async function createProjectFromQuote(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  if (!quoteId) return;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_project_from_quote", {
    p_quote_id: quoteId,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/projets");
  revalidatePath(`/devis/${quoteId}`);
  redirect(`/projets/${data as string}`);
}

/** Un chantier parti de rien, avec les phases usuelles. */
export async function createProject(formData: FormData) {
  const organization = await requireOrganization();

  const customerId = text(formData, "customer_id");
  if (!customerId) return;

  const supabase = await createClient();
  const { data: number, error: numberError } = await supabase.rpc("next_project_number", {
    p_organization_id: organization.organizationId,
  });
  if (numberError) throw new Error(numberError.message);

  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      organization_id: organization.organizationId,
      customer_id: customerId,
      number,
      name: text(formData, "name") ?? "Chantier",
      created_by: user.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await supabase.from("project_phases").insert(
    DEFAULT_PHASES.map((title, position) => ({
      organization_id: organization.organizationId,
      project_id: data.id,
      title,
      position,
    })),
  );

  revalidatePath("/projets");
  redirect(`/projets/${data.id}`);
}

export async function updateProject(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  if (!projectId) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of [
    "name", "notes", "planned_start_on", "planned_end_on",
    "actual_start_on", "actual_end_on",
  ]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }
  if (formData.has("status")) {
    const status = text(formData, "status");
    patch.status = status;
    // Un chantier qui démarre note sa date de démarrage, et celui qui
    // se termine sa date de fin — sauf si elles sont déjà renseignées.
    // Personne ne devrait avoir à taper « aujourd'hui ».
    const today = new Date().toISOString().slice(0, 10);
    if (status === "inProgress") patch.actual_start_on = patch.actual_start_on ?? today;
    if (status === "completed" || status === "handedOver") {
      patch.actual_end_on = patch.actual_end_on ?? today;
    }
  }

  const supabase = await createClient();
  if (patch.actual_start_on === undefined) delete patch.actual_start_on;
  if (patch.actual_end_on === undefined) delete patch.actual_end_on;

  const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
  revalidatePath("/projets");
}

// ---------------------------------------------------------------
// Phases et tâches
// ---------------------------------------------------------------

export async function addPhase(formData: FormData) {
  const organization = await requireOrganization();
  const projectId = String(formData.get("project_id") ?? "");
  const title = text(formData, "title");
  if (!projectId || !title) return;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("project_phases")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("project_phases").insert({
    organization_id: organization.organizationId,
    project_id: projectId,
    title,
    position: (last?.position ?? -1) + 1,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
}

export async function updatePhase(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const phaseId = String(formData.get("phase_id") ?? "");
  if (!projectId || !phaseId) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (formData.has("title")) patch.title = text(formData, "title");
  if (formData.has("status")) patch.status = text(formData, "status");
  if (formData.has("progress_percent")) {
    const raw = parseQuantity(String(formData.get("progress_percent") ?? "0"));
    patch.progress_percent = Math.round(Math.min(100, Math.max(0, raw)));
  }
  for (const key of ["planned_start_on", "planned_end_on"]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("project_phases").update(patch).eq("id", phaseId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
}

export async function deletePhase(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const phaseId = String(formData.get("phase_id") ?? "");
  if (!projectId || !phaseId) return;

  const supabase = await createClient();
  // Les tâches, ressources et coûts survivent : `on delete set null`
  // les détache. Supprimer un titre de phase par erreur ne doit jamais
  // emporter le chiffrage ni les dépenses déjà saisies.
  const { error } = await supabase.from("project_phases").delete().eq("id", phaseId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
}

export async function addTask(formData: FormData) {
  const organization = await requireOrganization();
  const projectId = String(formData.get("project_id") ?? "");
  const title = text(formData, "title");
  if (!projectId || !title) return;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("project_tasks")
    .select("position")
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("project_tasks").insert({
    organization_id: organization.organizationId,
    project_id: projectId,
    phase_id: text(formData, "phase_id"),
    title,
    position: (last?.position ?? -1) + 1,
    planned_hours: formData.get("planned_hours")
      ? parseQuantity(String(formData.get("planned_hours"))) || null
      : null,
    due_on: text(formData, "due_on"),
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
}

export async function updateTask(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const taskId = String(formData.get("task_id") ?? "");
  if (!projectId || !taskId) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (formData.has("title")) patch.title = text(formData, "title");
  if (formData.has("status")) {
    const status = text(formData, "status");
    patch.status = status;
    patch.done_at = status === "done" ? new Date().toISOString() : null;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("project_tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
}

export async function deleteTask(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const taskId = String(formData.get("task_id") ?? "");
  if (!projectId || !taskId) return;

  const supabase = await createClient();
  const { error } = await supabase.from("project_tasks").delete().eq("id", taskId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
}

// ---------------------------------------------------------------
// Coûts réels — §JOB COSTING
// ---------------------------------------------------------------

export async function addCost(formData: FormData) {
  const organization = await requireOrganization();
  const projectId = String(formData.get("project_id") ?? "");
  const description = text(formData, "description");
  if (!projectId || !description) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase.from("project_costs").insert({
    organization_id: organization.organizationId,
    project_id: projectId,
    phase_id: text(formData, "phase_id"),
    supplier_id: text(formData, "supplier_id"),
    kind: text(formData, "kind") ?? "other",
    description,
    unit: text(formData, "unit") ?? "u",
    quantity: parseQuantity(String(formData.get("quantity") ?? "1")) || 1,
    unit_cost_cents: inputToCents(String(formData.get("unit_cost") ?? "0")),
    incurred_on: text(formData, "incurred_on") ?? new Date().toISOString().slice(0, 10),
    invoice_reference: text(formData, "invoice_reference"),
    recorded_by: user.user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
}

export async function deleteCost(formData: FormData) {
  const projectId = String(formData.get("project_id") ?? "");
  const costId = String(formData.get("cost_id") ?? "");
  if (!projectId || !costId) return;

  const supabase = await createClient();
  const { error } = await supabase.from("project_costs").delete().eq("id", costId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/${projectId}`);
}

// ---------------------------------------------------------------
// Photos
// ---------------------------------------------------------------

const PHOTO_BUCKET = "project-photos";
const ACCEPTED_IMAGES = ["image/png", "image/jpeg", "image/webp", "image/heic"];
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * Une photo de chantier.
 *
 * Le chemin commence par l'id de l'organisation : c'est cette première
 * partie que vérifient les politiques du bucket (migration 0050). Se
 * tromper rangerait le fichier hors de portée du chantier qui le porte.
 */
export async function uploadProjectPhoto(formData: FormData) {
  const organization = await getActiveOrganization();
  if (!organization) return { ok: false, error: "Aucune organisation active." };

  const projectId = String(formData.get("project_id") ?? "");
  const file = formData.get("file");
  if (!projectId || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier." };
  }
  if (!ACCEPTED_IMAGES.includes(file.type)) {
    return { ok: false, error: "Format non pris en charge. Utilisez JPEG, PNG ou WebP." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: "Photo trop volumineuse (15 Mo maximum)." };
  }

  const supabase = await createClient();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${organization.organizationId}/${projectId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { data: user } = await supabase.auth.getUser();
  const { error } = await supabase.from("project_photos").insert({
    organization_id: organization.organizationId,
    project_id: projectId,
    phase_id: text(formData, "phase_id"),
    storage_path: path,
    caption: text(formData, "caption"),
    moment: text(formData, "moment") ?? "during",
    uploaded_by: user.user?.id ?? null,
  });
  if (error) {
    // La ligne a échoué : on retire le fichier, sinon il resterait
    // orphelin dans le bucket sans que rien ne le référence.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return { ok: false, error: error.message };
  }

  revalidatePath(`/projets/${projectId}`);
  return { ok: true };
}

export async function listProjectPhotos(projectId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("project_photos")
    .select("id, storage_path, caption, moment, taken_on, phase_id")
    .eq("project_id", projectId)
    .order("taken_on", { ascending: false });

  return Promise.all(
    (data ?? []).map(async (row) => {
      // URL signée, valable une heure : le bucket est privé, et une URL
      // permanente circulerait hors de tout contrôle d'accès.
      const { data: signed } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(row.storage_path, 3600);
      return {
        id: row.id as string,
        url: signed?.signedUrl ?? null,
        caption: row.caption as string | null,
        moment: row.moment as string,
        takenOn: row.taken_on as string,
        phaseId: row.phase_id as string | null,
      };
    }),
  );
}
