"use client";

import { useState } from "react";
import { createProject } from "@/lib/projects/actions";

/**
 * Un chantier parti de rien.
 *
 * Le chemin normal reste « devis accepté → transformer en chantier » :
 * il reprend les postes, les quantités et les coûts prévus, alors
 * qu'ici tout est à ressaisir. D'où la phrase sous le formulaire.
 */
export function NewProjectForm({
  customers,
}: {
  customers: { id: string; display_name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={customers.length === 0}
        className="rounded-lg border border-line-strong px-3.5 py-2 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
      >
        Chantier sans devis
      </button>
    );
  }

  return (
    <div>
      <form action={createProject} className="flex flex-wrap items-center gap-2">
        <select
          name="customer_id"
          required
          defaultValue=""
          className="rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="" disabled>Choisir un client…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.display_name}</option>
          ))}
        </select>
        <input
          name="name"
          placeholder="Nom du chantier"
          className="rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
        >
          Créer
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-2 py-2 text-sm text-ink-soft hover:bg-canvas"
        >
          Annuler
        </button>
      </form>
      <p className="mt-1.5 text-right text-[11px] text-ink-faint">
        Sans devis, le budget prévu part de zéro : tout sera à saisir à la main.
      </p>
    </div>
  );
}
