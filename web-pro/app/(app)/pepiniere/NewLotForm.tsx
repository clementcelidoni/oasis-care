"use client";

import { useState } from "react";
import { createLot } from "@/lib/nursery/actions";
import { LOT_STATUSES, LOT_STATUS_LABELS } from "@/lib/nursery/types";

/**
 * Créer un lot.
 *
 * La quantité saisie ici n'est pas écrite directement : elle entre par
 * un mouvement de réception, pour que le journal du lot commence par
 * son origine plutôt que par un solde surgi de nulle part.
 */
export function NewLotForm({
  locations, stages,
}: {
  locations: { id: string; code: string; name: string }[];
  stages: { id: string; code: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
      >
        Nouveau lot
      </button>
    );
  }

  return (
    <form
      action={createLot}
      className="flex w-full flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Code du lot</span>
        <input
          name="lot_code"
          required
          placeholder="TRA-2026-001"
          className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex min-w-44 flex-1 flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Espèce</span>
        <input
          name="species_name"
          required
          placeholder="Trachycarpus fortunei"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Cultivar</span>
        <input
          name="cultivar"
          className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Contenant</span>
        <input
          name="container_size"
          placeholder="C10"
          className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Quantité</span>
        <input
          name="initial_quantity"
          defaultValue="0"
          className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
        />
      </label>

      {stages.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Étape</span>
          <select
            name="stage_id"
            defaultValue=""
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="">—</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}

      {locations.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Emplacement</span>
          <select
            name="location_id"
            defaultValue=""
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">État</span>
        <select
          name="status"
          defaultValue="inProduction"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {LOT_STATUSES.map((s) => (
            <option key={s} value={s}>{LOT_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      >
        Créer
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md px-2 py-1.5 text-sm text-ink-soft hover:bg-canvas"
      >
        Annuler
      </button>
    </form>
  );
}
