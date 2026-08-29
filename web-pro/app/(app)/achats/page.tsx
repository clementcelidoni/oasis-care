import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import {
  PURCHASE_STATUSES, PURCHASE_STATUS_LABELS, PURCHASE_STATUS_TONE,
  type PurchaseStatus,
} from "@/lib/trade/types";
import { NewPurchaseOrderForm } from "./NewPurchaseOrderForm";

/**
 * §11M — les commandes fournisseurs.
 *
 * L'état vient des réceptions, pas d'une case cochée : une commande
 * marquée « reçue » à la main pendant que la moitié est encore sur le
 * camion ferait mentir le stock prévisionnel.
 */
export default async function PurchasesPage({ searchParams }: PageProps<"/achats">) {
  const params = await searchParams;
  const status = typeof params.statut === "string" ? params.statut : "";

  const supabase = await createClient();

  let request = supabase
    .from("purchase_orders")
    .select("id, number, reference, status, ordered_on, expected_on, suppliers ( name )")
    .is("archived_at", null)
    .order("ordered_on", { ascending: false })
    .limit(200);
  if (status) request = request.eq("status", status);

  const [{ data: orders, error }, { data: totals }, { data: suppliers }] = await Promise.all([
    request,
    supabase.from("purchase_order_totals").select("*"),
    supabase.from("suppliers").select("id, name").is("archived_at", null).order("name"),
  ]);

  const totalsById = new Map(
    (totals ?? []).map((t) => [
      t.purchase_order_id as string,
      t.total_excluding_vat_cents as number,
    ]),
  );

  const rows = (orders ?? []) as unknown as {
    id: string; number: string; reference: string | null; status: PurchaseStatus;
    ordered_on: string; expected_on: string | null;
    suppliers: { name: string } | null;
  }[];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Achats"
        subtitle={`${rows.length} commande${rows.length > 1 ? "s" : ""}`}
        action={
          <NewPurchaseOrderForm
            suppliers={(suppliers ?? []) as { id: string; name: string }[]}
          />
        }
      />

      <nav className="mb-4 flex flex-wrap gap-1.5">
        <FilterLink current={status} value="" label="Toutes" />
        {PURCHASE_STATUSES.map((s) => (
          <FilterLink key={s} current={status} value={s} label={PURCHASE_STATUS_LABELS[s]} />
        ))}
      </nav>

      {error && (
        <p className="mb-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
          {error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={status ? "Aucune commande dans cet état" : "Aucune commande fournisseur"}
          description={
            status
              ? "Changez de filtre pour voir les autres."
              : "Une commande part d'un fournisseur. Les lignes de végétaux pourront devenir des lots à la réception."
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/achats/${order.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <span className="tabular text-ink-faint">{order.number}</span>{" "}
                      {order.suppliers?.name ?? "Fournisseur supprimé"}
                    </p>
                    <p className="truncate text-sm text-ink-soft">
                      Commandée le {formatDate(order.ordered_on)}
                      {order.expected_on && ` · attendue le ${formatDate(order.expected_on)}`}
                      {order.reference && ` · ${order.reference}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-sm font-medium">
                      {formatCents(totalsById.get(order.id) ?? 0)} HT
                    </span>
                    <Badge tone={PURCHASE_STATUS_TONE[order.status]}>
                      {PURCHASE_STATUS_LABELS[order.status]}
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
      href={value ? `/achats?statut=${value}` : "/achats"}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        current === value ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"
      }`}
    >
      {label}
    </Link>
  );
}
