"use client";

import { updateSalesOrder } from "@/lib/trade/actions";
import {
  SALES_STATUSES, SALES_STATUS_LABELS, DERIVED_SALES_STATUSES, type SalesOrder,
} from "@/lib/trade/types";

/**
 * L'en-tête d'une commande client.
 *
 * Comme pour les achats, seuls les états qu'on DÉCIDE se saisissent.
 * « Partiellement livrée » et « livrée » suivent les bons de livraison,
 * et sont grisés ici.
 */
export function SalesHeader({ order }: { order: SalesOrder }) {
  return (
    <form
      action={updateSalesOrder}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-4 py-3"
    >
      <input type="hidden" name="sales_order_id" value={order.id} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">État</span>
        <select
          name="status"
          defaultValue={order.status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {SALES_STATUSES.map((s) => (
            <option key={s} value={s} disabled={DERIVED_SALES_STATUSES.includes(s)}>
              {SALES_STATUS_LABELS[s]}
              {DERIVED_SALES_STATUSES.includes(s) ? " (automatique)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Souhaitée le</span>
        <input
          type="date"
          name="requested_on"
          defaultValue={order.requested_on ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Référence client</span>
        <input
          name="reference"
          defaultValue={order.reference ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-40 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Notes</span>
        <input
          name="notes"
          defaultValue={order.notes ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>
    </form>
  );
}
