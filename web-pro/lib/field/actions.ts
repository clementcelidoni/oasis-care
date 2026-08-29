"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { inputToCents, parseQuantity } from "@/lib/quotes/types";
import { keepScheduleOrdered } from "./types";

/**
 * §11G planning, §11H équipes.
 *
 * « NE PAS créer un moteur de paie complet maintenant. » Rien ici ne
 * calcule un salaire, une cotisation ou une majoration d'heures
 * supplémentaires. On enregistre qui a travaillé, quand, sur quoi, et
 * ce que l'heure coûte à l'entreprise — le reste relève d'un
 * comptable, et se tromperait en silence.
 */

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

// ---------------------------------------------------------------
// Salariés, équipes, compétences
// ---------------------------------------------------------------

export async function createEmployee(formData: FormData) {
  const organization = await requireOrganization();
  const firstName = text(formData, "first_name");
  if (!firstName) return;

  const supabase = await createClient();
  const { error } = await supabase.from("employees").insert({
    organization_id: organization.organizationId,
    first_name: firstName,
    last_name: text(formData, "last_name") ?? "",
    job_title: text(formData, "job_title"),
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    hourly_cost_cents: inputToCents(String(formData.get("hourly_cost") ?? "0")),
  });
  if (error) throw new Error(error.message);

  revalidatePath("/equipes");
}

export async function updateEmployee(formData: FormData) {
  const id = String(formData.get("employee_id") ?? "");
  if (!id) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ["first_name", "last_name", "job_title", "email", "phone"]) {
    if (formData.has(key)) patch[key] = text(formData, key) ?? "";
  }
  if (formData.has("hourly_cost")) {
    patch.hourly_cost_cents = inputToCents(String(formData.get("hourly_cost") ?? "0"));
  }

  const supabase = await createClient();
  const { error } = await supabase.from("employees").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/equipes");
}

/**
 * Archive plutôt que supprime.
 *
 * Un salarié parti garde ses pointages : les supprimer effacerait le
 * coût réel de tous les chantiers auxquels il a participé.
 */
export async function archiveEmployee(formData: FormData) {
  const id = String(formData.get("employee_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("employees")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/equipes");
}

export async function createTeam(formData: FormData) {
  const organization = await requireOrganization();
  const name = text(formData, "name");
  if (!name) return;

  const supabase = await createClient();
  const { error } = await supabase.from("teams").insert({
    organization_id: organization.organizationId,
    name,
    color: text(formData, "color") ?? "#15654a",
  });
  if (error) throw new Error(error.message);

  revalidatePath("/equipes");
  revalidatePath("/planning");
}

export async function updateTeam(formData: FormData) {
  const id = String(formData.get("team_id") ?? "");
  if (!id) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (formData.has("name")) patch.name = text(formData, "name");
  if (formData.has("color")) patch.color = text(formData, "color");
  if (formData.has("lead_employee_id")) patch.lead_employee_id = text(formData, "lead_employee_id");

  const supabase = await createClient();
  const { error } = await supabase.from("teams").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/equipes");
  revalidatePath("/planning");
}

export async function setTeamMembership(formData: FormData) {
  const organization = await requireOrganization();
  const teamId = String(formData.get("team_id") ?? "");
  if (!teamId) return;

  const memberIds = formData.getAll("member").map(String);
  const supabase = await createClient();

  // Remplacement complet plutôt qu'un diff : la composition d'une
  // équipe est un petit ensemble qu'on choisit d'un coup dans une liste
  // de cases, et un diff introduirait un état intermédiaire pour rien.
  await supabase.from("team_members").delete().eq("team_id", teamId);
  if (memberIds.length > 0) {
    const { error } = await supabase.from("team_members").insert(
      memberIds.map((employee_id) => ({
        team_id: teamId,
        employee_id,
        organization_id: organization.organizationId,
      })),
    );
    if (error) throw new Error(error.message);
  }

  revalidatePath("/equipes");
  revalidatePath("/planning");
}

export async function addSkill(formData: FormData) {
  const organization = await requireOrganization();
  const name = text(formData, "name");
  if (!name) return;

  const supabase = await createClient();
  // `upsert` sur la contrainte d'unicité : ajouter une compétence qui
  // existe déjà ne doit pas afficher d'erreur, seulement ne rien faire.
  const { error } = await supabase
    .from("skills")
    .upsert(
      { organization_id: organization.organizationId, name },
      { onConflict: "organization_id,name", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);

  revalidatePath("/equipes");
}

export async function setEmployeeSkill(formData: FormData) {
  const organization = await requireOrganization();
  const employeeId = String(formData.get("employee_id") ?? "");
  const skillId = String(formData.get("skill_id") ?? "");
  const level = Number(formData.get("level") ?? 0);
  if (!employeeId || !skillId) return;

  const supabase = await createClient();
  if (level === 0) {
    await supabase
      .from("employee_skills")
      .delete()
      .eq("employee_id", employeeId)
      .eq("skill_id", skillId);
  } else {
    const { error } = await supabase.from("employee_skills").upsert({
      employee_id: employeeId,
      skill_id: skillId,
      organization_id: organization.organizationId,
      level: Math.min(3, Math.max(1, level)),
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/equipes");
}

// ---------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------

export async function createIntervention(formData: FormData) {
  const organization = await requireOrganization();
  const title = text(formData, "title");
  if (!title) return;

  const supabase = await createClient();

  // Même garde à la création : une intervention créée à l'envers
  // échouerait sur la contrainte au lieu de se corriger.
  const draft = {
    scheduled_start: text(formData, "scheduled_start"),
    scheduled_end: text(formData, "scheduled_end"),
  };
  keepScheduleOrdered(draft, { scheduled_start: null, scheduled_end: null });

  const { data, error } = await supabase
    .from("field_interventions")
    .insert({
      organization_id: organization.organizationId,
      title,
      kind: text(formData, "kind") ?? "work",
      project_id: text(formData, "project_id"),
      customer_id: text(formData, "customer_id"),
      team_id: text(formData, "team_id"),
      instructions: text(formData, "instructions"),
      scheduled_start: draft.scheduled_start,
      scheduled_end: draft.scheduled_end,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/planning");
  revalidatePath("/projets/interventions");
  redirect(`/projets/interventions/${data.id}`);
}

export async function updateIntervention(formData: FormData) {
  const id = String(formData.get("intervention_id") ?? "");
  if (!id) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of [
    "title", "instructions", "notes", "kind",
    "scheduled_start", "scheduled_end", "team_id", "project_id",
  ]) {
    if (formData.has(key)) patch[key] = text(formData, key);
  }
  if (formData.has("status")) {
    const status = text(formData, "status");
    patch.status = status;
    const now = new Date().toISOString();
    // Comme pour un chantier : l'horodatage accompagne le geste plutôt
    // que d'être saisi. Personne ne tape « maintenant ».
    if (status === "inProgress") patch.actual_start = now;
    if (status === "done") patch.actual_end = now;
  }

  const supabase = await createClient();

  // Les bornes se jugent ensemble : un formulaire qui n'envoie que la
  // fin doit être comparé au début DÉJÀ enregistré, pas à rien.
  if ("scheduled_start" in patch || "scheduled_end" in patch) {
    const { data: previous } = await supabase
      .from("field_interventions")
      .select("scheduled_start, scheduled_end")
      .eq("id", id)
      .maybeSingle();
    if (previous) keepScheduleOrdered(patch, previous);
  }

  const { error } = await supabase.from("field_interventions").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/interventions/${id}`);
  revalidatePath("/planning");
  revalidatePath("/projets/interventions");
}

/**
 * Le glisser-déposer du planning.
 *
 * Déplace l'intervention d'un jour à l'autre en CONSERVANT son heure et
 * sa durée : faire glisser une carte du mardi au jeudi ne doit pas la
 * faire commencer à minuit.
 */
export async function moveIntervention(formData: FormData) {
  const id = String(formData.get("intervention_id") ?? "");
  const day = String(formData.get("day") ?? "");
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("field_interventions")
    .select("scheduled_start, scheduled_end")
    .eq("id", id)
    .maybeSingle();
  if (!current) return;

  const start = current.scheduled_start ? new Date(current.scheduled_start) : null;
  const end = current.scheduled_end ? new Date(current.scheduled_end) : null;
  // Durée conservée telle quelle, y compris une intervention à cheval
  // sur deux jours.
  const durationMs = start && end ? end.getTime() - start.getTime() : 0;

  const [y, m, d] = day.split("-").map(Number);
  const newStart = start ? new Date(start) : new Date();
  newStart.setFullYear(y, m - 1, d);
  if (!start) newStart.setHours(8, 0, 0, 0);

  const patch: Record<string, unknown> = {
    scheduled_start: newStart.toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (durationMs > 0) {
    patch.scheduled_end = new Date(newStart.getTime() + durationMs).toISOString();
  }

  const { error } = await supabase.from("field_interventions").update(patch).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/planning");
}

export async function addInterventionTask(formData: FormData) {
  const organization = await requireOrganization();
  const interventionId = String(formData.get("intervention_id") ?? "");
  const title = text(formData, "title");
  if (!interventionId || !title) return;

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("intervention_tasks")
    .select("position")
    .eq("intervention_id", interventionId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("intervention_tasks").insert({
    organization_id: organization.organizationId,
    intervention_id: interventionId,
    title,
    position: (last?.position ?? -1) + 1,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/interventions/${interventionId}`);
}

export async function toggleInterventionTask(formData: FormData) {
  const interventionId = String(formData.get("intervention_id") ?? "");
  const taskId = String(formData.get("task_id") ?? "");
  const done = String(formData.get("done") ?? "") === "true";
  if (!interventionId || !taskId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("intervention_tasks")
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq("id", taskId);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/interventions/${interventionId}`);
}

export async function addInterventionMaterial(formData: FormData) {
  const organization = await requireOrganization();
  const interventionId = String(formData.get("intervention_id") ?? "");
  const description = text(formData, "description");
  if (!interventionId || !description) return;

  const supabase = await createClient();
  const { error } = await supabase.from("intervention_materials").insert({
    organization_id: organization.organizationId,
    intervention_id: interventionId,
    description,
    quantity: parseQuantity(String(formData.get("quantity") ?? "1")) || 1,
    unit: text(formData, "unit") ?? "u",
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/interventions/${interventionId}`);
}

export async function deleteInterventionMaterial(formData: FormData) {
  const interventionId = String(formData.get("intervention_id") ?? "");
  const materialId = String(formData.get("material_id") ?? "");
  if (!interventionId || !materialId) return;

  const supabase = await createClient();
  await supabase.from("intervention_materials").delete().eq("id", materialId);
  revalidatePath(`/projets/interventions/${interventionId}`);
}

/**
 * L'accusé de passage.
 *
 * Un nom et un horodatage, rien de plus. Une signature manuscrite
 * capturée dans un navigateur n'aurait aucune valeur probante
 * particulière, et laisser croire le contraire serait pire que de ne
 * pas la proposer. Le libellé de l'écran le dit aussi.
 */
export async function signIntervention(formData: FormData) {
  const id = String(formData.get("intervention_id") ?? "");
  const name = text(formData, "signed_by_name");
  if (!id || !name) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("field_interventions")
    .update({ signed_by_name: name, signed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/interventions/${id}`);
}

// ---------------------------------------------------------------
// Pointages
// ---------------------------------------------------------------

/** Pointe toute l'équipe d'un coup — le geste du soir. Voir `log_team_time`. */
export async function logTeamTime(formData: FormData) {
  const interventionId = String(formData.get("intervention_id") ?? "");
  const hours = parseQuantity(String(formData.get("hours") ?? "0"));
  if (!interventionId || hours <= 0) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_team_time", {
    p_intervention_id: interventionId,
    p_hours: hours,
    p_worked_on: String(formData.get("worked_on") ?? "") || new Date().toISOString().slice(0, 10),
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/interventions/${interventionId}`);
}

export async function logTime(formData: FormData) {
  const organization = await requireOrganization();
  const employeeId = String(formData.get("employee_id") ?? "");
  const hours = parseQuantity(String(formData.get("hours") ?? "0"));
  if (!employeeId || hours <= 0) return;

  const supabase = await createClient();
  // Le coût horaire est LU maintenant et recopié : c'est ce qui fige la
  // dépense à la date du travail.
  const { data: employee } = await supabase
    .from("employees")
    .select("hourly_cost_cents")
    .eq("id", employeeId)
    .maybeSingle();

  const interventionId = text(formData, "intervention_id");
  let projectId = text(formData, "project_id");
  if (!projectId && interventionId) {
    const { data: iv } = await supabase
      .from("field_interventions")
      .select("project_id")
      .eq("id", interventionId)
      .maybeSingle();
    projectId = iv?.project_id ?? null;
  }

  const { error } = await supabase.from("time_entries").insert({
    organization_id: organization.organizationId,
    employee_id: employeeId,
    intervention_id: interventionId,
    project_id: projectId,
    worked_on: text(formData, "worked_on") ?? new Date().toISOString().slice(0, 10),
    hours,
    hourly_cost_cents: employee?.hourly_cost_cents ?? 0,
    kind: text(formData, "kind") ?? "work",
    notes: text(formData, "notes"),
  });
  if (error) throw new Error(error.message);

  if (interventionId) revalidatePath(`/projets/interventions/${interventionId}`);
  if (projectId) revalidatePath(`/projets/${projectId}`);
}

/**
 * Valider un pointage le fait entrer dans le coût du chantier.
 *
 * C'est le seul moment où une heure devient de l'argent. Un chef
 * d'équipe qui se trompe de ligne le soir ne doit pas faire bouger un
 * budget avant que quelqu'un ait relu.
 */
export async function setTimeEntryValidation(formData: FormData) {
  const entryId = String(formData.get("entry_id") ?? "");
  const validated = String(formData.get("validated") ?? "") === "true";
  if (!entryId) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("time_entries")
    .update({
      validated,
      validated_by: validated ? user.user?.id ?? null : null,
      validated_at: validated ? new Date().toISOString() : null,
    })
    .eq("id", entryId)
    .select("project_id, intervention_id")
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data?.intervention_id) revalidatePath(`/projets/interventions/${data.intervention_id}`);
  if (data?.project_id) revalidatePath(`/projets/${data.project_id}`);
}

export async function deleteTimeEntry(formData: FormData) {
  const entryId = String(formData.get("entry_id") ?? "");
  if (!entryId) return;

  const supabase = await createClient();
  const { data } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", entryId)
    .select("project_id, intervention_id")
    .maybeSingle();

  if (data?.intervention_id) revalidatePath(`/projets/interventions/${data.intervention_id}`);
  if (data?.project_id) revalidatePath(`/projets/${data.project_id}`);
}

/**
 * Valide d'un coup tout ce qui est en attente sur une intervention.
 *
 * Le geste manquait. Valider ligne par ligne, dans une pastille en bout
 * de rangée, faisait qu'on pointait ses heures et qu'elles
 * n'apparaissaient nulle part — signalé à l'usage, et parfaitement
 * logique : rien ne montrait qu'il restait quelque chose à faire.
 *
 * La validation elle-même reste nécessaire : une heure ne devient de
 * l'argent qu'une fois relue. Mais relire doit coûter un clic, pas dix.
 */
export async function validateAllTime(formData: FormData) {
  const interventionId = String(formData.get("intervention_id") ?? "");
  if (!interventionId) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("time_entries")
    .update({
      validated: true,
      validated_by: user.user?.id ?? null,
      validated_at: new Date().toISOString(),
    })
    .eq("intervention_id", interventionId)
    .eq("validated", false)
    .select("project_id");
  if (error) throw new Error(error.message);

  revalidatePath(`/projets/interventions/${interventionId}`);
  for (const id of new Set((data ?? []).map((r) => r.project_id).filter(Boolean))) {
    revalidatePath(`/projets/${id}`);
  }
}
