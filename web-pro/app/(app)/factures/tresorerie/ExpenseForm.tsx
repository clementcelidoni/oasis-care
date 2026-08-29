"use client";

import { recordExpense } from "@/lib/finance/actions";

/**
 * Saisir une depense.
 *
 * Le rattachement a un chantier n est pas decoratif : la depense entre
 * alors dans son cout reel, et on evite de la saisir deux fois.
 */
export function ExpenseForm({
  suppliers, projects,
}: {
  suppliers: { id: string; name: string }[];
  projects: { id: string; number: string; name: string }[];
}) {
  return (
    <form
      action={recordExpense}
      className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5"
    >
      <input
        type="date"
        name="spent_on"
        defaultValue={new Date().toISOString().slice(0, 10)}
        className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
      />
      <input
        name="description"
        required
        placeholder="Depense"
        className="min-w-32 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
      />
      <input
        name="amount"
        placeholder="Montant HT"
        className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
      />
      <input
        name="vat"
        placeholder="TVA"
        className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
      />
      {suppliers.length > 0 && (
        <select
          name="supplier_id"
          defaultValue=""
          className="max-w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          <option value="">Fournisseur...</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      {projects.length > 0 && (
        <select
          name="project_id"
          defaultValue=""
          title="Rattacher a un chantier fait entrer la depense dans son cout reel."
          className="max-w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          <option value="">Sans chantier</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.number}</option>
          ))}
        </select>
      )}
      <input
        name="invoice_reference"
        placeholder="N facture"
        className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
      />
      <button
        type="submit"
        className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
      >
        Ajouter
      </button>
    </form>
  );
}
