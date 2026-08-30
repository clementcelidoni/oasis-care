"use client";

import Link from "next/link";
import { invoiceFromProject } from "@/lib/finance/actions";
import { formatCents } from "@/lib/quotes/types";

/**
 * Facturer un chantier.
 *
 * ON FACTURE LE DEVIS, PAS LE COÛT. Les ressources d'un chantier sont
 * enregistrées au prix d'achat — c'est toute la règle du Milestone 6 —
 * et facturer à ce prix-là reviendrait à travailler gratuitement. Le
 * bouton reprend donc les lignes du devis qui a fait naître le
 * chantier.
 *
 * Sans devis, aucun montant ne peut être inventé : la facture est créée
 * vide, et l'écran le dit avant plutôt qu'après.
 */
export function ToInvoiceBar({
  projectId, quote, existingInvoice, status, plannedCents, actualCents,
}: {
  projectId: string;
  quote: { id: string; number: string } | null;
  existingInvoice: { id: string; number: string | null } | null;
  status: string;
  plannedCents: number;
  actualCents: number;
}) {
  if (existingInvoice) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
        <span className="text-ink-soft">Ce chantier a donné la facture</span>
        <Link
          href={`/factures/${existingInvoice.id}`}
          className="tabular font-medium text-accent hover:underline"
        >
          {existingInvoice.number ?? "en brouillon"}
        </Link>
      </div>
    );
  }

  const finished = status === "completed" || status === "handedOver";
  const overrun = actualCents - plannedCents;

  return (
    <form
      action={invoiceFromProject}
      className={`mb-6 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 ${
        finished ? "border-accent/30 bg-accent-wash" : "border-line bg-surface"
      }`}
    >
      <input type="hidden" name="project_id" value={projectId} />
      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      >
        Facturer ce chantier
      </button>

      <p className="text-xs text-ink-soft">
        {quote ? (
          <>
            Les lignes du devis <strong className="tabular">{quote.number}</strong> sont
            reprises. On facture ce qui a été <strong>vendu</strong>, pas ce que le chantier
            a coûté — les montants suivis ici sont des prix d&apos;achat.
          </>
        ) : (
          <>
            Ce chantier n&apos;a pas de devis : aucun montant ne peut en être déduit. La
            facture sera créée <strong>vide</strong>, rattachée au client et au chantier, à
            vous d&apos;y saisir les lignes.
          </>
        )}
        {!finished && " Le chantier n’est pas terminé — rien ne l’interdit, mais vérifiez que c’est voulu."}
      </p>

      {overrun > 0 && quote && (
        <p className="w-full text-[11px] text-warning">
          Ce chantier a dépassé son budget de {formatCents(overrun)}. Le devis, lui, n&apos;a
          pas bougé : si des travaux en plus ont été réalisés, ajoutez-les à la facture avant
          de l&apos;émettre.
        </p>
      )}
    </form>
  );
}
