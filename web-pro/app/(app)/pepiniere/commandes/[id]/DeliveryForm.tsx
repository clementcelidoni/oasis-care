"use client";

import { useState } from "react";
import { createDelivery } from "@/lib/trade/actions";
import { formatQuantity } from "@/lib/quotes/types";
import { remainingToDeliver, type SalesLine } from "@/lib/trade/types";

/**
 * §PICKING et §Delivery — la sortie du stock.
 *
 * C'est le moment où les plantes quittent réellement la pépinière. La
 * sortie passe par un mouvement `sell` qui CONSOMME la réservation :
 * décrémenter directement laisserait la réservation en place et
 * bloquerait un stock déjà parti.
 *
 * Les lignes sont rangées par lot — c'est l'itinéraire de préparation
 * demandé par §PICKING : on ne traverse pas la pépinière quatre fois
 * pour une commande de quatre lignes.
 */
export function DeliveryForm({
  orderId, lines, deliveredByLine,
}: {
  orderId: string;
  lines: (SalesLine & { nursery_lots: { lot_code: string; species_name: string } | null })[];
  deliveredByLine: Map<string, number>;
}) {
  const pending = lines
    .filter((l) => remainingToDeliver(l, deliveredByLine) > 0)
    .sort((a, b) => {
      // Sans lot en dernier : ce sont des prestations, on ne va pas les
      // chercher dans une serre.
      const ka = a.nursery_lots?.lot_code ?? "￿";
      const kb = b.nursery_lots?.lot_code ?? "￿";
      return ka.localeCompare(kb, "fr");
    });

  const [checked, setChecked] = useState<Set<string>>(new Set(pending.map((l) => l.id)));

  if (pending.length === 0) {
    return (
      <p className="mb-6 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
        Tout est livré sur cette commande.
      </p>
    );
  }

  const toggle = (key: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <form action={createDelivery} className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
      <input type="hidden" name="sales_order_id" value={orderId} />

      <header className="flex flex-wrap items-end gap-3 border-b border-line bg-canvas px-4 py-2.5">
        <h2 className="text-sm font-semibold">Préparer et livrer</h2>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Date</span>
          <input
            type="date"
            name="delivered_on"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Transporteur</span>
          <input
            name="carrier"
            className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Reçu par</span>
          <input
            name="received_by_name"
            placeholder="Nom de la personne"
            title="Un nom et un horodatage. Ce n'est pas une signature électronique et n'en a pas la valeur."
            className="w-40 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
        </label>
      </header>

      <ul className="divide-y divide-line">
        {pending.map((line) => {
          const remaining = remainingToDeliver(line, deliveredByLine);
          const on = checked.has(line.id);
          return (
            <li
              key={line.id}
              className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${on ? "" : "opacity-50"}`}
            >
              <input
                type="checkbox"
                name="line"
                value={line.id}
                checked={on}
                onChange={() => toggle(line.id)}
              />
              <span className="w-28 shrink-0 tabular text-xs">
                {line.nursery_lots?.lot_code ?? (
                  <span className="text-ink-faint">Sans lot</span>
                )}
              </span>
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
          Enregistrer la livraison
        </button>
        <p className="text-[11px] text-ink-faint">
          Les lignes sont rangées par lot pour ne pas traverser la pépinière plusieurs fois.
          La livraison sort le stock et consomme la réservation.
        </p>
      </div>
    </form>
  );
}
