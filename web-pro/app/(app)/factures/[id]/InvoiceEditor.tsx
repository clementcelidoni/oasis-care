"use client";

import { addInvoiceLine, deleteInvoiceLine, updateInvoice } from "@/lib/finance/actions";
import {
  formatCents, formatQuantity, COMMON_UNITS, VAT_RATES,
} from "@/lib/quotes/types";
import { type Invoice, type InvoiceLine } from "@/lib/finance/types";

/**
 * Les lignes de la facture.
 *
 * Une fois la facture émise, il n'y a plus de formulaire du tout — pas
 * un champ grisé, pas un bouton désactivé : rien. La base refuserait de
 * toute façon, mais montrer une saisie impossible invite à essayer.
 */
export function InvoiceEditor({
  invoice, lines, locked,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  locked: boolean;
}) {
  const totalHT = lines.reduce((s, l) => s + l.total_cents, 0);
  const totalVAT = lines.reduce(
    (s, l) => s + Math.round((l.total_cents * l.vat_rate) / 100), 0,
  );

  // Ventilation par taux : une facture mêlant 20 % et 10 % doit la
  // montrer, comme sur le devis.
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vat_rate, (byRate.get(l.vat_rate) ?? 0) + l.total_cents);

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
      {lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pl-4 pr-2 font-medium">Désignation</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Qté</th>
                <th className="w-14 px-2 py-2 font-medium">Unité</th>
                <th className="w-24 px-2 py-2 text-right font-medium">P.U. HT</th>
                <th className="w-16 px-2 py-2 text-right font-medium">TVA</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Total HT</th>
                <th className="w-8 py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-line last:border-0">
                  <td className="py-1.5 pl-4 pr-2">{line.description}</td>
                  <td className="tabular px-2 py-1.5 text-right">
                    {formatQuantity(line.quantity)}
                  </td>
                  <td className="px-2 py-1.5 text-ink-soft">{line.unit}</td>
                  <td className="tabular px-2 py-1.5 text-right">
                    {formatCents(line.unit_price_cents)}
                  </td>
                  <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                    {line.vat_rate} %
                  </td>
                  <td className="tabular px-2 py-1.5 text-right font-medium">
                    {formatCents(line.total_cents)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    {!locked && (
                      <form action={deleteInvoiceLine}>
                        <input type="hidden" name="invoice_id" value={invoice.id} />
                        <input type="hidden" name="line_id" value={line.id} />
                        <button type="submit" className="px-1 text-xs text-ink-faint hover:text-critical">
                          ✕
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td colSpan={5} className="py-1.5 pl-4 pr-2 text-right text-xs text-ink-soft">
                  Total HT
                </td>
                <td className="tabular px-2 py-1.5 text-right font-medium">
                  {formatCents(totalHT)}
                </td>
                <td />
              </tr>
              {[...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, base]) => (
                <tr key={rate}>
                  <td colSpan={5} className="py-1 pl-4 pr-2 text-right text-xs text-ink-faint">
                    TVA {rate} % sur {formatCents(base)}
                  </td>
                  <td className="tabular px-2 py-1 text-right text-xs text-ink-soft">
                    {formatCents(Math.round((base * rate) / 100))}
                  </td>
                  <td />
                </tr>
              ))}
              <tr className="border-t border-line-strong">
                <td colSpan={5} className="py-2 pl-4 pr-2 text-right font-semibold">
                  Total TTC
                </td>
                <td className="tabular px-2 py-2 text-right font-semibold">
                  {formatCents(totalHT + totalVAT)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!locked && (
        <form
          action={addInvoiceLine}
          className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5"
        >
          <input type="hidden" name="invoice_id" value={invoice.id} />
          <input
            name="description"
            required
            placeholder="Désignation"
            className="min-w-36 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            name="quantity"
            defaultValue="1"
            className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none focus:border-accent"
          />
          <input
            name="unit"
            list="invoice-units"
            defaultValue="u"
            className="w-14 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <datalist id="invoice-units">
            {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
          </datalist>
          <input
            name="unit_price"
            placeholder="Prix HT"
            className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <select
            name="vat_rate"
            defaultValue="20"
            className="rounded-md border border-line-strong bg-surface px-1.5 py-1.5 text-xs outline-none focus:border-accent"
          >
            {VAT_RATES.map((r) => <option key={r} value={r}>{r} %</option>)}
          </select>
          <button
            type="submit"
            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
          >
            Ajouter
          </button>
        </form>
      )}

      {!locked && (
        <form action={updateInvoice} className="border-t border-line px-4 py-2.5">
          <input type="hidden" name="invoice_id" value={invoice.id} />
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Introduction</span>
              <input
                name="introduction"
                defaultValue={invoice.introduction ?? ""}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Conditions</span>
              <input
                name="terms"
                defaultValue={invoice.terms ?? ""}
                onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
          </div>
        </form>
      )}

      {locked && (
        <form action={updateInvoice} className="border-t border-line bg-canvas px-4 py-2.5">
          <input type="hidden" name="invoice_id" value={invoice.id} />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint">
              Notes internes — ne figurent pas sur le document remis au client
            </span>
            <input
              name="internal_notes"
              defaultValue={invoice.internal_notes ?? ""}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              placeholder="Relancer le 15…"
              className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </label>
        </form>
      )}
    </section>
  );
}
