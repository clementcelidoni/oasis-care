"use client";

import { updatePurchaseOrder } from "@/lib/trade/actions";
import {
  PURCHASE_STATUSES, PURCHASE_STATUS_LABELS, DERIVED_PURCHASE_STATUSES,
  type PurchaseOrder,
} from "@/lib/trade/types";

/**
 * L'en-tête d'une commande fournisseur.
 *
 * La liste d'états n'offre que ceux qu'on DÉCIDE : brouillon, envoyée,
 * annulée. « Partiellement reçue » et « reçue » se déduisent des
 * réceptions et sont grisés — les proposer laisserait quelqu'un cocher
 * « reçue » sur une commande encore sur le camion, et le stock
 * prévisionnel mentirait sans que rien ne le signale.
 */
export function PurchaseHeader({ order }: { order: PurchaseOrder }) {
  return (
    <form
      action={updatePurchaseOrder}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-4 py-3"
    >
      <input type="hidden" name="purchase_order_id" value={order.id} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">État</span>
        <select
          name="status"
          defaultValue={order.status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {PURCHASE_STATUSES.map((s) => (
            <option
              key={s}
              value={s}
              disabled={DERIVED_PURCHASE_STATUSES.includes(s)}
            >
              {PURCHASE_STATUS_LABELS[s]}
              {DERIVED_PURCHASE_STATUSES.includes(s) ? " (automatique)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Attendue le</span>
        <input
          type="date"
          name="expected_on"
          defaultValue={order.expected_on ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Référence</span>
        <input
          name="reference"
          defaultValue={order.reference ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          placeholder="Votre référence chez eux"
          className="w-40 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
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

      <p className="w-full text-[11px] text-ink-faint">
        Passez la commande en <strong>Envoyée</strong> pour qu&apos;elle compte dans le stock
        attendu de la pépinière. Un brouillon n&apos;engage personne et n&apos;y figure pas.
        Oasis n&apos;envoie aucun courriel : vous transmettez la commande vous-même.
      </p>
    </form>
  );
}
