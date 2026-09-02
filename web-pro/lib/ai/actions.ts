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

export type AskResult =
  | { status: "idle" }
  | {
      status: "answer";
      question: string;
      answer: string;
      toolsUsed: string[];
      proposals: Proposal[];
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
