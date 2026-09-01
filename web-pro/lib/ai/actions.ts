"use server";

import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";

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
 */

export type AskResult =
  | { status: "idle" }
  | { status: "answer"; question: string; answer: string; toolsUsed: string[] }
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
