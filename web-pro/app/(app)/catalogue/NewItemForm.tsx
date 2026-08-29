"use client";

import { useState } from "react";
import { createCatalogItem } from "@/lib/quotes/catalogActions";
import {
  CATALOG_ITEM_TYPES, CATALOG_ITEM_TYPE_LABELS, COMMON_UNITS, VAT_RATES,
} from "@/lib/quotes/types";

/**
 * Ajouter un article et son prix en une fois.
 *
 * Un article sans prix n'est pas chiffrable : le renvoyer vers un second
 * écran pour le saisir garantit qu'il y en aura, dans six mois, des
 * dizaines à zéro euro.
 */
export function NewItemForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent"
      >
        + Ajouter un article
      </button>
    );
  }

  return (
    <form
      action={createCatalogItem}
      className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3"
    >
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Catégorie</span>
        <select
          name="item_type"
          defaultValue="material"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {CATALOG_ITEM_TYPES.map((t) => (
            <option key={t} value={t}>{CATALOG_ITEM_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </label>

      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Désignation</span>
        <input
          name="name"
          required
          placeholder="Olivier 30 L, Heure de main-d'œuvre…"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Unité</span>
        <input
          name="unit"
          list="new-units"
          defaultValue="u"
          className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <datalist id="new-units">
          {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
        </datalist>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Achat HT</span>
        <input
          name="purchase_price"
          placeholder="0,00"
          className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Vente HT</span>
        <input
          name="sale_price"
          placeholder="0,00"
          className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">TVA</span>
        <select
          name="vat_rate"
          defaultValue="20"
          className="rounded-md border border-line-strong bg-surface px-1.5 py-1.5 text-sm outline-none focus:border-accent"
        >
          {VAT_RATES.map((r) => <option key={r} value={r}>{r} %</option>)}
        </select>
      </label>

      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      >
        Ajouter
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
