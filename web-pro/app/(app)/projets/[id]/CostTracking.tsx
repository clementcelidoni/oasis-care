"use client";

import { addCost, deleteCost } from "@/lib/projects/actions";
import { formatDate } from "@/lib/crm/types";
import {
  formatCents, formatQuantity, COST_KINDS, COST_KIND_LABELS, COMMON_UNITS,
} from "@/lib/quotes/types";
import { varianceTone, type CostSummaryRow, type ProjectResource, type ProjectCost, type ProjectPhase } from "@/lib/projects/types";

/**
 * §JOB COSTING — « Comparer : Prévu / Réel ».
 *
 * Le prévu vient du devis, au COÛT et non au prix de vente. Le réel est
 * saisi ici, dépense par dépense. Les deux ne se déduisent jamais l'un
 * de l'autre : c'est leur écart qui fait tout l'intérêt du tableau.
 *
 * Dépenser MOINS que prévu n'est pas coloré en vert. C'est le plus
 * souvent qu'une partie du chantier n'est pas encore faite, pas qu'on a
 * gagné de l'argent — et un chiffre rassurant qui ne devrait pas l'être
 * est pire qu'aucun chiffre.
 */
export function CostTracking({
  projectId, summary, resources, costs, phases, suppliers, pendingHours,
}: {
  projectId: string;
  summary: CostSummaryRow[];
  resources: ProjectResource[];
  costs: ProjectCost[];
  phases: ProjectPhase[];
  suppliers: { id: string; name: string }[];
  /** Heures pointées mais pas encore validées — voir plus bas. */
  pendingHours: number;
}) {
  const byKind = new Map(summary.map((r) => [r.kind, r]));
  const kinds = COST_KINDS.filter((k) => {
    const row = byKind.get(k);
    return row && (row.planned_cents > 0 || row.actual_cents > 0);
  });

  const planned = summary.reduce((s, r) => s + r.planned_cents, 0);
  const actual = summary.reduce((s, r) => s + r.actual_cents, 0);

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Prévu contre réel
      </h2>

      {kinds.length === 0 ? (
        <p className="mb-3 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-soft">
          Rien de prévu ni de dépensé pour l&apos;instant. Un chantier issu
          d&apos;un devis arrive avec son budget prévu ; sinon, saisissez vos
          dépenses ci-dessous.
        </p>
      ) : (
        <div className="mb-4 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pl-4 pr-2 font-medium">Nature</th>
                <th className="w-32 px-2 py-2 text-right font-medium">Prévu</th>
                <th className="w-32 px-2 py-2 text-right font-medium">Réel</th>
                <th className="w-32 py-2 pr-4 text-right font-medium">Écart</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((kind) => {
                const row = byKind.get(kind)!;
                const tone = varianceTone(row.variance_cents, row.planned_cents);
                return (
                  <tr key={kind} className="border-b border-line last:border-0">
                    <td className="py-1.5 pl-4 pr-2">{COST_KIND_LABELS[kind]}</td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                      {formatCents(row.planned_cents)}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {formatCents(row.actual_cents)}
                    </td>
                    <td
                      className={`tabular py-1.5 pr-4 text-right ${
                        tone === "critical" ? "font-medium text-critical"
                          : tone === "warning" ? "text-warning" : "text-ink-faint"
                      }`}
                    >
                      {row.variance_cents > 0 ? "+" : ""}{formatCents(row.variance_cents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong">
                <td className="py-2 pl-4 pr-2 font-medium">Total</td>
                <td className="tabular px-2 py-2 text-right font-medium">{formatCents(planned)}</td>
                <td className="tabular px-2 py-2 text-right font-medium">{formatCents(actual)}</td>
                <td
                  className={`tabular py-2 pr-4 text-right font-semibold ${
                    actual - planned > 0 ? "text-critical" : ""
                  }`}
                >
                  {actual - planned > 0 ? "+" : ""}{formatCents(actual - planned)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/*
        Des heures pointées et non validées n'apparaissent dans aucun
        chiffre ci-dessus. Sans ce rappel, on cherche longtemps pourquoi
        la main-d'œuvre reste à zéro alors que l'équipe a travaillé.
      */}
      {pendingHours > 0 && (
        <p className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <strong>{pendingHours.toLocaleString("fr-FR")} h pointées ne sont pas encore
          validées</strong> et n&apos;entrent donc dans aucun chiffre ci-dessus. Validez-les
          depuis la fiche de l&apos;intervention concernée.
        </p>
      )}

      <details className="mb-4">
        <summary className="cursor-pointer text-xs text-ink-soft hover:text-ink">
          Le détail du prévu ({resources.length} ligne{resources.length > 1 ? "s" : ""}, repris du devis)
        </summary>
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface text-sm">
          {resources.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-1.5">
              <span className="min-w-0 truncate">
                {r.description}
                <span className="ml-1.5 text-[11px] text-ink-faint">
                  {COST_KIND_LABELS[r.kind]}
                </span>
              </span>
              <span className="shrink-0 tabular text-ink-soft">
                {formatQuantity(r.planned_quantity)} {r.unit} ·{" "}
                {formatCents(r.planned_total_cents)}
              </span>
            </li>
          ))}
          {resources.length === 0 && (
            <li className="px-4 py-3 text-ink-faint">Aucun budget prévu.</li>
          )}
        </ul>
      </details>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Dépenses réelles
      </h3>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {costs.length > 0 && (
          <ul className="divide-y divide-line">
            {costs.map((cost) => (
              <li key={cost.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-24 shrink-0 tabular text-xs text-ink-faint">
                  {formatDate(cost.incurred_on)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {cost.description}
                  <span className="ml-1.5 text-[11px] text-ink-faint">
                    {COST_KIND_LABELS[cost.kind]}
                    {cost.invoice_reference ? ` · ${cost.invoice_reference}` : ""}
                  </span>
                </span>
                <span className="shrink-0 tabular text-xs text-ink-soft">
                  {formatQuantity(cost.quantity)} {cost.unit}
                </span>
                <span className="w-24 shrink-0 tabular text-right font-medium">
                  {formatCents(cost.total_cents)}
                </span>
                <form action={deleteCost}>
                  <input type="hidden" name="project_id" value={projectId} />
                  <input type="hidden" name="cost_id" value={cost.id} />
                  <button type="submit" className="px-1 text-xs text-ink-faint hover:text-critical">
                    ✕
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <form action={addCost} className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5">
          <input type="hidden" name="project_id" value={projectId} />

          <input
            type="date"
            name="incurred_on"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <select
            name="kind"
            defaultValue="material"
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          >
            {COST_KINDS.map((k) => (
              <option key={k} value={k}>{COST_KIND_LABELS[k]}</option>
            ))}
          </select>
          <input
            name="description"
            required
            placeholder="Dépense"
            className="min-w-36 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <input
            name="quantity"
            defaultValue="1"
            title="Quantité"
            className="w-14 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none focus:border-accent"
          />
          <input
            name="unit"
            list="cost-units"
            defaultValue="u"
            title="Unité"
            className="w-14 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          />
          <datalist id="cost-units">
            {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
          </datalist>
          <input
            name="unit_cost"
            placeholder="Coût HT"
            title="Coût unitaire HT"
            className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
          />
          {phases.length > 0 && (
            <select
              name="phase_id"
              defaultValue=""
              title="Phase"
              className="max-w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="">Sans phase</option>
              {phases.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          )}
          {suppliers.length > 0 && (
            <select
              name="supplier_id"
              defaultValue=""
              title="Fournisseur"
              className="max-w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="">Fournisseur…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <input
            name="invoice_reference"
            placeholder="N° facture"
            className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <button
            type="submit"
            className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
          >
            Enregistrer
          </button>
        </form>
      </div>
    </section>
  );
}
