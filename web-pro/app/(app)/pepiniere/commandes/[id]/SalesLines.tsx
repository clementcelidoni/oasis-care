"use client";

import { addSalesLine, deleteSalesLine } from "@/lib/trade/actions";
import {
  formatCents, formatQuantity, COMMON_UNITS, VAT_RATES,
} from "@/lib/quotes/types";
import { type SalesLine } from "@/lib/trade/types";

type Lot = {
  id: string;
  lot_code: string;
  species_name: string;
  current_quantity: number;
  reserved_quantity: number;
};

/**
 * Les lignes de la commande.
 *
 * Rattacher un lot RÉSERVE le stock immédiatement. C'est le
 * comportement attendu — le client repart en pensant que ses plantes
 * sont à lui — et c'est aussi ce qui empêche de vendre les mêmes deux
 * fois. Supprimer la ligne libère la réservation : l'oublier bloquerait
 * du stock pour une commande qui n'existe plus.
 */
export function SalesLines({
  orderId, lines, deliveredByLine, lots, editable,
}: {
  orderId: string;
  lines: (SalesLine & { nursery_lots: { lot_code: string; species_name: string } | null })[];
  deliveredByLine: Map<string, number>;
  lots: Lot[];
  editable: boolean;
}) {
  const availableOf = (lot: Lot) => lot.current_quantity - lot.reserved_quantity;

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
      {lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pl-4 pr-2 font-medium">Désignation</th>
                <th className="w-32 px-2 py-2 font-medium">Lot</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Commandé</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Livré</th>
                <th className="w-24 px-2 py-2 text-right font-medium">P.U. HT</th>
                <th className="w-24 px-2 py-2 text-right font-medium">Total HT</th>
                <th className="w-8 py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const delivered = deliveredByLine.get(line.id) ?? 0;
                const complete = delivered >= line.quantity;
                return (
                  <tr key={line.id} className="border-b border-line last:border-0">
                    <td className="py-1.5 pl-4 pr-2">{line.description}</td>
                    <td className="px-2 py-1.5 text-ink-soft">
                      {line.nursery_lots ? (
                        <span className="tabular text-xs">{line.nursery_lots.lot_code}</span>
                      ) : (
                        <span className="text-[11px] text-ink-faint">Sans lot</span>
                      )}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {formatQuantity(line.quantity)} {line.unit}
                    </td>
                    <td
                      className={`tabular px-2 py-1.5 text-right ${
                        complete ? "text-positive" : "text-ink-soft"
                      }`}
                    >
                      {formatQuantity(delivered)}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                      {formatCents(line.unit_sale_price_cents)}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right font-medium">
                      {formatCents(line.total_cents)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {editable && delivered === 0 && (
                        <form action={deleteSalesLine}>
                          <input type="hidden" name="sales_order_id" value={orderId} />
                          <input type="hidden" name="line_id" value={line.id} />
                          <button
                            type="submit"
                            title="Supprimer. Le stock réservé pour cette ligne redevient disponible."
                            className="px-1 text-xs text-ink-faint hover:text-critical"
                          >
                            ✕
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editable ? (
        <form
          action={addSalesLine}
          className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5"
        >
          <input type="hidden" name="sales_order_id" value={orderId} />
          <input
            name="description"
            required
            placeholder="Désignation"
            className="min-w-36 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <select
            name="lot_id"
            defaultValue=""
            title="Rattacher un lot réserve immédiatement le stock."
            className="max-w-52 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          >
            <option value="">Sans lot (ne réserve rien)</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id} disabled={availableOf(l) <= 0}>
                {l.lot_code} — {l.species_name} ({availableOf(l)} dispo.)
              </option>
            ))}
          </select>
          <input
            name="quantity"
            defaultValue="1"
            className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none focus:border-accent"
          />
          <input
            name="unit"
            list="sales-units"
            defaultValue="u"
            className="w-14 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <datalist id="sales-units">
            {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
          </datalist>
          <input
            name="unit_sale_price"
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
          <p className="w-full text-[11px] text-ink-faint">
            Rattacher un lot réserve le stock aussitôt : le physique ne bouge pas, mais ces
            plantes ne sont plus vendables à quelqu&apos;un d&apos;autre.
          </p>
        </form>
      ) : (
        <p className="border-t border-line bg-canvas px-4 py-2.5 text-[11px] text-ink-faint">
          Les lignes ne se modifient plus : une partie au moins est livrée.
        </p>
      )}
    </section>
  );
}
