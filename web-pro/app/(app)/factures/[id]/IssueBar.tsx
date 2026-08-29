"use client";

import Link from "next/link";
import { issueInvoice, cancelInvoice } from "@/lib/finance/actions";
import { isLocked, type Invoice } from "@/lib/finance/types";

/**
 * Émettre, ou constater qu'on ne peut plus revenir en arrière.
 *
 * Le bouton dit ce qu'il fait et ce qu'il coûte : après, plus de
 * retouche. Le lui faire découvrir en essayant serait cruel.
 */
export function IssueBar({ invoice, lineCount }: { invoice: Invoice; lineCount: number }) {
  if (isLocked(invoice)) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
        <span className="text-ink-soft">
          Émise le{" "}
          {new Date(invoice.issued_at!).toLocaleDateString("fr-FR")} sous le numéro{" "}
          <strong className="tabular">{invoice.number}</strong>.
        </span>
        <Link
          href={`/factures/${invoice.id}/imprimer`}
          target="_blank"
          className="ml-auto rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent"
        >
          Imprimer / PDF
        </Link>
        {invoice.status !== "cancelled" && invoice.status !== "paid" && (
          <form action={cancelInvoice}>
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <button
              type="submit"
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-critical hover:bg-critical-wash"
            >
              Annuler la facture
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form
      action={issueInvoice}
      className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-wash px-3 py-2.5"
    >
      <input type="hidden" name="invoice_id" value={invoice.id} />
      <label className="flex items-center gap-1.5 text-xs">
        Échéance à
        <input
          name="due_in_days"
          defaultValue="30"
          className="w-14 rounded-md border border-line-strong bg-surface px-2 py-1 text-right text-xs tabular outline-none focus:border-accent"
        />
        jours
      </label>
      <button
        type="submit"
        disabled={lineCount === 0}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-40"
      >
        Émettre la facture
      </button>
      <p className="text-xs text-ink-soft">
        {lineCount === 0
          ? "Ajoutez au moins une ligne."
          : "Le numéro sera attribué maintenant, et le contenu figé. Ensuite, seule la voie de l’avoir permet de corriger."}
      </p>
    </form>
  );
}
