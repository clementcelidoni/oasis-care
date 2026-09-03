"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import { inputToCents } from "@/lib/quotes/types";
import { autonomyLabel, isAgentKey, readAutonomy } from "@/lib/ai/types";

/**
 * §11V — LES RÉGLAGES : autonomie des agents et règles d'autopilote.
 *
 * CES DEUX TABLES NE S'ÉCRIVENT QU'AVEC `organization.manageUsers`
 * (0072, section 14) : régler ce qu'une machine a le droit de faire en
 * votre nom n'est pas conduire un chantier, c'est un réglage
 * d'entreprise. La RLS refuse le reste ; ce fichier ne fait que le dire
 * en français avant de partir.
 *
 * LE NIVEAU 4 EST TRAITÉ À PART, ET IL DOIT L'ÊTRE. C'est le seul
 * réglage de toute l'application qui laisse la machine agir sans que
 * personne regarde. Il exige donc :
 *
 *   • une confirmation explicite à l'écran (une boîte de dialogue, pas
 *     une liste déroulante qu'on effleure) ;
 *   • un jeton `confirmAutopilot` dans le formulaire, vérifié ici :
 *     sans lui, le passage à 4 est refusé, même si le champ le
 *     demande ;
 *   • une trace au journal, avec le niveau d'avant et celui d'après.
 *
 * Le jeton n'est pas une sécurité — un formulaire se forge — c'est un
 * VERROU DE CONCEPTION : il rend impossible d'ajouter par distraction
 * un chemin vers le niveau 4 qui ne passerait pas par la confirmation.
 */

const AGENTS_PATH = "/oasis-ai/agents";
const AUTOMATIONS_PATH = "/oasis-ai/automatisations";

export async function setAgentAutonomy(formData: FormData) {
  const organization = await requireOrganization();

  const agent = String(formData.get("agent") ?? "");
  const level = readAutonomy(Number(formData.get("level")));
  if (!isAgentKey(agent)) return;

  if (level === 4 && String(formData.get("confirmAutopilot") ?? "") !== "oui") {
    await flash(
      "error",
      "L'autopilote n'a pas été activé : il demande une confirmation explicite.",
    );
    revalidatePath(AGENTS_PATH);
    return;
  }

  const supabase = await createClient();
  const user = await getCurrentUser();

  // L'ancien niveau est relu AVANT l'écriture : un journal qui dit
  // « passé au niveau 4 » sans dire d'où il vient ne permet pas de
  // savoir si quelqu'un a sauté trois crans d'un coup.
  const { data: before } = await supabase
    .from("ai_agent_settings")
    .select("autonomy_level, enabled")
    .eq("organization_id", organization.organizationId)
    .eq("agent", agent)
    .maybeSingle();

  const { error } = await supabase.from("ai_agent_settings").upsert(
    {
      organization_id: organization.organizationId,
      agent,
      enabled: before?.enabled ?? true,
      autonomy_level: level,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    },
    { onConflict: "organization_id,agent" },
  );

  if (error) {
    await flash("error", friendly(error.message));
    revalidatePath(AGENTS_PATH);
    return;
  }

  await supabase.rpc("ai_record_agent_event", {
    p_organization_id: organization.organizationId,
    p_agent: agent,
    p_action: "aiAutonomyChanged",
    p_entity_type: "ai_agent_settings",
    p_entity_id: null,
    p_data_used: null,
    p_parameters: { avant: before?.autonomy_level ?? null, apres: level },
    p_confirmation: "human",
    p_result: null,
  });

  await flash(
    "success",
    level === 4
      ? "Autopilote autorisé. Aucune analyse ne tourne en arrière-plan dans cette version : le réglage est enregistré, il ne met rien en marche aujourd'hui."
      : `Autonomie réglée sur « ${autonomyLabel(level)} ».`,
  );
  revalidatePath(AGENTS_PATH);
}

export async function setAgentEnabled(formData: FormData) {
  const organization = await requireOrganization();

  const agent = String(formData.get("agent") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  if (!isAgentKey(agent)) return;

  const supabase = await createClient();
  const user = await getCurrentUser();

  const { data: before } = await supabase
    .from("ai_agent_settings")
    .select("autonomy_level")
    .eq("organization_id", organization.organizationId)
    .eq("agent", agent)
    .maybeSingle();

  const { error } = await supabase.from("ai_agent_settings").upsert(
    {
      organization_id: organization.organizationId,
      agent,
      enabled,
      // Éteindre un agent NE REMET PAS son autonomie à zéro : on le
      // rallume souvent le lendemain, et retrouver son réglage évite de
      // le refaire — ou pire, de le refaire de travers.
      autonomy_level: readAutonomy(before?.autonomy_level ?? 1),
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    },
    { onConflict: "organization_id,agent" },
  );

  if (error) {
    await flash("error", friendly(error.message));
    revalidatePath(AGENTS_PATH);
    return;
  }

  await flash(
    "success",
    enabled ? "Agent réactivé." : "Agent mis en veille. Il n'ouvrira plus de décision.",
  );
  revalidatePath(AGENTS_PATH);
}

// ------------------------------------------------------------------
// Les règles d'autopilote
// ------------------------------------------------------------------

/**
 * Allumer ou éteindre un automatisme, et fixer son plafond.
 *
 * LE DÉCLENCHEUR `ai_autopilot_rules_guard` (0072) A LE DERNIER MOT.
 * Trois actions — envoyer une facture, passer une commande, modifier un
 * tarif — ne peuvent PAS être activées, quoi que dise ce formulaire :
 * le catalogue ne les déclare pas éligibles, et la base lève. L'écran
 * ne propose donc pas l'interrupteur ; s'il le proposait quand même, le
 * refus qui remonte ici est en français et se lit tel quel.
 *
 * LE PLAFOND EST EN CENTIMES ENTIERS, converti par `inputToCents` —
 * la même fonction que les devis et les factures. Un plafond arrondi
 * différemment du reste du produit finirait par laisser passer un
 * centime de trop, ou par bloquer un montant exact.
 */
export async function saveAutopilotRule(formData: FormData) {
  const organization = await requireOrganization();

  const actionType = String(formData.get("actionType") ?? "");
  if (!actionType) return;

  const enabled = String(formData.get("enabled") ?? "") === "1";
  const rawCap = String(formData.get("maximumAmount") ?? "").trim();

  if (enabled && String(formData.get("confirmAutopilot") ?? "") !== "oui") {
    await flash("error", "Cet automatisme n'a pas été activé : il demande une confirmation.");
    revalidatePath(AUTOMATIONS_PATH);
    return;
  }

  const supabase = await createClient();
  const user = await getCurrentUser();

  const { data: before } = await supabase
    .from("ai_autopilot_rules")
    .select("id, enabled, maximum_amount_cents")
    .eq("organization_id", organization.organizationId)
    .eq("action_type", actionType)
    .maybeSingle();

  // Un champ laissé vide GARDE le plafond en place. Le remettre à zéro
  // silencieusement éteindrait de fait un automatisme qu'on croyait
  // seulement renommer ; le remettre à « illimité » serait pire.
  const cap =
    rawCap === ""
      ? (before?.maximum_amount_cents ?? 0)
      : inputToCents(rawCap);

  const { error } = await supabase.from("ai_autopilot_rules").upsert(
    {
      organization_id: organization.organizationId,
      action_type: actionType,
      enabled,
      maximum_amount_cents: cap,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    },
    { onConflict: "organization_id,action_type" },
  );

  if (error) {
    await flash("error", friendly(error.message));
    revalidatePath(AUTOMATIONS_PATH);
    return;
  }

  await supabase.rpc("ai_record_agent_event", {
    p_organization_id: organization.organizationId,
    p_agent: "executive",
    p_action: enabled ? "aiAutopilotEnabled" : "aiAutopilotDisabled",
    p_entity_type: "ai_autopilot_rule",
    p_entity_id: before?.id ?? null,
    p_data_used: null,
    p_parameters: {
      actionType,
      plafondCents: cap,
      avant: { actif: before?.enabled ?? false, plafondCents: before?.maximum_amount_cents ?? null },
    },
    p_confirmation: "human",
    p_result: null,
  });

  await flash(
    "success",
    enabled
      ? "Automatisme autorisé, sous son plafond. Rien ne tourne encore en arrière-plan dans cette version : l'autorisation est enregistrée, elle ne déclenche rien seule."
      : "Automatisme éteint. Oasis continuera de proposer, sans jamais exécuter seul.",
  );
  revalidatePath(AUTOMATIONS_PATH);
}

function friendly(message: string): string {
  if (!message) return "Le réglage n'a pas pu être enregistré.";
  if (message.includes("row-level security")) {
    return "Seul un administrateur règle ce que la machine a le droit de faire. Demandez-le-lui.";
  }
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "Les réglages d'Oasis ne sont pas encore installés sur cette base.";
  }
  return message;
}
