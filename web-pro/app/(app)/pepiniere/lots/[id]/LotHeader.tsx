"use client";

import { updateLot } from "@/lib/nursery/actions";
import { LOT_STATUSES, LOT_STATUS_LABELS, type NurseryLot } from "@/lib/nursery/types";

/**
 * Ce qui décrit le lot, modifiable sur place.
 *
 * Les quantités ne sont PAS ici : elles n'ont d'autre chemin qu'un
 * mouvement. Un champ « quantité » modifiable donnerait un stock qu'on
 * ne peut plus expliquer.
 */
export function LotHeader({
  lot, stages,
}: {
  lot: NurseryLot & { stage_id?: string | null };
  stages: { id: string; label: string }[];
}) {
  return (
    <form
      action={updateLot}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-4 py-3"
    >
      <input type="hidden" name="lot_id" value={lot.id} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">État</span>
        <select
          name="status"
          defaultValue={lot.status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {LOT_STATUSES.map((s) => (
            <option key={s} value={s}>{LOT_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </label>

      {stages.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Étape</span>
          <select
            name="stage_id"
            defaultValue={lot.stage_id ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="">—</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Contenant</span>
        <input
          name="container_size"
          defaultValue={lot.container_size ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Calibre</span>
        <input
          name="plant_size"
          defaultValue={lot.plant_size ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          placeholder="80/100"
          className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Lot fournisseur</span>
        <input
          name="supplier_lot_reference"
          defaultValue={lot.supplier_lot_reference ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          title="La référence portée sur le bordereau — c'est elle qui permet de remonter la chaîne."
          className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Notes</span>
        <input
          name="notes"
          defaultValue={lot.notes ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>
    </form>
  );
}
