import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents, formatQuantity } from "@/lib/quotes/types";
import {
  SALES_STATUS_LABELS, SALES_STATUS_TONE,
  type SalesOrder, type SalesLine,
} from "@/lib/trade/types";
import { SalesHeader } from "./SalesHeader";
import { SalesLines } from "./SalesLines";
import { DeliveryForm } from "./DeliveryForm";

/**
 * §11N — la fiche d'une commande client.
 *
 * Le stock est réservé à l'ajout d'une ligne et sort à la livraison :
 * entre les deux, il est physiquement là mais plus vendable. C'est
 * exactement la distinction que le Milestone 8 existe pour tenir.
 */
export default async function SalesOrderPage({
  params,
}: PageProps<"/pepiniere/commandes/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales_orders")
    .select("*, crm_customers ( id, display_name )")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const order = data as SalesOrder & {
    crm_customers: { id: string; display_name: string } | null;
  };

  const [{ data: lines }, { data: totals }, { data: deliveries }, { data: lots }] =
    await Promise.all([
      supabase
        .from("sales_order_lines")
        .select("*, nursery_lots ( lot_code, species_name )")
        .eq("sales_order_id", id)
        .order("position"),
      supabase.from("sales_order_totals").select("*").eq("sales_order_id", id).maybeSingle(),
      supabase
        .from("deliveries")
        .select("id, number, delivered_on, carrier, received_by_name, delivery_lines ( id, quantity, sales_order_line_id )")
        .eq("sales_order_id", id)
        .order("delivered_on", { ascending: false }),
      supabase
        .from("nursery_lots")
        .select("id, lot_code, species_name, current_quantity, reserved_quantity, status")
        .eq("status", "available")
        .is("archived_at", null)
        .order("lot_code"),
    ]);

  const allLines = (lines ?? []) as unknown as (SalesLine & {
    nursery_lots: { lot_code: string; species_name: string } | null;
  })[];

  const deliveryList = (deliveries ?? []) as unknown as {
    id: string; number: string; delivered_on: string; carrier: string | null;
    received_by_name: string | null;
    delivery_lines: { id: string; quantity: number; sales_order_line_id: string }[];
  }[];

  // Ce qui a déjà été livré, ligne par ligne.
  const deliveredByLine = new Map<string, number>();
  for (const d of deliveryList) {
    for (const dl of d.delivery_lines) {
      const key = dl.sales_order_line_id;
      deliveredByLine.set(key, (deliveredByLine.get(key) ?? 0) + Number(dl.quantity));
    }
  }

  const totalHT = (totals?.total_excluding_vat_cents as number) ?? 0;
  const totalVAT = (totals?.total_vat_cents as number) ?? 0;
  const editable = order.status === "draft" || order.status === "confirmed";
  const deliverable = order.status === "confirmed" || order.status === "partiallyDelivered";

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/pepiniere/commandes" className="hover:text-ink">Commandes clients</Link>
        <span>/</span>
        <span className="tabular">{order.number}</span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {order.crm_customers ? (
              <Link href={`/crm/clients/${order.crm_customers.id}`} className="hover:text-accent">
                {order.crm_customers.display_name}
              </Link>
            ) : "Client supprimé"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Commandée le {formatDate(order.ordered_on)}
            {order.requested_on && ` · souhaitée le ${formatDate(order.requested_on)}`}
          </p>
        </div>
        <div className="text-right">
          <Badge tone={SALES_STATUS_TONE[order.status]}>
            {SALES_STATUS_LABELS[order.status]}
          </Badge>
          <p className="mt-1.5 tabular text-lg font-semibold">{formatCents(totalHT)} HT</p>
          <p className="tabular text-xs text-ink-faint">
            {formatCents(totalHT + totalVAT)} TTC
          </p>
        </div>
      </div>

      <SalesHeader order={order} />

      <SalesLines
        orderId={id}
        lines={allLines}
        deliveredByLine={deliveredByLine}
        lots={(lots ?? []) as {
          id: string; lot_code: string; species_name: string;
          current_quantity: number; reserved_quantity: number;
        }[]}
        editable={editable}
      />

      {deliverable && allLines.length > 0 && (
        <DeliveryForm
          orderId={id}
          lines={allLines}
          deliveredByLine={deliveredByLine}
        />
      )}

      {deliveryList.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Livraisons
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {deliveryList.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <span className="tabular font-medium">{d.number}</span>
                  <span className="ml-2 text-ink-soft">{formatDate(d.delivered_on)}</span>
                  {d.carrier && <span className="ml-2 text-[11px] text-ink-faint">{d.carrier}</span>}
                </span>
                <span className="text-xs text-ink-soft">
                  <span className="tabular">
                    {formatQuantity(d.delivery_lines.reduce((s, l) => s + Number(l.quantity), 0))}
                  </span>{" "}
                  unités
                  {d.received_by_name && (
                    <span className="text-ink-faint"> · reçu par {d.received_by_name}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
