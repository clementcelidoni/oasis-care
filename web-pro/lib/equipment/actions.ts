"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import { parseNumber } from "@/lib/quotes/types";
import {
  EQUIPMENT_CATEGORIES, EQUIPMENT_STATUSES, OWNERSHIPS, METER_KINDS,
  DEADLINE_KINDS, MAINTENANCE_KINDS,
  type EquipmentCategory, type EquipmentStatus, type Ownership, type MeterKind,
  type DeadlineKind, type MaintenanceKind,
} from "./types";

/**
 * §5 GESTION → MATÉRIEL — les écritures.
 *
 * Toutes demandent `projects.manage` : c'est ce qu'exigent les
 * politiques RLS de la migration 0067, calquées sur `employees` et
 * `teams`. Ce fichier ne fait que masquer ce qui n'est pas permis ;
 * c'est la base qui refuse, et elle refuse même si un formulaire est
 * rejoué à la main.
 *
 * AUCUNE ACTION N'ÉCRIT `organization_id` DEPUIS LE FORMULAIRE. Il
 * vient de `requireOrganization()`, c'est-à-dire du cookie validé
 * contre les appartenances réelles. Un champ caché serait modifiable
 * par le premier inspecteur d'éléments venu.
 */

// ---------------------------------------------------------------
// Lecture d'un formulaire
// ---------------------------------------------------------------

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

/**
 * Un montant en euros vers des centimes, ou `null` si le champ est vide.
 *
 * `inputToCents` rend 0 pour une saisie illisible, ce qui conviendrait
 * à une ligne de devis mais pas ici : un coût d'acquisition inconnu
 * n'est pas un coût nul, et l'écran doit pouvoir écrire un tiret.
 */
function centsOrNull(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const euros = parseNumber(raw);
  if (euros === null || euros < 0) return null;
  return Math.round(euros * 100);
}

/** Un coût d'entretien : zéro est une valeur, pas une absence. */
function costCents(formData: FormData, key: string): number {
  const euros = parseNumber(String(formData.get(key) ?? ""));
  if (euros === null || euros < 0) return 0;
  return Math.round(euros * 100);
}

/**
 * Un entier positif ou nul, ou son repli.
 *
 * ÉCRIT AINSI DÉLIBÉRÉMENT. `parseNumber(x) ?? fallback` et non
 * `parseNumber(x) || fallback` : la seconde forme est le défaut qui a
 * fait partir une TVA à 0 % à 20 %, et un préavis à zéro — « préviens-moi
 * le jour même » — est tout aussi légitime qu'un taux à zéro.
 */
function wholeOr(formData: FormData, key: string, fallback: number): number {
  const value = parseNumber(String(formData.get(key) ?? ""));
  if (value === null || value < 0) return fallback;
  return Math.round(value);
}

/** Un entier strictement positif, ou `null` — pour une périodicité. */
function positiveOrNull(formData: FormData, key: string): number | null {
  const value = parseNumber(String(formData.get(key) ?? ""));
  if (value === null || value <= 0) return null;
  return Math.round(value);
}

/** Un relevé de compteur. Vide reste vide : surtout pas zéro. */
function meterOrNull(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const value = parseNumber(raw);
  if (value === null || value < 0) return null;
  return value;
}

/**
 * Une valeur d'énumération, ou son repli.
 *
 * La base refuserait de toute façon une valeur inventée — les
 * contraintes `check` de la migration 0067 sont la vraie barrière —
 * mais autant ne pas envoyer la tentative, et surtout ne pas afficher
 * à l'utilisateur une erreur PostgreSQL pour un choix qu'il n'a pas
 * fait lui-même.
 */
function choice<T extends string>(
  formData: FormData,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = String(formData.get(key) ?? "");
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * `AAAA-MM-JJ` du jour vécu à Paris.
 *
 * Le serveur tourne en UTC. Entre minuit et deux heures du matin
 * l'heure d'été, la journée parisienne a commencé mais pas celle du
 * serveur : une affectation close « aujourd'hui » porterait la veille,
 * et l'engin apparaîtrait libre un jour trop tôt. C'est l'erreur que la
 * migration 0066 a corrigée côté base, et les vues de 0067 comptent
 * déjà en heure de Paris — cette fonction dit la même chose côté web.
 *
 * Redéfinie ici plutôt qu'importée du tableau de bord : une
 * bibliothèque ne doit pas dépendre d'un module de route, sous peine
 * d'entraîner tout un écran dans son sillage.
 */
function parisToday(): string {
  return new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

/** Le champ que toutes les tables filles partagent. */
function equipmentId(formData: FormData): string {
  return String(formData.get("equipment_id") ?? "");
}

// ---------------------------------------------------------------
// Le matériel
// ---------------------------------------------------------------

/** Les colonnes d'identité et de propriété, lues une fois pour deux actions. */
function equipmentPatch(formData: FormData) {
  return {
    name: text(formData, "name"),
    category: choice<EquipmentCategory>(formData, "category", EQUIPMENT_CATEGORIES, "other"),
    brand: text(formData, "brand"),
    model: text(formData, "model"),
    serial_number: text(formData, "serial_number"),
    internal_number: text(formData, "internal_number"),
    registration: text(formData, "registration"),
    ownership: choice<Ownership>(formData, "ownership", OWNERSHIPS, "owned"),
    acquired_on: text(formData, "acquired_on"),
    acquisition_cost_cents: centsOrNull(formData, "acquisition_cost"),
    supplier_id: text(formData, "supplier_id"),
    meter_kind: choice<MeterKind>(formData, "meter_kind", METER_KINDS, "none"),
    status: choice<EquipmentStatus>(formData, "status", EQUIPMENT_STATUSES, "active"),
    notes: text(formData, "notes"),
  };
}

/**
 * Le message d'un doublon de plaque ou de numéro interne.
 *
 * PostgreSQL rend « duplicate key value violates unique constraint
 * "equipment_registration_idx" », ce qui ne veut rien dire pour un chef
 * d'entreprise. Le nom de l'index, lui, dit exactement quel champ est
 * en cause.
 */
function duplicateMessage(message: string): string | null {
  if (message.includes("equipment_registration_idx")) {
    return "Cette immatriculation est déjà celle d'un autre matériel.";
  }
  if (message.includes("equipment_internal_number_idx")) {
    return "Ce numéro interne est déjà pris. Deux engins qui portent le même numéro ne se distinguent plus au téléphone.";
  }
  return null;
}

export async function createEquipment(formData: FormData) {
  const organization = await requireOrganization();
  const patch = equipmentPatch(formData);
  // Sans nom, la fiche serait introuvable dans sa propre liste.
  if (!patch.name) return;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("equipment")
    .insert({ ...patch, organization_id: organization.organizationId })
    .select("id")
    .single();

  if (error) {
    const friendly = duplicateMessage(error.message);
    if (friendly) {
      await flash("error", friendly);
      return;
    }
    throw new Error(error.message);
  }

  await flash("success", `${patch.name} est entré au parc.`);
  // Vers la fiche : c'est là que se posent les échéances, et une
  // machine sans échéance ne sert à rien dans ce module.
  redirect(`/materiel/${data.id}`);
}

export async function updateEquipment(formData: FormData) {
  const organization = await requireOrganization();
  const id = String(formData.get("id") ?? "");
  const patch = equipmentPatch(formData);
  if (!id || !patch.name) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.organizationId);

  if (error) {
    const friendly = duplicateMessage(error.message);
    if (friendly) {
      await flash("error", friendly);
      revalidatePath(`/materiel/${id}`);
      return;
    }
    throw new Error(error.message);
  }

  await flash("success", "Fiche du matériel enregistrée.");
  revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}

/**
 * Sortir un matériel du parc.
 *
 * Archivé, jamais supprimé : le journal d'entretien du camion vendu
 * explique ce qu'on a dépensé dessus, et cette dépense a bien eu lieu.
 * Une suppression dure effacerait aussi trois ans d'historique de
 * contrôles techniques — exactement ce qu'un contrôle réclame.
 *
 * Effet immédiat et voulu : les échéances d'un engin archivé sortent
 * des alertes (la vue `equipment_due_dates` les écarte). Relancer sur
 * le contrôle technique d'un camion vendu ferait perdre confiance dans
 * toutes les autres alertes.
 */
export async function archiveEquipment(formData: FormData) {
  const organization = await requireOrganization();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("equipment")
    .update({ archived_at: now, updated_at: now })
    .eq("id", id)
    .eq("organization_id", organization.organizationId);
  if (error) throw new Error(error.message);

  // L'affectation ouverte se ferme avec lui : un engin sorti du parc
  // ne peut pas rester « sur le chantier des Oliviers » indéfiniment.
  await supabase
    .from("equipment_assignments")
    .update({ ended_on: parisToday() })
    .eq("equipment_id", id)
    .eq("organization_id", organization.organizationId)
    .is("ended_on", null);

  await flash("success", "Matériel archivé. Ses échéances ne sont plus surveillées.");
  revalidatePath("/materiel");
  redirect("/materiel");
}

export async function restoreEquipment(formData: FormData) {
  const organization = await requireOrganization();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment")
    .update({ archived_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", organization.organizationId);
  if (error) throw new Error(error.message);

  await flash("success", "Matériel remis au parc.");
  revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}

// ---------------------------------------------------------------
// Les échéances
// ---------------------------------------------------------------

export async function addDeadline(formData: FormData) {
  const organization = await requireOrganization();
  const id = equipmentId(formData);
  const dueOn = text(formData, "due_on");
  // Une échéance sans date n'est pas une échéance.
  if (!id || !dueOn) return;

  const kind = choice<DeadlineKind>(formData, "kind", DEADLINE_KINDS, "other");

  const supabase = await createClient();
  const { error } = await supabase.from("equipment_deadlines").insert({
    organization_id: organization.organizationId,
    equipment_id: id,
    kind,
    label: text(formData, "label"),
    due_on: dueOn,
    // Le repli ne s'applique qu'à une saisie ILLISIBLE, jamais à un
    // zéro : « préviens-moi le jour même » est une consigne valable.
    reminder_days: wholeOr(formData, "reminder_days", 30),
    recurrence_months: positiveOrNull(formData, "recurrence_months"),
  });
  if (error) throw new Error(error.message);

  await flash("success", "Échéance ajoutée. Elle remontera d'elle-même le moment venu.");
  revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}

/**
 * Marquer une échéance faite.
 *
 * Passe par la fonction `complete_equipment_deadline` (migration 0067)
 * plutôt que par deux écritures : la ligne close et celle qui la
 * remplace doivent apparaître ensemble ou pas du tout. Un incident
 * réseau entre les deux laisserait un parc sans aucun contrôle
 * technique à venir — c'est-à-dire un parc qui a l'air en règle.
 */
export async function completeDeadline(formData: FormData) {
  await requireOrganization();
  const id = equipmentId(formData);
  const deadlineId = String(formData.get("deadline_id") ?? "");
  if (!deadlineId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_equipment_deadline", {
    p_deadline_id: deadlineId,
    p_completed_on: text(formData, "completed_on"),
    p_cost_cents: centsOrNull(formData, "completed_cost"),
    p_note: text(formData, "completed_note"),
  });
  if (error) throw new Error(error.message);

  await flash("success", "Échéance honorée. La suivante est posée si elle se renouvelle.");
  if (id) revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}

/**
 * Retirer une échéance saisie par erreur.
 *
 * Une vraie suppression, celle-ci : une échéance qu'on n'aurait jamais
 * dû créer n'a aucune histoire à raconter, et la laisser « annulée »
 * dans la liste ferait douter de toutes les autres. Une échéance
 * réellement honorée se CLÔT, elle ne se supprime pas.
 */
export async function deleteDeadline(formData: FormData) {
  const organization = await requireOrganization();
  const id = equipmentId(formData);
  const deadlineId = String(formData.get("deadline_id") ?? "");
  if (!deadlineId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_deadlines")
    .delete()
    .eq("id", deadlineId)
    .eq("organization_id", organization.organizationId);
  if (error) throw new Error(error.message);

  await flash("success", "Échéance supprimée.");
  if (id) revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}

// ---------------------------------------------------------------
// L'affectation
// ---------------------------------------------------------------

/**
 * Envoyer un matériel quelque part.
 *
 * DEUX ÉCRITURES, dans cet ordre : on ferme l'affectation en cours,
 * puis on ouvre la nouvelle. L'index unique de la migration 0067
 * interdit deux affectations ouvertes sur le même engin — l'ordre
 * inverse échouerait donc systématiquement.
 *
 * Si la seconde écriture échoue, l'engin se lit « au dépôt ». C'est
 * inexact d'une demi-journée, mais réparable en un clic et honnête :
 * l'état contraire — deux chantiers qui comptent la même mini-pelle —
 * ne se voit pas et se paie un lundi matin.
 */
export async function assignEquipment(formData: FormData) {
  const organization = await requireOrganization();
  const id = equipmentId(formData);
  if (!id) return;

  const projectId = text(formData, "project_id");
  const teamId = text(formData, "team_id");
  const employeeId = text(formData, "employee_id");
  // La contrainte `equipment_assignments_target` dit la même chose côté
  // base ; ici on évite surtout d'afficher son message.
  if (!projectId && !teamId && !employeeId) {
    await flash("error", "Choisissez un chantier, une équipe ou un salarié.");
    return;
  }

  const supabase = await createClient();
  const today = parisToday();

  const { error: closeError } = await supabase
    .from("equipment_assignments")
    .update({ ended_on: today })
    .eq("equipment_id", id)
    .eq("organization_id", organization.organizationId)
    .is("ended_on", null);
  if (closeError) throw new Error(closeError.message);

  const { error } = await supabase.from("equipment_assignments").insert({
    organization_id: organization.organizationId,
    equipment_id: id,
    project_id: projectId,
    team_id: teamId,
    employee_id: employeeId,
    started_on: today,
    notes: text(formData, "notes"),
  });
  if (error) throw new Error(error.message);

  await flash("success", "Matériel affecté.");
  revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}

/** Le retour au dépôt : on ferme, on n'ouvre rien. */
export async function returnEquipment(formData: FormData) {
  const organization = await requireOrganization();
  const id = equipmentId(formData);
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_assignments")
    .update({ ended_on: parisToday() })
    .eq("equipment_id", id)
    .eq("organization_id", organization.organizationId)
    .is("ended_on", null);
  if (error) throw new Error(error.message);

  await flash("success", "Matériel rentré au dépôt.");
  revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}

// ---------------------------------------------------------------
// L'entretien
// ---------------------------------------------------------------

export async function addMaintenance(formData: FormData) {
  const organization = await requireOrganization();
  const id = equipmentId(formData);
  if (!id) return;

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();

  const { error } = await supabase.from("equipment_maintenance").insert({
    organization_id: organization.organizationId,
    equipment_id: id,
    performed_on: text(formData, "performed_on") ?? parisToday(),
    kind: choice<MaintenanceKind>(formData, "kind", MAINTENANCE_KINDS, "service"),
    description: text(formData, "description"),
    // Zéro est légitime : une révision sous garantie coûte réellement
    // zéro euro, et l'écrire « 0 € » n'est pas la même chose que de
    // laisser le coût inconnu.
    cost_cents: costCents(formData, "cost"),
    meter_reading: meterOrNull(formData, "meter_reading"),
    supplier_id: text(formData, "supplier_id"),
    // L'échéance que cette intervention honore, quand elle en honore
    // une. Le déclencheur de la migration 0067 refuse une échéance qui
    // ne concerne pas CE matériel.
    deadline_id: text(formData, "deadline_id"),
    created_by: user.user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  await flash("success", "Intervention enregistrée.");
  revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}

/**
 * Retirer une ligne d'entretien.
 *
 * Le compteur affiché sur la fiche remonte tout seul à sa valeur
 * précédente : il n'est stocké nulle part, il se recalcule depuis ce
 * journal. Une valeur recopiée sur la fiche du matériel resterait, elle,
 * figée sur une relève effacée — c'est le défaut du `max(updated_at)`
 * qui ne voit pas une suppression, pris à l'envers.
 */
export async function deleteMaintenance(formData: FormData) {
  const organization = await requireOrganization();
  const id = equipmentId(formData);
  const maintenanceId = String(formData.get("maintenance_id") ?? "");
  if (!maintenanceId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("equipment_maintenance")
    .delete()
    .eq("id", maintenanceId)
    .eq("organization_id", organization.organizationId);
  if (error) throw new Error(error.message);

  await flash("success", "Intervention supprimée.");
  if (id) revalidatePath(`/materiel/${id}`);
  revalidatePath("/materiel");
}
