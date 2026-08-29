"use client";

import { addInterventionMaterial, deleteInterventionMaterial } from "@/lib/field/actions";
import { formatQuantity, COMMON_UNITS } from "@/lib/quotes/types";

/**
 * §materials — ce qui a été réellement consommé sur place.
 *
 * Des quantités, sans prix. Le chef d'équipe note ce qu'il a sorti du
 * camion ; ce que ça coûte se saisit sur le chantier, avec la facture
 * du fournisseur sous les yeux. Lui demander un prix ici produirait des
 * chiffres approximatifs qui entreraient dans un budget.
 */
export function Materials({
  interventionId, materials,
}: {
  interventionId: string;
  materials: { id: string; description: string; quantity: number; unit: string }[];
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Fournitures utilisées
      </h2>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {materials.length > 0 && (
          <ul className="divide-y divide-line">
            {materials.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{m.description}</span>
                <span className="shrink-0 tabular text-xs text-ink-soft">
                  {formatQuantity(m.quantity)} {m.unit}
                </span>
                <form action={deleteInterventionMaterial}>
                  <input type="hidden" name="intervention_id" value={interventionId} />
                  <input type="hidden" name="material_id" value={m.id} />
                  <button type="submit" className="px-1 text-xs text-ink-faint hover:text-critical">
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form
          action={addInterventionMaterial}
          className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5"
        >
          <input type="hidden" name="intervention_id" value={interventionId} />
          <input
            name="description"
            required
            placeholder="Fourniture consommée"
            className="min-w-36 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            name="quantity"
            defaultValue="1"
            className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none focus:border-accent"
          />
          <input
            name="unit"
            list="material-units"
            defaultValue="u"
            className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <datalist id="material-units">
            {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
          </datalist>
          <button
            type="submit"
            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
          >
            Ajouter
          </button>
        </form>
      </div>
    </section>
  );
}
