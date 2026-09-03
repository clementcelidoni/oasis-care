"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import {
  PROPOSALS,
  isProposalKind,
  payloadFor,
  type Proposal,
} from "@/lib/ai/proposals";

/**
 * §11U OASIS PRO AI — le pont entre l'écran et l'assistant.
 *
 * L'appel part du SERVEUR, pas du navigateur. §SECURITY est explicite :
 * « aucune OpenAI key dans navigateur ». La clé vit dans les secrets
 * Supabase, l'Edge Function la lit, et le navigateur ne voit qu'une
 * question et une réponse.
 *
 * L'organisation est résolue ici plutôt que prise dans le formulaire.
 * Un champ caché nommant l'organisation serait la chose évidente à
 * écrire et la chose évidente à trafiquer — la fonction Postgres
 * refuserait de toute façon, mais autant ne pas envoyer la tentative.
 *
 * DEUX ACTIONS, ET LA SÉPARATION EST LE SUJET.
 *
 *   `askOasis` pose une question. Elle ne peut RIEN écrire : l'Edge
 *   Function n'appelle aucune fonction d'écriture, elle rend au plus
 *   des PROPOSITIONS.
 *
 *   `confirmProposal` écrit. Elle ne parle à aucun modèle, ne lit
 *   aucune clé OpenAI, et ne part que d'un clic.
 *
 * Une IA qui crée un client pendant qu'on lui pose une question est un
 * défaut, pas une fonctionnalité. La façon la plus solide de l'éviter
 * n'est pas une consigne dans le prompt : c'est que le chemin
 * d'écriture ne passe pas par le modèle.
 */

/**
 * Une action préparée par l'Action Engine, telle que la fonction Edge
 * la rend. Elle N'EST PAS ENCORE EXÉCUTÉE : elle attend le clic, et
 * c'est `confirmerActionsOasis` qui le porte.
 */
export type EngineAction = {
  actionId: string;
  approvalId: string | null;
  actionType: string;
  agent: string;
  risk: string;
  requiresConfirmation: boolean;
  status: string;
  resume: { titre: string; lignes: { label: string; valeur: string }[] } | null;
};

export type AskResult =
  | { status: "idle" }
  | {
      status: "answer";
      question: string;
      answer: string;
      toolsUsed: string[];
      proposals: Proposal[];
      /**
       * LES ACTIONS DE L'ACTION ENGINE, ET LE CHAÎNON QUI MANQUAIT.
       *
       * La fonction Edge enregistrait ces demandes d'approbation depuis
       * la conversation, répondait « confirmez », et AUCUN bouton
       * n'existait : les lignes expiraient au bout de vingt-quatre
       * heures sans que personne ait pu les voir. « Prépare les
       * factures » écrivait en base et ne produisait jamais de facture.
       */
      actions: EngineAction[];
    }
  | { status: "error"; question: string; message: string };

export async function askOasis(_previous: AskResult, formData: FormData): Promise<AskResult> {
  const organization = await requireOrganization();
  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { status: "idle" };

  const supabase = await createClient();

  const { data, error } = await supabase.functions.invoke("oasis-pro-ai", {
    body: { organizationId: organization.organizationId, question },
  });

  if (error) {
    return { status: "error", question, message: await readFunctionError(error) };
  }

  const answer = typeof data?.answer === "string" ? data.answer.trim() : "";
  if (!answer) {
    return {
      status: "error",
      question,
      message: "L'assistant n'a rien répondu. Reformulez la question.",
    };
  }

  return {
    status: "answer",
    question,
    answer,
    toolsUsed: Array.isArray(data?.toolsUsed) ? (data.toolsUsed as string[]) : [],
    proposals: readProposals(data?.proposals),
    actions: readEngineActions(data?.actions),
  };
}

/**
 * Les actions préparées, lues défensivement.
 *
 * On ne garde que celles qui attendent réellement une réponse : une
 * action sans `approvalId` n'a pas de demande d'approbation, un bouton
 * n'aurait rien à consommer. Le RÉSUMÉ AFFICHÉ NE VIENT PAS DU MODÈLE —
 * il est composé en Deno par `resumeFacture`, à partir de la réponse
 * SQL — mais il repasse par le navigateur, donc chaque champ est
 * revérifié ici avant d'être rendu.
 */
function readEngineActions(value: unknown): EngineAction[] {
  if (!Array.isArray(value)) return [];
  const actions: EngineAction[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.actionId !== "string") continue;
    if (typeof row.approvalId !== "string") continue;
    if (row.status !== "awaiting_approval") continue;

    const resumeBrut = row.resume as { titre?: unknown; lignes?: unknown } | undefined;
    const lignes = Array.isArray(resumeBrut?.lignes)
      ? resumeBrut.lignes
          .filter(
            (l): l is { label: string; valeur: string } =>
              typeof l === "object" &&
              l !== null &&
              typeof (l as { label?: unknown }).label === "string" &&
              typeof (l as { valeur?: unknown }).valeur === "string",
          )
          .slice(0, 12)
      : [];

    actions.push({
      actionId: row.actionId,
      approvalId: row.approvalId,
      actionType: typeof row.actionType === "string" ? row.actionType : "",
      agent: typeof row.agent === "string" ? row.agent : "",
      risk: typeof row.risk === "string" ? row.risk : "medium",
      requiresConfirmation: row.requiresConfirmation !== false,
      status: row.status,
      resume:
        typeof resumeBrut?.titre === "string" ? { titre: resumeBrut.titre, lignes } : null,
    });
  }
  return actions;
}

export type ConfirmActionsResult =
  | { status: "idle" }
  | { status: "done"; message: string; executees: number; echecs: number }
  | { status: "error"; message: string };

/**
 * RÉPONDRE AUX ACTIONS PRÉPARÉES DEPUIS LA CONVERSATION.
 *
 * Le second appel HTTP que la fonction Edge documente et implémente
 * depuis le début, et que rien n'émettait. Trois choses le rendent sûr,
 * et aucune n'est ici :
 *
 *   • l'organisation vient de la session, jamais du formulaire ;
 *   • `handleConfirm` relit chaque approbation filtrée sur cette
 *     organisation, appelle `ai_answer_approval` — qui oppose le droit
 *     que le CATALOGUE attache à l'action, et l'expiration —, puis
 *     RELIT le statut de la ligne avant d'exécuter ;
 *   • les paramètres de l'action (le devis à facturer) sont pris sur la
 *     ligne, pas sur la requête.
 *
 * Un identifiant forgé ne donne donc accès qu'à ce que l'utilisateur
 * pouvait déjà valider dans le centre de décision.
 *
 * AUCUN MODÈLE N'EST APPELÉ sur ce chemin, et aucun quota n'est
 * consommé : un clic ne coûte pas un jeton, et l'exécution ne doit pas
 * dépendre d'une API tierce qui peut être en panne.
 */
export async function confirmerActionsOasis(
  _previous: ConfirmActionsResult,
  formData: FormData,
): Promise<ConfirmActionsResult> {
  const organization = await requireOrganization();

  const ok = String(formData.get("ok") ?? "") === "1";
  let approvalIds: string[];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("approvalIds") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("forme inattendue");
    approvalIds = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return { status: "error", message: "Les actions à confirmer sont illisibles. Reposez la question." };
  }
  if (approvalIds.length === 0) {
    return { status: "error", message: "Aucune action à confirmer." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("oasis-pro-ai", {
    body: {
      organizationId: organization.organizationId,
      confirm: { approvalIds, ok },
    },
  });

  if (error) {
    return { status: "error", message: await readFunctionError(error) };
  }

  const results = Array.isArray(data?.results)
    ? (data.results as { status?: unknown; message?: unknown }[])
    : [];
  const executees = results.filter((r) => r.status === "executed").length;
  const echecs = results.filter((r) => r.status !== "executed" && r.status !== "rejected").length;

  for (const path of ["/oasis-ai", "/oasis-ai/decisions", "/oasis-ai/historique", "/factures"]) {
    revalidatePath(path);
  }

  if (!ok) {
    return {
      status: "done",
      message: "Refusé. Rien n'a été écrit.",
      executees: 0,
      echecs: 0,
    };
  }

  // LE PREMIER MESSAGE D'ÉCHEC EST REMONTÉ TEL QUEL. Ceux de Postgres
  // sont écrits en français (0069) : « Demande expirée le 03/09 à
  // 14:12 » se lit, « non-2xx status code » non.
  const premierEchec = results.find(
    (r) => r.status !== "executed" && r.status !== "rejected" && typeof r.message === "string",
  );

  return {
    status: "done",
    executees,
    echecs,
    message:
      echecs === 0
        ? executees === 1
          ? "C'est fait. Le brouillon est créé, et rien n'a été envoyé."
          : `C'est fait. ${executees} brouillons créés, et rien n'a été envoyé.`
        : `${executees} sur ${executees + echecs} ont abouti. ${String(premierEchec?.message ?? "")}`.trim(),
  };
}

/**
 * Les propositions rendues par l'assistant, filtrées.
 *
 * Un `kind` que ce serveur ne connaît pas est jeté ICI plutôt que
 * d'arriver à l'écran sous forme de bouton qui échouera. La liste des
 * `kind` valables est une constante du code, pas une donnée reçue.
 */
function readProposals(value: unknown): Proposal[] {
  if (!Array.isArray(value)) return [];
  const proposals: Proposal[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { kind, args } = entry as { kind?: unknown; args?: unknown };
    if (!isProposalKind(kind)) continue;
    if (typeof args !== "object" || args === null || Array.isArray(args)) continue;
    proposals.push({ kind, args: args as Record<string, unknown> });
  }
  return proposals;
}

export type ConfirmResult =
  | { status: "idle" }
  | { status: "done"; message: string; href: string | null }
  | { status: "error"; message: string };

/**
 * EXÉCUTE une proposition, après le clic.
 *
 * Trois barrières, et elles ne se remplacent pas :
 *
 *   1. Le `kind` est vérifié contre une table figée du code. Le nom de
 *      la fonction Postgres vient de cette table, jamais du formulaire :
 *      un `rpc` transmis par le navigateur serait un appel arbitraire.
 *
 *   2. Les arguments sont filtrés sur une liste blanche (`payloadFor`).
 *      C'est ce qui empêche un `p_organization_id` glissé dans le JSON
 *      d'écraser celui de la session.
 *
 *   3. L'organisation vient de `requireOrganization()`, c'est-à-dire du
 *      cookie d'entreprise active, lui-même validé contre les
 *      appartenances réelles. Et la fonction SQL revérifie tout : la
 *      permission, l'appartenance, et que le parent de la ligne écrite
 *      appartient bien à cette entreprise.
 *
 * Ce qui remonte en cas de refus est le message de Postgres. Ils sont
 * écrits en français dans la migration 0069 précisément pour ça : « Le
 * devis DV-2026-0012 n'est plus un brouillon » se lit ; « new row
 * violates row-level security policy » non.
 */
export async function confirmProposal(
  _previous: ConfirmResult,
  formData: FormData,
): Promise<ConfirmResult> {
  const organization = await requireOrganization();

  const kind = String(formData.get("kind") ?? "");
  if (!isProposalKind(kind)) {
    return { status: "error", message: "Action inconnue." };
  }

  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(formData.get("args") ?? "{}"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("forme inattendue");
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return { status: "error", message: "Les détails de l'action sont illisibles. Reposez la question." };
  }

  const spec = PROPOSALS[kind];

  // §"Ne pas coder les autorisations écran par écran" : la barrière qui
  // tient est celle de la base. Celle-ci ne fait qu'éviter un
  // aller-retour et donner une phrase claire à la place d'un refus SQL.
  if (!organization.permissions.includes(spec.permission)) {
    return {
      status: "error",
      message: "Votre rôle ne permet pas cette action. Demandez-la à un administrateur.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(spec.rpc, {
    ...payloadFor({ kind, args }),
    p_organization_id: organization.organizationId,
  });

  if (error) {
    return { status: "error", message: error.message || "L'action n'a pas pu être enregistrée." };
  }

  for (const path of spec.revalidate) revalidatePath(path);

  const result = (data ?? {}) as Record<string, unknown>;
  return {
    status: "done",
    message:
      typeof result.avertissement === "string"
        ? result.avertissement
        : "C'est enregistré.",
    href: spec.href?.(result) ?? null,
  };
}

/**
 * Le message d'erreur de la fonction, quand il y en a un.
 *
 * `functions.invoke` ne rend pas le corps d'une réponse en échec : il
 * range la `Response` dans `error.context`. Sans ce détour, un plafond
 * atteint — le cas le plus fréquent — s'afficherait « Edge Function
 * returned a non-2xx status code », qui ne dit rien à personne.
 */
async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json();
      if (typeof body?.error === "string") return body.error;
    } catch {
      // Corps illisible : on retombe sur le message générique.
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Failed to send a request") || message.includes("not found")) {
    return (
      "L'assistant n'est pas encore déployé sur ce projet Supabase. " +
      "Déployez la fonction « oasis-pro-ai » et son secret OPENAI_API_KEY."
    );
  }
  return "L'assistant est indisponible pour le moment.";
}
