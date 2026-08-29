"use client";

import { useState } from "react";
import { receiveGoods } from "@/lib/trade/actions";
import { formatQuantity } from "@/lib/quotes/types";
import { type PurchaseLine, type LineProgress } from "@/lib/trade/types";

/**
 * §"RÉCEPTION VÉGÉTAUX : peut créer automatiquement NurseryLot APRÈS
 * VALIDATION."
 *
 * Le mot « validation » gouverne cet écran. La case « créer le lot »
 * est DÉCOCHÉE par défaut, même sur une ligne de végétaux : un lot
 * surgi tout seul dans l'inventaire serait exactement l'ajout
 * silencieux que la spec proscrit ailleurs. On coche, on nomme le lot,
 * et alors seulement il existe.
 */
export function ReceiveForm({
  orderId, lines, progress, locations,
}: {
  orderId: string;
  lines: PurchaseLine[];
  progress: Map<string, LineProgress>;
  locations: { id: string; code: string; name: string }[];
}) {
  const pending = lines.filter((l) => Number(progress.get(l.id)?.remaining ?? l.quantity) > 0);
  const [checked, setChecked] = useState<Set<string>>(new Set(pending.map((l) => l.id)));
  const [creatingLots, setCreatingLots] = useState<Set<string>>(new Set());

  if (pending.length === 0) {
    return (
      <p className="mb-6 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
        Tout est reçu sur cette commande.
      </p>
    );
  }

  const toggle = (set: Set<string>, key: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    update(next);
  };

  return (
    <form action={receiveGoods} className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
      <input type="hidden" name="purchase_order_id" value={orderId} />

      <header className="flex flex-wrap items-end gap-3 border-b border-line bg-canvas px-4 py-2.5">
        <h2 className="text-sm font-semibold">Réceptionner</h2>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Date</span>
          <input
            type="date"
            name="received_on"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Bon de livraison</span>
          <input
            name="delivery_note_reference"
            placeholder="BL-4488"
            title="Reporté sur les lots créés — c'est ce qui permet de remonter la chaîne."
            className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </label>
        {locations.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint">Emplacement des lots</span>
            <select
              name="location_id"
              defaultValue=""
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
            >
              <option value="">—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
              ))}
            </select>
          </label>
        )}
      </header>

      <ul className="divide-y divide-line">
        {pending.map((line) => {
          const remaining = Number(progress.get(line.id)?.remaining ?? line.quantity);
          const on = checked.has(line.id);
          const makeLot = creatingLots.has(line.id);

          return (
            <li key={line.id} className={`px-4 py-2.5 ${on ? "" : "opacity-50"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="checkbox"
                  name="line"
                  value={line.id}
                  checked={on}
                  onChange={() => toggle(checked, line.id, setChecked)}
                />
                <span className="min-w-0 flex-1 text-sm">
                  {line.description}
                  <span className="ml-1.5 text-[11px] text-ink-faint">
                    reste {formatQuantity(remaining)} {line.unit}
                  </span>
                </span>
                <input
                  name={`quantity-${line.id}`}
                  defaultValue={String(remaining)}
                  disabled={!on}
                  className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1 text-right text-sm tabular outline-none focus:border-accent"
                />

                {line.is_plant && (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      name={`create-lot-${line.id}`}
                      checked={makeLot}
                      disabled={!on}
                      onChange={() => toggle(creatingLots, line.id, setCreatingLots)}
                    />
                    Créer un lot
                  </label>
                )}
              </div>

              {line.is_plant && makeLot && on && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                  <input
                    name={`lot-code-${line.id}`}
                    required
                    placeholder="Code du lot — OLE-2026-001"
                    className="w-56 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
                  />
                  <span className="text-[11px] text-ink-faint">
                    {line.species_name ?? line.description}
                    {line.container_size ? ` · ${line.container_size}` : ""} — repris sur le lot.
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-t border-line bg-canvas px-4 py-2.5">
        <button
          type="submit"
          disabled={checked.size === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-40"
        >
          Enregistrer la réception
        </button>
        <p className="text-[11px] text-ink-faint">
          Aucun lot n&apos;est créé sans que vous le demandiez ligne par ligne. L&apos;état de
          la commande — partiellement reçue, reçue — se déduit ensuite tout seul.
        </p>
      </div>
    </form>
  );
}
