"use client";

import { createLocation } from "@/lib/nursery/actions";
import {
  LOCATION_KINDS, LOCATION_KIND_LABELS, type NurseryLocation,
} from "@/lib/nursery/types";

export function NewLocationForm({ locations }: { locations: NurseryLocation[] }) {
  return (
    <form
      action={createLocation}
      className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Code</span>
        <input
          name="code"
          required
          placeholder="S2"
          className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex min-w-40 flex-1 flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Nom</span>
        <input
          name="name"
          placeholder="Serre 2"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Type</span>
        <select
          name="kind"
          defaultValue="greenhouse"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {LOCATION_KINDS.map((k) => (
            <option key={k} value={k}>{LOCATION_KIND_LABELS[k]}</option>
          ))}
        </select>
      </label>

      {locations.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Dans</span>
          <select
            name="parent_id"
            defaultValue=""
            className="max-w-44 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            <option value="">Aucun parent</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Surface (m²)</span>
        <input
          name="surface_m2"
          className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Capacité</span>
        <input
          name="capacity"
          title="Nombre de contenants que l'emplacement peut recevoir"
          className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
        />
      </label>

      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      >
        Ajouter
      </button>
    </form>
  );
}
