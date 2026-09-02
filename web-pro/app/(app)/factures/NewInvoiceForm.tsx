"use client";

import Link from "next/link";
import { useState } from "react";
import { createInvoice } from "@/lib/finance/actions";

export function NewInvoiceForm({
  customers,
}: {
  customers: { id: string; display_name: string }[];
}) {
  const [open, setOpen] = useState(false);

  if (customers.length === 0) {
    return (
      <Link
        href="/crm/clients/nouveau"
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
      >
        Créer d&apos;abord un client
      </Link>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
      >
        Nouvelle facture
      </button>
    );
  }

  return (
    <form action={createInvoice} className="flex flex-wrap items-center gap-2">
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
