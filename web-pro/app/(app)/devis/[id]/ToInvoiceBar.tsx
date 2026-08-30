"use client";

import Link from "next/link";
import { invoiceFromQuote } from "@/lib/finance/actions";
import { formatCents } from "@/lib/quotes/types";

/**
 * Facturer un devis accepté.
 *
 * Les montants sont RECOPIÉS sur la facture, jamais relus depuis le
 * devis : celui-ci pourrait être révisé plus tard, la facture non.
 * C'est la même règle que la ligne de devis face au catalogue.
 *
 * La remise globale du devis est répercutée sur chaque prix unitaire —
 * une facture n'a pas de remise globale, et la perdre changerait le
 * montant que le client a accepté.
 */
export function ToInvoiceBar({
  quoteId, existingInvoice, totalCents, globalDiscountPercent,
}: {
  quoteId: string;
  existingInvoice: { id: string; number: string | null; status: string } | null;
  totalCents: number;
  globalDiscountPercent: number;
}) {
  if (existingInvoice) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
        <span className="text-ink-soft">Ce devis a donné la facture</span>
        <Link
          href={`/factures/${existingInvoice.id}`}
          className="tabular font-medium text-accent hover:underline"
        >
          {existingInvoice.number ?? "en brouillon"}
        </Link>
      </div>
    );
  }

  return (
    <form
      action={invoiceFromQuote}
      className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-wash px-3 py-2.5"
    >
      <input type="hidden" name="quote_id" value={quoteId} />
      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      >
        Facturer ce devis
      </button>
      <p className="text-xs text-ink-soft">
        Toutes les lignes sont reprises, pour <strong>{formatCents(totalCents)} HT</strong>.
        {globalDiscountPercent > 0 && (
          <> La remise de {globalDiscountPercent} % est répercutée sur chaque prix unitaire.</>
        )}{" "}
        La facture est créée en brouillon : vous pourrez la corriger avant de l&apos;émettre.
      </p>
    </form>
  );
}
