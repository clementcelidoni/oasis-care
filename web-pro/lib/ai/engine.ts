"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { flash } from "@/lib/ui/flash";
import { isExecutable } from "@/lib/ai/registry";
import {
  isAgentKey,
  readCents,
  readDecisionActions,
  readRisk,
  type RiskLevel,
} from "@/lib/ai/types";

/**
 * §11V — BRIQUES N° 7 ET 8 : L'ACTION ENGINE ET L'APPROVAL ENGINE.
 *
 * ─── CE QUE CE FICHIER GARANTIT ───
 *
 *   1. L'ORGANISATION VIENT DE LA SESSION. `requireOrganization()`, à
 *      chaque fois, et jamais un champ de formulaire. Un `organizationId`
 *      caché serait la chose évidente à écrire et la chose évidente à
 *      trafiquer.
 *
 *   2. LE TYPE D'ACTION VIENT DE LA DÉCISION, PAS DU FORMULAIRE. Le
 *      navigateur envoie un `actionType` ; on ne l'exécute que s'il
 *      figure dans les `available_actions` de la décision visée, qui
 *      ont elles-mêmes été validées contre le catalogue par
 *      `ai_open_decision`. Un type inventé n'a donc aucun chemin.
 *
 *   3. LE RISQUE ET LE DROIT VIENNENT DU CATALOGUE. Ni l'un ni l'autre
 *      n'est un paramètre : sinon un appelant pressé demanderait une
 *      approbation « low » pour une facture de 20 000 €.
 *
 *   4. RIEN NE PART SANS CONFIRMATION. Les deux chemins d'écriture
 *      passent par une demande d'approbation enregistrée
 *      (`ai_request_approval`) puis une réponse enregistrée
 *      (`ai_answer_approval`). Même « Appliquer », qui enchaîne les
 *      deux, laisse les deux lignes dans le journal : on sait qui a
 *      demandé, qui a dit oui, et quand.
 *
 *   5. UN EXÉCUTEUR QUI NE SAIT PAS FAIRE LE DIT. Le catalogue déclare
 *      neuf actions ; cette itération en exécute une. Les autres sont
 *      refusées AVANT d'être créées, avec la phrase qui explique
 *      pourquoi. Un bouton qui ne fait rien est pire qu'un bouton
 *      absent.
 *
 * ─── CE QUE CE FICHIER NE FAIT PAS ───
 *
 * Il n'appelle aucun modèle. Le chemin d'écriture ne passe pas par un
 * LLM, et c'est la façon la plus solide d'éviter qu'une IA écrive
 * pendant qu'on lui pose une question — plus solide qu'une consigne
 * dans un prompt.
 */

const DECISIONS_PATH = "/oasis-ai/decisions";

// ==================================================================
// 1. Répondre à une décision (Plus tard · Ignorer · Vue · Close)
// ==================================================================

const ANSWERABLE = ["reviewed", "accepted", "rejected", "snoozed", "completed"] as const;
type AnswerStatus = (typeof ANSWERABLE)[number];

export async function answerDecision(formData: FormData) {
  await requireOrganization();

  const decisionId = String(formData.get("decisionId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!decisionId || !(ANSWERABLE as readonly string[]).includes(status)) return;

  // « Plus tard » veut dire sept jours. Une date choisie par
  // l'utilisateur serait un formulaire de plus pour une décision qu'on
  // veut justement remettre sans y penser ; sept jours est la durée
  // d'un cycle de chantier, et la décision se rouvrira d'elle-même.
  const snoozeUntil =
    status === "snoozed"
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("ai_answer_decision", {
    p_decision_id: decisionId,
    p_status: status as AnswerStatus,
    p_snooze_until: snoozeUntil,
  });

  if (error) {
    await flash("error", friendly(error.message));
    revalidatePath(DECISIONS_PATH);
    return;
  }

  await flash(
    "success",
    status === "snoozed"
      ? "Reportée. Elle reviendra dans sept jours."
      : status === "rejected"
        ? "Ignorée. Oasis ne la rouvrira pas tant que la situation ne change pas."
        : "C'est noté.",
  );
  revalidatePath(DECISIONS_PATH);
  revalidatePath("/oasis-ai");
}

// ==================================================================
// 2. Préparer une action (niveau 2) et Appliquer (niveau 3)
// ==================================================================

/**
 * « Préparer » : l'action est créée, l'approbation est demandée, et
 * RIEN N'EST EXÉCUTÉ. C'est le niveau 2 de la spec p. 7. Utile quand
 * celui qui repère n'est pas celui qui décide.
 */
export async function prepareDecisionAction(formData: FormData) {
  await runAction(formData, { execute: false });
}

/**
 * « Appliquer » : l'action est créée, demandée, approuvée par
 * l'utilisateur qui vient de cliquer, puis exécutée. C'est le niveau 3
 * — « prépare puis demande confirmation » — et la confirmation, c'est
 * la boîte de dialogue qui a précédé ce clic.
 */
export async function applyDecisionAction(formData: FormData) {
  await runAction(formData, { execute: true });
}

async function runAction(formData: FormData, options: { execute: boolean }) {
  const organization = await requireOrganization();
  const decisionId = String(formData.get("decisionId") ?? "");
  const actionType = String(formData.get("actionType") ?? "");
  if (!decisionId || !actionType) return;

  const supabase = await createClient();

  // ---- La décision, et ce qu'elle autorise --------------------------
  const { data: decisionRow, error: decisionError } = await supabase
    .from("ai_decisions")
    .select("id, agent, title, available_actions, status")
    .eq("organization_id", organization.organizationId)
    .eq("id", decisionId)
    .maybeSingle();

  if (decisionError || !decisionRow) {
    await flash("error", "Cette décision n'existe plus.");
    revalidatePath(DECISIONS_PATH);
    return;
  }

  // LE POINT DE CONTRÔLE : le type d'action doit être un de ceux que la
  // décision propose. Sans cela, le formulaire choisirait l'action, et
  // « ouvrir une décision d'information » deviendrait un chemin vers
  // « émettre une facture ».
  const proposed = readDecisionActions(decisionRow.available_actions);
  const chosen = proposed.find((a) => a.actionType === actionType);
  if (!chosen) {
    await flash("error", "Cette action n'est pas proposée par cette décision.");
    revalidatePath(DECISIONS_PATH);
    return;
  }

  // ---- Le catalogue : risque et droit exigé -------------------------
  const { data: catalogRow } = await supabase
    .from("ai_action_catalog")
    .select("action_type, label, default_risk_level, required_permission, is_write")
    .eq("action_type", actionType)
    .maybeSingle();

  if (!catalogRow) {
    await flash("error", "Cette action ne figure pas au catalogue d'Oasis.");
    revalidatePath(DECISIONS_PATH);
    return;
  }

  const risk: RiskLevel = readRisk(catalogRow.default_risk_level);
  const requiredPermission = String(catalogRow.required_permission);

  // §"Ne pas coder les autorisations écran par écran" : la barrière qui
  // tient est celle de la base (`ai_guard`, RLS). Celle-ci ne fait
  // qu'éviter un aller-retour et donner une phrase lisible.
  if (!(organization.permissions as string[]).includes(requiredPermission)) {
    await flash(
      "error",
      `Votre rôle ne permet pas « ${catalogRow.label} ». Demandez-le à un administrateur.`,
    );
    revalidatePath(DECISIONS_PATH);
    return;
  }

  if (options.execute && !isExecutable(actionType)) {
    await flash(
      "error",
      `Oasis ne sait pas encore exécuter « ${catalogRow.label} » lui-même. Cette action se fait à la main.`,
    );
    revalidatePath(DECISIONS_PATH);
    return;
  }

  // ---- L'action, puis la demande d'approbation ----------------------
  const agent = isAgentKey(decisionRow.agent) ? decisionRow.agent : "executive";
  const user = await getCurrentUser();

  const { data: inserted, error: insertError } = await supabase
    .from("ai_actions")
    .insert({
      organization_id: organization.organizationId,
      action_type: actionType,
      agent,
      decision_id: decisionId,
      // Les décisions de cette itération portent sur un ENSEMBLE
      // (« facturer 10 dossiers »), pas sur une ligne. La cible reste
      // donc nulle — le déclencheur `ai_actions_check_target` accepte
      // l'action qui vise l'entreprise entière, et refuserait une cible
      // d'une autre organisation.
      parameters: chosen.parameters,
      risk_level: risk,
      requires_confirmation: true,
      created_by_ai: true,
      created_by: user?.id ?? null,
      status: "proposed",
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    await flash("error", friendly(insertError?.message ?? ""));
    revalidatePath(DECISIONS_PATH);
    return;
  }

  const actionId = inserted.id as string;

  const { data: approvalId, error: approvalError } = await supabase.rpc("ai_request_approval", {
    p_action_id: actionId,
    p_risk: risk,
    // Vingt-quatre heures. Au-delà, le oui répondrait à une question qui
    // n'existe plus : les chantiers ont bougé, les acomptes sont tombés.
    p_expires_in: "24 hours",
  });

  if (approvalError) {
    await flash("error", friendly(approvalError.message));
    revalidatePath(DECISIONS_PATH);
    return;
  }

  if (!options.execute) {
    await flash(
      "success",
      `« ${catalogRow.label} » est préparée et attend une validation. Rien n'a été exécuté.`,
    );
    revalidatePath(DECISIONS_PATH);
    return;
  }

  await approveAndRun(String(approvalId));
}

// ==================================================================
// 3. Répondre à une demande d'approbation
// ==================================================================

/**
 * LE FORMULAIRE NE PORTE QU'UN IDENTIFIANT : celui de l'approbation.
 *
 * Il en portait trois — `approvalId`, `actionId`, `actionType` — sans
 * jamais vérifier qu'ils se correspondaient. Trois champs cachés, trois
 * valeurs forgeables, et l'invariant central de l'Approval Engine —
 * « le oui porte sur l'acte qui part » — ne tenait plus : on pouvait
 * consommer l'approbation d'une relance de devis et lancer la
 * facturation en lot, puis tamponner « exécutée » sur une troisième
 * action que personne n'avait approuvée. Aucune escalade de privilèges
 * — la RLS d'`invoices` exige toujours `invoice.create` — mais le
 * journal d'audit mentait, et c'est pire : on le croit.
 *
 * Ce qui est vrai vient donc de la LIGNE d'approbation, relue en base
 * et filtrée sur l'organisation de la session. C'est ce que l'Edge
 * Function fait déjà de son côté (`handleConfirm`) ; les deux surfaces
 * disent désormais la même chose.
 */
export async function answerApproval(formData: FormData) {
  await requireOrganization();

  const approvalId = String(formData.get("approvalId") ?? "");
  const ok = String(formData.get("ok") ?? "") === "1";
  if (!approvalId) return;

  if (!ok) {
    const supabase = await createClient();
    const { error } = await supabase.rpc("ai_answer_approval", {
      p_approval_id: approvalId,
      p_ok: false,
    });
    await flash(error ? "error" : "success", error ? friendly(error.message) : "Refusée. Rien n'a été exécuté.");
    revalidatePath(DECISIONS_PATH);
    return;
  }

  await approveAndRun(approvalId);
}

/**
 * Dire oui, puis faire.
 *
 * L'ORDRE COMPTE. `ai_answer_approval` vérifie l'expiration, le droit
 * propre à l'action ET le droit d'écrire la ligne, avant tout. Exécuter
 * d'abord et enregistrer le oui ensuite laisserait, en cas d'échec du
 * second, une opération faite sans trace de l'accord qui l'autorisait.
 *
 * ET L'ACTE EXÉCUTÉ EST CELUI QUE L'APPROBATION DÉSIGNE. L'identifiant
 * de l'action se lit sur `ai_action_approvals.action_id`, jamais
 * ailleurs ; son type se lit sur la ligne d'action ; et le statut est
 * RELU après le oui, parce que c'est `ai_answer_approval` qui a vérifié
 * le droit et c'est donc elle, et pas nous, qui a le dernier mot. Une
 * ligne introuvable interrompt : il n'y a aucun repli sur ce que le
 * navigateur affirmait.
 */
async function approveAndRun(approvalId: string) {
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: approvalRow } = await supabase
    .from("ai_action_approvals")
    .select("id, action_id")
    .eq("organization_id", organization.organizationId)
    .eq("id", approvalId)
    .maybeSingle();

  const actionId = typeof approvalRow?.action_id === "string" ? approvalRow.action_id : null;
  if (!actionId) {
    await flash("error", "Cette demande de validation n'existe plus.");
    revalidatePath(DECISIONS_PATH);
    return;
  }

  const { error: answerError } = await supabase.rpc("ai_answer_approval", {
    p_approval_id: approvalId,
    p_ok: true,
  });

  if (answerError) {
    await flash("error", friendly(answerError.message));
    revalidatePath(DECISIONS_PATH);
    return;
  }

  // RELU APRÈS LE OUI. `ai_answer_approval` vient de faire passer la
  // ligne à `approved` — ou de refuser, auquel cas on n'est pas ici.
  // Tout autre statut veut dire que quelqu'un a écrit dans la table à
  // la main : on n'exécute pas.
  const { data: actionRow } = await supabase
    .from("ai_actions")
    .select("agent, decision_id, action_type, status")
    .eq("organization_id", organization.organizationId)
    .eq("id", actionId)
    .maybeSingle();

  if (!actionRow || actionRow.status !== "approved") {
    await flash(
      "error",
      "Cette action n'est pas dans l'état attendu après validation : rien n'a été exécuté.",
    );
    revalidatePath(DECISIONS_PATH);
    return;
  }

  const agent = isAgentKey(actionRow.agent) ? actionRow.agent : "executive";
  const resolvedType = String(actionRow.action_type);

  const outcome = await execute(organization.organizationId, actionId, resolvedType);

  await supabase
    .from("ai_actions")
    .update(
      outcome.ok
        ? {
            status: "executed",
            executed_at: new Date().toISOString(),
            result: outcome.result,
            updated_at: new Date().toISOString(),
          }
        : {
            status: "failed",
            result: { erreur: outcome.message },
            updated_at: new Date().toISOString(),
          },
    )
    .eq("id", actionId)
    .eq("organization_id", organization.organizationId);

  // Le journal (spec p. 41 : agent, user, organization, action, dataUsed,
  // parameters, confirmation, result, timestamp). `ai_record_agent_event`
  // force `source = 'ai'` et range le reste dans `new_value`.
  await supabase.rpc("ai_record_agent_event", {
    p_organization_id: organization.organizationId,
    p_agent: agent,
    p_action: outcome.ok ? "aiActionExecuted" : "aiActionFailed",
    p_entity_type: "ai_action",
    p_entity_id: actionId,
    p_data_used: null,
    p_parameters: { actionType: resolvedType },
    p_confirmation: "approved",
    p_result: outcome.ok ? outcome.result : { erreur: outcome.message },
  });

  if (outcome.ok) {
    // La décision passe à « exécutée » : elle a produit ce qu'elle
    // annonçait, elle n'a plus à réclamer l'attention du matin.
    if (actionRow?.decision_id) {
      await supabase.rpc("ai_answer_decision", {
        p_decision_id: actionRow.decision_id,
        p_status: "executed",
        p_snooze_until: null,
      });
    }
    await flash("success", outcome.message);
  } else {
    await flash("error", outcome.message);
  }

  revalidatePath(DECISIONS_PATH);
  revalidatePath("/oasis-ai");
  revalidatePath("/oasis-ai/historique");
  revalidatePath("/factures");
}

// ==================================================================
// 4. L'exécuteur
// ==================================================================

type Outcome =
  | { ok: true; message: string; result: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * Faire, pour de vrai.
 *
 * UN SEUL TYPE D'ACTION EST BRANCHÉ, et c'est assumé. Le catalogue en
 * déclare neuf ; huit n'ont pas d'exécuteur dans cette itération, et
 * l'aiguillage se termine sur un refus nommé plutôt que sur un
 * `default: return ok` qui mentirait.
 */
async function execute(
  organizationId: string,
  actionId: string,
  actionType: string,
): Promise<Outcome> {
  switch (actionType) {
    case "createInvoiceDraft":
      return createInvoiceDrafts(organizationId);
    default:
      return {
        ok: false,
        message:
          "Oasis n'a pas d'exécuteur pour cette action dans cette version. " +
          "Elle reste à faire à la main, depuis l'écran correspondant.",
      };
  }
}

/**
 * Créer les brouillons de facture des dossiers PRÊTS.
 *
 * ─── POURQUOI ON RELIT LES CANDIDATS ICI ───
 *
 * La décision disait « 10 dossiers prêts » au moment où elle a été
 * ouverte, peut-être hier. Depuis, deux ont pu être facturés à la main.
 * On repart donc de `ai_billing_candidates`, qui est la source, et on
 * agit sur ce qu'elle dit MAINTENANT. Le compte rendu porte le nombre
 * réellement créé, pas celui qui avait été annoncé.
 *
 * ─── POURQUOI SEULEMENT LES « PRÊTS » ───
 *
 * `ai_billing_candidates` classe en prêt / à vérifier / bloqué, et un
 * dossier « à vérifier » l'est pour une raison nommée : pointages non
 * validés, réception manquante, dépassement de coût. Facturer sur un
 * coût non arrêté, c'est facturer faux. On les compte dans le rapport,
 * on ne les touche pas.
 *
 * ─── CE QUI EST CRÉÉ EST UN BROUILLON ───
 *
 * `create_invoice_from_quote` (0065) ne numérote rien et n'envoie rien :
 * la facture reste au statut brouillon jusqu'à `issue_invoice`, qui
 * n'est pas ouverte à Oasis. Et elle est idempotente — appelée deux
 * fois sur le même devis, elle rend la facture déjà créée au lieu d'en
 * faire une seconde.
 */
async function createInvoiceDrafts(organizationId: string): Promise<Outcome> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("ai_billing_candidates", {
    p_organization_id: organizationId,
  });

  if (error || !data) {
    return {
      ok: false,
      message: friendly(error?.message ?? "Les dossiers à facturer n'ont pas pu être relus."),
    };
  }

  const candidates = Array.isArray((data as Record<string, unknown>).candidats)
    ? ((data as Record<string, unknown>).candidats as Record<string, unknown>[])
    : [];

  const ready = candidates.filter((c) => c.statut === "pret");
  if (ready.length === 0) {
    return {
      ok: false,
      message:
        "Plus aucun dossier n'est prêt à être facturé — ils ont dû l'être entre-temps. Rien n'a été créé.",
    };
  }

  const created: string[] = [];
  const skipped: { libelle: string; motif: string }[] = [];
  let totalCents = 0;
  let sansMontant = 0;

  for (const candidate of ready) {
    const libelle = String(candidate.libelle ?? "Dossier");
    const quoteId = await resolveQuoteId(organizationId, candidate);

    if (!quoteId) {
      skipped.push({
        libelle,
        motif: "Aucun devis rattaché : le contenu de la facture est inconnu.",
      });
      continue;
    }

    const { data: invoiceId, error: createError } = await supabase.rpc(
      "create_invoice_from_quote",
      { p_quote_id: quoteId },
    );

    if (createError || !invoiceId) {
      skipped.push({ libelle, motif: friendly(createError?.message ?? "création refusée") });
      continue;
    }

    created.push(String(invoiceId));
    const cents = readCents(candidate.montantFacturableHtCents);
    if (cents === null) sansMontant += 1;
    else totalCents += cents;
  }

  if (created.length === 0) {
    return {
      ok: false,
      message: `Aucun brouillon n'a pu être créé sur ${ready.length} dossier(s). ${skipped[0]?.motif ?? ""}`.trim(),
    };
  }

  // Le compte rendu de la spec p. 10 : « 10 brouillons créés. 8 prêts à
  // être vérifiés. 2 comportent des écarts de coûts. » On ne dit que ce
  // qu'on a fait, et on nomme ce qu'on n'a pas fait.
  const parts = [
    `${created.length} brouillon(s) de facture créé(s).`,
    sansMontant > 0
      ? `${sansMontant} sans montant connu — à chiffrer à la main.`
      : `Total HT repris des devis : ${(totalCents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}.`,
    skipped.length > 0 ? `${skipped.length} dossier(s) écarté(s).` : "",
    "Aucune n'est émise : relisez-les avant de les envoyer.",
  ].filter(Boolean);

  return {
    ok: true,
    message: parts.join(" "),
    result: {
      brouillonsCrees: created.length,
      facturesIds: created,
      // `null` et non `0` quand rien n'est chiffrable : un total de zéro
      // laisserait croire que les brouillons ne valent rien.
      totalHtCents: created.length > sansMontant ? totalCents : null,
      dossiersSansMontant: sansMontant,
      dossiersEcartes: skipped,
    },
  };
}

/**
 * Le devis d'un candidat à la facturation.
 *
 * `ai_billing_candidates` rend une cible polymorphe : un chantier, un
 * devis, ou une intervention. Seuls les deux premiers mènent à un
 * devis ; l'intervention n'a aucun lien vers une facture dans ce modèle
 * de données, et l'inventer serait précisément ce que la spec interdit.
 */
async function resolveQuoteId(
  organizationId: string,
  candidate: Record<string, unknown>,
): Promise<string | null> {
  const entityType = String(candidate.entiteType ?? "");
  const entityId = typeof candidate.entiteId === "string" ? candidate.entiteId : null;
  if (!entityId) return null;

  if (entityType === "quote") return entityId;

  if (entityType === "project") {
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select("quote_id")
      .eq("organization_id", organizationId)
      .eq("id", entityId)
      .maybeSingle();
    return typeof data?.quote_id === "string" ? data.quote_id : null;
  }

  return null;
}

// ==================================================================
// 5. Les messages
// ==================================================================

/**
 * Le message de Postgres, ou une phrase à sa place.
 *
 * Les migrations 0069 et 0072 écrivent leurs refus en français
 * précisément pour qu'ils remontent tels quels : « Demande expirée le
 * 12/09/2026 14:30 » se lit. Ce qui ne se lit pas, ce sont les erreurs
 * de plomberie, et elles seules sont réécrites.
 */
function friendly(message: string): string {
  if (!message) return "L'action n'a pas pu être enregistrée.";
  if (message.includes("row-level security")) {
    return "Votre rôle ne permet pas cette écriture. Demandez le droit correspondant à un administrateur.";
  }
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "Le moteur d'actions d'Oasis n'est pas encore installé sur cette base.";
  }
  return message;
}
