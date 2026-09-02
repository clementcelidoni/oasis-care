import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import { refreshOverdue } from "@/lib/finance/actions";
import {
  INVOICE_STATUSES, INVOICE_STATUS_LABELS, INVOICE_STATUS_TONE,
  type InvoiceStatus,
} from "@/lib/finance/types";
import { NewInvoiceForm } from "./NewInvoiceForm";

/**
 * §11O — les factures.
 *
 * Le retard se recalcule à l'ouverture de la page : Oasis n'a pas
 * encore de tâche planifiée, et une facture affichée « émise » trois
 * semaines après son échéance serait pire que pas de statut du tout.
 */
export default async function InvoicesPage({ searchParams }: PageProps<"/factures">) {
  const params = await searchParams;
  const status = typeof params.statut === "string" ? params.statut : "";

  await refreshOverdue();

  const supabase = await createClient();

  let request = supabase
    .from("invoices")
    .select("id, number, status, issued_on, due_on, crm_customers ( display_name )")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) request = request.eq("status", status);

  const [{ data: invoices, error }, { data: balances }, { data: customers }] = await Promise.all([
    request,
    supabase.from("invoice_balance").select("*"),
    supabase.from("crm_customers").select("id, display_name").is("archived_at", null).order("display_name"),
  ]);

  const balanceById = new Map(
    (balances ?? []).map((b) => [
      b.invoice_id as string,
      {
        total: b.total_including_vat_cents as number,
        outstanding: b.outstanding_cents as number,
      },
    ]),
  );

  const rows = (invoices ?? []) as unknown as {
    id: string; number: string | null; status: InvoiceStatus;
    issued_on: string | null; due_on: string | null;
    crm_customers: { display_name: string } | null;
  }[];

  const outstandingTotal = rows.reduce(
    (sum, r) => sum + Math.max(0, balanceById.get(r.id)?.outstanding ?? 0), 0,
  );
  const overdueCount = rows.filter((r) => r.status === "overdue").length;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Factures"
        subtitle={
          outstandingTotal > 0
            ? `${formatCents(outstandingTotal)} en attente de règlement${overdueCount > 0 ? ` · ${overdueCount} en retard` : ""}`
            : `${rows.length} facture${rows.length > 1 ? "s" : ""}`
        }
        action={
          <NewInvoiceForm customers={(customers ?? []) as { id: string; display_name: string }[]} />
        }
      />

      <nav className="mb-4 flex flex-wrap items-center gap-1.5">
        <FilterLink current={status} value="" label="Toutes" />
        {INVOICE_STATUSES.map((s) => (
          <FilterLink key={s} current={status} value={s} label={INVOICE_STATUS_LABELS[s]} />
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <Link
          href="/factures/tresorerie"
          className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-canvas"
        >
          Trésorerie
        </Link>
        <Link
          href="/factures/export"
          className="rounded-md px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-canvas"
        >
          Export comptable
        </Link>
      </nav>

      {error && (
        <p className="mb-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
          {error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={status ? "Aucune facture dans cet état" : "Aucune facture"}
          description={
            status
              ? "Changez de filtre pour voir les autres."
              : "Une facture part d'un client, ou d'un devis accepté depuis sa fiche."
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((invoice) => {
              const b = balanceById.get(invoice.id);
              return (
                <li key={invoice.id}>
                  <Link
                    href={`/factures/${invoice.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <span className="tabular text-ink-faint">
                          {invoice.number ?? "Brouillon"}
                        </span>{" "}
                        {invoice.crm_customers?.display_name ?? "Client supprimé"}
                      </p>
                      <p className="truncate text-sm text-ink-soft">
                        {invoice.issued_on
                          ? `Émise le ${formatDate(invoice.issued_on)}`
                          : "Non émise"}
                        {invoice.due_on && ` · échéance ${formatDate(invoice.due_on)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-right text-xs">
                        <span className="block tabular text-sm font-medium">
                          {formatCents(b?.total ?? 0)}
                        </span>
                        {b && b.outstanding > 0 && b.outstanding !== b.total && (
                          <span className="block tabular text-ink-faint">
                            reste {formatCents(b.outstanding)}
                          </span>
                        )}
                      </span>
                      <Badge tone={INVOICE_STATUS_TONE[invoice.status]}>
                        {INVOICE_STATUS_LABELS[invoice.status]}
                      </Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        Oasis Care Pro tient vos factures avec assez de rigueur pour qu&apos;un
        expert-comptable s&apos;en serve. Ce n&apos;est <strong>pas une comptabilité
        certifiée</strong> : ni NF525, ni archivage à valeur probante, ni journal comptable.
        Aucune facture n&apos;est envoyée et aucun paiement n&apos;est déclenché — vous
        transmettez et vous constatez.
      </p>
    </div>
  );
}

function FilterLink({ current, value, label }: { current: string; value: string; label: string }) {
  return (
    <Link
      href={value ? `/factures?statut=${value}` : "/factures"}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        current === value ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"
      }`}
    >
      {label}
    </Link>
  );
}
