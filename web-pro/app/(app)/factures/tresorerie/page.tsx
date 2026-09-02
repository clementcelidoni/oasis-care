import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import {
  monthlyCashFlow, formatMonth, type CashFlowEntry,
} from "@/lib/finance/types";
import { ExpenseForm } from "./ExpenseForm";
import { DeleteExpenseButton } from "./DeleteExpenseButton";

/**
 * §DÉPENSES / TRÉSORERIE OPÉRATIONNELLE.
 *
 * CE N'EST PAS UNE TRÉSORERIE PRÉVISIONNELLE. Rien ici n'anticipe une
 * échéance à venir ni un découvert : ce sont les mouvements CONSTATÉS,
 * additionnés dans l'ordre. Présenter cela comme une prévision serait
 * la fausse assurance que la spec interdit — et c'est sur une prévision
 * qu'on décide d'embaucher.
 */
export default async function CashFlowPage() {
  const supabase = await createClient();

  const [{ data: entries }, { data: expenses }, { data: suppliers }, { data: projects }] =
    await Promise.all([
      supabase
        .from("cash_flow_entries")
        .select("*")
        .order("occurred_on", { ascending: false })
        .limit(500),
      supabase
        .from("business_expenses")
        .select("id, description, amount_cents, vat_cents, spent_on, invoice_reference, suppliers ( name ), projects ( id, number )")
        .order("spent_on", { ascending: false })
        .limit(100),
      supabase.from("suppliers").select("id, name").is("archived_at", null).order("name"),
      supabase.from("projects").select("id, number, name").is("archived_at", null).order("created_at", { ascending: false }),
    ]);

  const flow = (entries ?? []) as CashFlowEntry[];
  const months = monthlyCashFlow(flow).slice(-12);

  const expenseList = (expenses ?? []) as unknown as {
    id: string; description: string; amount_cents: number; vat_cents: number;
    spent_on: string; invoice_reference: string | null;
    suppliers: { name: string } | null;
    projects: { id: string; number: string } | null;
  }[];

  const totalIn = flow.filter((e) => e.amount_cents > 0).reduce((s, e) => s + e.amount_cents, 0);
  const totalOut = flow.filter((e) => e.amount_cents < 0).reduce((s, e) => s + e.amount_cents, 0);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/factures" className="hover:text-ink">Factures</Link>
        <span>/</span>
        <span>Trésorerie</span>
      </div>

      <PageHeader
        title="Trésorerie"
        subtitle={`${formatCents(totalIn)} encaissés · ${formatCents(-totalOut)} dépensés`}
      />

      {months.length > 0 && (
        <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
          {/* Le div qui défile, à l'intérieur de la bordure arrondie :
              `overflow-hidden` seul COUPERAIT la colonne « Net » sur un
              écran étroit, sans barre de défilement pour aller la
              chercher. */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pl-4 pr-2 font-medium">Mois</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Encaissé</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Dépensé</th>
                <th className="w-28 px-2 py-2 text-right font-medium">Net</th>
                <th className="w-28 py-2 pr-4 text-right font-medium">Cumulé</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className="border-b border-line last:border-0">
                  <td className="py-1.5 pl-4 pr-2">{formatMonth(m.month)}</td>
                  <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                    {m.inCents > 0 ? formatCents(m.inCents) : "—"}
                  </td>
                  <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                    {m.outCents < 0 ? formatCents(-m.outCents) : "—"}
                  </td>
                  <td
                    className={`tabular px-2 py-1.5 text-right font-medium ${
                      m.netCents < 0 ? "text-critical" : ""
                    }`}
                  >
                    {formatCents(m.netCents)}
                  </td>
                  <td
                    className={`tabular py-1.5 pr-4 text-right ${
                      m.runningCents < 0 ? "text-critical" : "text-ink-soft"
                    }`}
                  >
                    {formatCents(m.runningCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
      )}

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Dépenses
      </h2>

      <div className="mb-4 overflow-hidden rounded-lg border border-line bg-surface">
        {expenseList.length > 0 && (
          <ul className="divide-y divide-line">
            {expenseList.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-24 shrink-0 tabular text-xs text-ink-faint">
                  {formatDate(e.spent_on)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {e.description}
                  <span className="ml-1.5 text-[11px] text-ink-faint">
                    {[e.suppliers?.name, e.invoice_reference].filter(Boolean).join(" · ")}
                  </span>
                  {e.projects && (
                    <Link
                      href={`/projets/${e.projects.id}`}
                      className="ml-1.5 text-[11px] text-accent hover:underline"
                    >
                      {e.projects.number}
                    </Link>
                  )}
                </span>
                <span className="tabular text-right font-medium">
                  {formatCents(e.amount_cents + e.vat_cents)}
                </span>
                <DeleteExpenseButton expenseId={e.id} />
              </li>
            ))}
          </ul>
        )}

        <ExpenseForm
          suppliers={(suppliers ?? []) as { id: string; name: string }[]}
          projects={(projects ?? []) as { id: string; number: string; name: string }[]}
        />
      </div>

      {flow.length === 0 && (
        <EmptyState
          title="Aucun mouvement"
          description="Les encaissements de factures et les dépenses saisies ici composent ce tableau."
        />
      )}

      <p className="mt-4 text-xs text-ink-faint">
        Ce tableau montre les mouvements <strong>constatés</strong>, mois par mois. Ce
        n&apos;est pas une trésorerie prévisionnelle : rien n&apos;anticipe une échéance à
        venir ni un découvert. Une dépense rattachée à un chantier alimente aussi son coût
        réel, pour ne pas la saisir deux fois.
      </p>
    </div>
  );
}
