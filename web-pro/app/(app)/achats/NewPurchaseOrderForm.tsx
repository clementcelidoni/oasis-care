"use client";

import Link from "next/link";
import { useState } from "react";
import { createPurchaseOrder } from "@/lib/trade/actions";

export function NewPurchaseOrderForm({
  suppliers,
}: {
  suppliers: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (suppliers.length === 0) {
    return (
      <Link
        href="/fournisseurs"
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
      >
        Ajouter d&apos;abord un fournisseur
      </Link>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
      >
        Nouvelle commande
      </button>
    );
  }

  return (
    <form action={createPurchaseOrder} className="flex flex-wrap items-center gap-2">
      <select
        name="supplier_id"
        required
        defaultValue=""
        className="rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
      >
        <option value="" disabled>Choisir un fournisseur…</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <input
        type="date"
        name="expected_on"
        title="Date de livraison attendue"
        className="rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
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
  );
}
