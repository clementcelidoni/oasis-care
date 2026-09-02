import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import {
  SALES_STATUSES, SALES_STATUS_LABELS, SALES_STATUS_TONE, type SalesStatus,
} from "@/lib/trade/types";
import { NewSalesOrderForm } from "./NewSalesOrderForm";

/** §11N — les commandes clients. */
export default async function SalesOrdersPage({ searchParams }: PageProps<"/pepiniere/commandes">) {
  const params = await searchParams;
  const status = typeof params.statut === "string" ? params.statut : "";

  const supabase = await createClient();

  let request = supabase
    .from("sales_orders")
    .select("id, number, reference, status, ordered_on, requested_on, crm_customers ( display_name )")
    .is("archived_at", null)
    .order("ordered_on", { ascending: false })
    .limit(200);
  if (status) request = request.eq("status", status);

  const [{ data: orders, error }, { data: totals }, { data: customers }] = await Promise.all([
    request,
    supabase.from("sales_order_totals").select("*"),
    supabase.from("crm_customers").select("id, display_name").is("archived_at", null).order("display_name"),
  ]);

  const totalsById = new Map(
    (totals ?? []).map((t) => [t.sales_order_id as string, t.total_excluding_vat_cents as number]),
  );

  const rows = (orders ?? []) as unknown as {
    id: string; number: string; reference: string | null; status: SalesStatus;
    ordered_on: string; requested_on: string | null;
    crm_customers: { display_name: string } | null;
  }[];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Commandes clients"
        subtitle={`${rows.length} commande${rows.length > 1 ? "s" : ""}`}
        action={
          <NewSalesOrderForm customers={(customers ?? []) as { id: string; display_name: string }[]} />
        }
      />

      <nav className="mb-4 flex flex-wrap gap-1.5">
        <FilterLink current={status} value="" label="Toutes" />
        {SALES_STATUSES.map((s) => (
          <FilterLink key={s} current={status} value={s} label={SALES_STATUS_LABELS[s]} />
        ))}
      </nav>

      {error && (
        <p className="mb-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
          {error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={status ? "Aucune commande dans cet état" : "Aucune commande client"}
          description={
            status
              ? "Changez de filtre pour voir les autres."
              : "Une commande réserve le stock dès qu'on lui rattache un lot : le client repart en sachant que ses plantes sont à lui."
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/pepiniere/commandes/${order.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <span className="tabular text-ink-faint">{order.number}</span>{" "}
                      {order.crm_customers?.display_name ?? "Client supprimé"}
                    </p>
                    <p className="truncate text-sm text-ink-soft">
                      Le {formatDate(order.ordered_on)}
                      {order.requested_on && ` · souhaitée le ${formatDate(order.requested_on)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-sm font-medium">
                      {formatCents(totalsById.get(order.id) ?? 0)} HT
                    </span>
                    <Badge tone={SALES_STATUS_TONE[order.status]}>
                      {SALES_STATUS_LABELS[order.status]}
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
  return (
    <Link
      href={value ? `/pepiniere/commandes?statut=${value}` : "/pepiniere/commandes"}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        current === value ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"
      }`}
    >
      {label}
    </Link>
  );
}
