"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { askOasis, type AskResult } from "@/lib/ai/actions";

/**
 * §11U — la conversation.
 *
 * Un seul échange à l'écran, pas un fil. L'assistant ne garde pas
 * l'historique côté serveur : chaque question repart des outils, donc
 * afficher une conversation continue laisserait croire à une mémoire
 * qui n'existe pas. Une question, une réponse, et on voit quels outils
 * ont servi.
 *
 * LES OUTILS UTILISÉS SONT AFFICHÉS. C'est la différence entre un
 * assistant qu'on croit et un assistant qu'on vérifie : « il a lu le
 * stock et les chantiers signés » se contrôle, « fais-moi confiance »
 * non.
 */
const SUGGESTIONS = [
  "Quels chantiers ont dépassé leur budget ?",
  "Quels végétaux dois-je commander pour les chantiers signés ?",
  "Que dois-je faire aujourd'hui ?",
  "Quelles factures sont en retard, et de combien ?",
];

const TOOL_LABELS: Record<string, string> = {
  getClientContext: "fiche client",
  getProjectContext: "chantier",
  getDigitalTwinQuantities: "quantités du plan",
  analyzeProjectMargin: "marges des chantiers",
  summarizeProject: "résumé de chantier",
  findStock: "stock pépinière",
  forecastAvailability: "disponibilités à venir",
  suggestPurchaseNeeds: "besoins d'achat",
  getDailyPriorities: "priorités du jour",
  analyzeNurseryLosses: "pertes pépinière",
  createQuoteDraft: "brouillon de devis",
};

export function Assistant() {
  const [state, action] = useActionState<AskResult, FormData>(askOasis, { status: "idle" });

  return (
    <div>
      <form action={action} className="flex flex-col gap-2">
        <textarea
          name="question"
          required
          rows={3}
          maxLength={2000}
          placeholder="Posez une question sur vos chantiers, vos devis, votre stock…"
          className="w-full resize-y rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-faint">
            Oasis lit vos données avec VOS droits : il ne voit rien de plus que
            vous. Il ne peut ni envoyer, ni facturer, ni encaisser, ni supprimer.
          </p>
          <AskButton />
        </div>
      </form>

      {state.status === "idle" && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <form key={suggestion} action={action}>
              <input type="hidden" name="question" value={suggestion} />
              <button
                type="submit"
                className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
              >
                {suggestion}
              </button>
            </form>
          ))}
        </div>
      )}

      {state.status !== "idle" && (
        <div className="mt-5 rounded-xl border border-line bg-surface">
          <p className="border-b border-line px-4 py-2.5 text-sm font-medium">
            {state.question}
          </p>

          {state.status === "answer" ? (
            <div className="px-4 py-3.5">
              <p className="whitespace-pre-line text-sm leading-relaxed">{state.answer}</p>
              {state.toolsUsed.length > 0 && (
                <p className="mt-3 border-t border-line pt-2.5 text-[11px] text-ink-faint">
                  Données consultées :{" "}
                  {[...new Set(state.toolsUsed)]
                    .map((tool) => TOOL_LABELS[tool] ?? tool)
                    .join(", ")}
                  .
                </p>
              )}
            </div>
          ) : (
            <p className="px-4 py-3.5 text-sm text-critical">{state.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

function AskButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink disabled:opacity-60"
    >
      {pending ? "Oasis cherche…" : "Demander à Oasis"}
    </button>
  );
}
