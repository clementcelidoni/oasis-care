"use client";

import { useState } from "react";
import { addPurchaseLine, deletePurchaseLine } from "@/lib/trade/actions";
import {
  formatCents, formatQuantity, COMMON_UNITS, VAT_RATES,
} from "@/lib/quotes/types";
import { type PurchaseLine, type LineProgress } from "@/lib/trade/types";

/**
 * Les lignes de la commande, avec ce qui reste à recevoir.
 *
 * Une ligne cochée « végétaux » porte l'espèce et le contenant : c'est
 * ce qui permettra de fabriquer le lot à la réception sans tout
 * ressaisir. Une ligne de pots n'en a pas besoin, et le formulaire ne
 * les demande donc pas.
 */
export function PurchaseLines({
  orderId, lines, progress, editable,
}: {
  orderId: string;
  lines: PurchaseLine[];
  progress: Map<string, LineProgress>;
  editable: boolean;
}) {
  const [isPlant, setIsPlant] = useState(true);

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
      {lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pl-4 pr-2 font-medium">Désignation</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Commandé</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Reçu</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Reste</th>
                <th className="w-24 px-2 py-2 text-right font-medium">P.U. achat</th>
                <th className="w-24 px-2 py-2 text-right font-medium">Total HT</th>
                <th className="w-8 py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const p = progress.get(line.id);
                const remaining = p?.remaining ?? line.quantity;
                return (
                  <tr key={line.id} className="border-b border-line last:border-0">
                    <td className="py-1.5 pl-4 pr-2">
                      {line.description}
                      {line.is_plant && (
                        <span className="ml-1.5 rounded bg-accent-wash px-1 text-[10px] text-accent">
                          végétal
                        </span>
                      )}
                      {line.container_size && (
                        <span className="ml-1.5 text-[11px] text-ink-faint">
                          {line.container_size}
                        </span>
                      )}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {formatQuantity(line.quantity)} {line.unit}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                      {formatQuantity(Number(p?.received ?? 0))}
                    </td>
                    <td
                      className={`tabular px-2 py-1.5 text-right ${
                        remaining === 0 ? "text-positive" : "font-medium"
                      }`}
                    >
                      {remaining === 0 ? "soldé" : formatQuantity(Number(remaining))}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                      {formatCents(line.unit_cost_cents)}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right font-medium">
                      {formatCents(line.total_cents)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      {editable && (
                        <form action={deletePurchaseLine}>
                          <input type="hidden" name="purchase_order_id" value={orderId} />
                          <input type="hidden" name="line_id" value={line.id} />
                          <button type="submit" className="px-1 text-xs text-ink-faint hover:text-critical">
                            ✕
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editable ? (
        <form
          action={addPurchaseLine}
          className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5"
        >
          <input type="hidden" name="purchase_order_id" value={orderId} />

          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              name="is_plant"
              checked={isPlant}
              onChange={(e) => setIsPlant(e.target.checked)}
            />
            Végétaux
          </label>

          <input
            name="description"
            required
            placeholder={isPlant ? "Olivier C10" : "Pots C10"}
            className="min-w-36 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />

          {isPlant && (
            <>
              <input
                name="species_name"
                placeholder="Olea europaea"
                title="Nom d'espèce, repris sur le lot à la réception"
                className="w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
              />
              <input
                name="container_size"
                placeholder="C10"
                className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </>
          )}

          <input
            name="quantity"
            defaultValue="1"
            className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none focus:border-accent"
          />
          <input
            name="unit"
            list="purchase-units"
            defaultValue="u"
            className="w-14 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <datalist id="purchase-units">
            {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
          </datalist>
          <input
            name="unit_cost"
            placeholder="Achat HT"
            className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <select
            name="vat_rate"
            defaultValue="20"
            className="rounded-md border border-line-strong bg-surface px-1.5 py-1.5 text-xs outline-none focus:border-accent"
          >
            {VAT_RATES.map((r) => <option key={r} value={r}>{r} %</option>)}
          </select>
          <button
            type="submit"
            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
          >
            Ajouter
          </button>
        </form>
      ) : (
        <p className="border-t border-line bg-canvas px-4 py-2.5 text-[11px] text-ink-faint">
          Les lignes ne se modifient plus une fois la commande envoyée : le fournisseur a reçu
          cette version. Repassez-la en brouillon pour la corriger.
          {lines.length === 0 && " Cette commande est vide."}
        </p>
      )}
    </section>
  );
}
