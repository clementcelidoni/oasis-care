"use client";

import { setQuoteStatus, captureQuoteRevision } from "@/lib/quotes/actions";
import { QUOTE_STATUS_LABELS, type Quote, type QuoteStatus } from "@/lib/quotes/types";

/**
 * Le parcours d'un devis, en boutons.
 *
 * Chaque bouton dit ce qui va se passer, au passé une fois fait :
 * « Marquer comme envoyé » enregistre un FAIT — vous l'avez transmis —
 * et n'envoie rien. « NE PAS envoyer automatiquement des devis » est
 * dans la liste des interdits du document, et un bouton nommé « Envoyer »
 * laisserait croire le contraire.
 *
 * Les transitions proposées dépendent de l'état : proposer « Accepté »
 * sur un brouillon que le client n'a jamais vu n'a pas de sens.
 */
const NEXT: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["internalReview", "sent", "cancelled"],
  internalReview: ["draft", "sent", "cancelled"],
  sent: ["viewed", "accepted", "rejected", "draft"],
  viewed: ["accepted", "rejected", "draft"],
  accepted: ["draft"],
  rejected: ["draft"],
  expired: ["draft"],
  cancelled: ["draft"],
};

const VERB: Partial<Record<QuoteStatus, string>> = {
  draft: "Repasser en brouillon",
  internalReview: "Passer en relecture",
  sent: "Marquer comme envoyé",
  viewed: "Marquer comme consulté",
  accepted: "Marquer comme accepté",
  rejected: "Marquer comme refusé",
  cancelled: "Annuler le devis",
};

export function StatusBar({ quote }: { quote: Quote }) {
  const transitions = NEXT[quote.status] ?? [];

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5">
      {transitions.map((next) => (
        <form key={next} action={setQuoteStatus}>
          <input type="hidden" name="quote_id" value={quote.id} />
          <input type="hidden" name="status" value={next} />
          <button
            type="submit"
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
              next === "accepted"
                ? "bg-positive/10 text-positive"
                : next === "rejected" || next === "cancelled"
                  ? "text-critical hover:bg-critical-wash"
                  : "text-ink-soft hover:bg-canvas"
            }`}
          >
            {VERB[next] ?? QUOTE_STATUS_LABELS[next]}
          </button>
        </form>
      ))}

      <span className="mx-1 h-5 w-px bg-line" />

      <form
        action={captureQuoteRevision}
        className="flex items-center gap-1.5"
      >
        <input type="hidden" name="quote_id" value={quote.id} />
        <input
          name="label"
          placeholder="Nom de la version"
          defaultValue={`Version du ${new Date().toLocaleDateString("fr-FR")}`}
          className="w-52 rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-canvas"
        >
          Enregistrer cette version
        </button>
      </form>

      <span className="ml-auto text-[11px] text-ink-faint">
        Aucun courriel n&apos;est envoyé par Oasis. Vous transmettez le devis vous-même.
      </span>
    </div>
  );
}
