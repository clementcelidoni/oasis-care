import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import {
  QUOTE_STATUS_LABELS, QUOTE_STATUS_TONE, QUOTE_STATUSES,
  formatCents, type QuoteStatus,
} from "@/lib/quotes/types";
import { NewQuoteForm } from "./NewQuoteForm";

/**
 * §11E — la liste des devis.
 *
 * Les totaux viennent de la vue `quote_totals`, pas de colonnes
 * stockées sur le devis : un montant recalculé ne peut pas mentir sur
 * ce que contiennent réellement les lignes.
 */
export default async function QuotesPage({ searchParams }: PageProps<"/devis">) {
  const params = await searchParams;
  const status = typeof params.statut === "string" ? params.statut : "";

  const supabase = await createClient();

  let request = supabase
    .from("quotes")
    .select("id, number, title, status, issued_on, valid_until, customer_id, crm_customers ( display_name )")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) request = request.eq("status", status);

  const [{ data: quotes, error }, { data: totals }, { data: customers }] = await Promise.all([
    request,
    supabase.from("quote_totals").select("*"),
    supabase
      .from("crm_customers")
      .select("id, display_name")
      .is("archived_at", null)
      .order("display_name"),
  ]);

  const totalsById = new Map(
    (totals ?? []).map((t) => [t.quote_id as string, t.total_excluding_vat_cents as number]),
  );

  const rows = (quotes ?? []) as unknown as {
    id: string; number: string; title: string; status: QuoteStatus;
    issued_on: string; valid_until: string | null;
    crm_customers: { display_name: string } | null;
  }[];
  const customerName = (row: (typeof rows)[number]) =>
    row.crm_customers?.display_name ?? "Client supprimé";

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Devis"
        subtitle={`${rows.length} devis`}
        action={<NewQuoteForm customers={customers ?? []} />}
      />

      <nav className="mb-4 flex flex-wrap gap-1.5">
        <FilterLink current={status} value="" label="Tous" />
        {QUOTE_STATUSES.map((s) => (
          <FilterLink key={s} current={status} value={s} label={QUOTE_STATUS_LABELS[s]} />
        ))}
      </nav>

      {error && (
        <p className="mb-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
          {error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={status ? "Aucun devis dans cet état" : "Aucun devis pour l'instant"}
          description={
            status
              ? "Changez de filtre pour voir les autres."
              : "Un devis part d'un client. Vous pourrez ensuite y verser le métré d'un plan."
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((quote) => (
              <li key={quote.id}>
                <Link
                  href={`/devis/${quote.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <span className="tabular text-ink-faint">{quote.number}</span>{" "}
                      {quote.title}
                    </p>
                    <p className="truncate text-sm text-ink-soft">
                      {customerName(quote)} ·{" "}
                      {formatDate(quote.issued_on)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-sm font-medium">
                      {formatCents(totalsById.get(quote.id) ?? 0)} HT
                    </span>
                    <Badge tone={QUOTE_STATUS_TONE[quote.status]}>
                      {QUOTE_STATUS_LABELS[quote.status]}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function FilterLink({ current, value, label }: { current: string; value: string; label: string }) {
  const active = current === value;
  return (
    <Link
      href={value ? `/devis?statut=${value}` : "/devis"}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        active ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"
      }`}
    >
      {label}
    </Link>
  );
}
