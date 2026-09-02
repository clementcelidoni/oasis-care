import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import {
  PURCHASE_STATUS_LABELS, PURCHASE_STATUS_TONE,
  type PurchaseOrder, type PurchaseLine, type LineProgress,
} from "@/lib/trade/types";
import { PurchaseHeader } from "./PurchaseHeader";
import { PurchaseLines } from "./PurchaseLines";
import { ReceiveForm } from "./ReceiveForm";

/**
 * §11M — la fiche d'une commande fournisseur.
 *
 * Les lignes d'abord, la réception ensuite, l'historique des réceptions
 * en bas : c'est l'ordre du temps, et celui dans lequel on travaille.
 */
export default async function PurchaseOrderPage({ params }: PageProps<"/achats/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("purchase_orders")
    .select("*, suppliers ( id, name, payment_terms )")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const order = data as PurchaseOrder & {
    suppliers: { id: string; name: string; payment_terms: string | null } | null;
  };

  const [{ data: lines }, { data: progress }, { data: totals }, { data: receipts }, { data: locations }] =
    await Promise.all([
      supabase.from("purchase_order_lines").select("*").eq("purchase_order_id", id).order("position"),
      supabase.from("purchase_order_progress").select("*").eq("purchase_order_id", id),
      supabase.from("purchase_order_totals").select("*").eq("purchase_order_id", id).maybeSingle(),
      supabase
        .from("goods_receipts")
        .select("id, received_on, delivery_note_reference, goods_receipt_lines ( id, quantity, nursery_lot_id, purchase_order_line_id )")
        .eq("purchase_order_id", id)
        .order("received_on", { ascending: false }),
      supabase.from("nursery_locations").select("id, code, name").is("archived_at", null).order("code"),
    ]);

  const allLines = (lines ?? []) as PurchaseLine[];
  const progressByLine = new Map(
    ((progress ?? []) as LineProgress[]).map((p) => [p.line_id, p]),
  );
  const totalHT = (totals?.total_excluding_vat_cents as number) ?? 0;
  const totalVAT = (totals?.total_vat_cents as number) ?? 0;

  const receiptList = (receipts ?? []) as unknown as {
    id: string; received_on: string; delivery_note_reference: string | null;
    goods_receipt_lines: {
      id: string; quantity: number; nursery_lot_id: string | null;
      purchase_order_line_id: string;
    }[];
  }[];

  const editable = order.status === "draft";
  const receivable = order.status === "sent" || order.status === "partiallyReceived";

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/achats" className="hover:text-ink">Achats</Link>
        <span>/</span>
        <span className="tabular">{order.number}</span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {order.suppliers?.name ?? "Fournisseur supprimé"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Commandée le {formatDate(order.ordered_on)}
            {order.expected_on && ` · attendue le ${formatDate(order.expected_on)}`}
            {order.suppliers?.payment_terms && ` · règlement ${order.suppliers.payment_terms}`}
          </p>
        </div>
        <div className="text-right">
          <Badge tone={PURCHASE_STATUS_TONE[order.status]}>
            {PURCHASE_STATUS_LABELS[order.status]}
          </Badge>
          <p className="mt-1.5 tabular text-lg font-semibold">{formatCents(totalHT)} HT</p>
          <p className="tabular text-xs text-ink-faint">
            {formatCents(totalHT + totalVAT)} TTC
          </p>
        </div>
      </div>

      <PurchaseHeader order={order} />

      <PurchaseLines
        orderId={id}
        lines={allLines}
        progress={progressByLine}
        editable={editable}
      />

      {receivable && allLines.length > 0 && (
        <ReceiveForm
          orderId={id}
          lines={allLines}
          progress={progressByLine}
          locations={(locations ?? []) as { id: string; code: string; name: string }[]}
        />
      )}

      {receiptList.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Réceptions
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {receiptList.map((r) => {
              const total = r.goods_receipt_lines.reduce((s, l) => s + Number(l.quantity), 0);
              const lots = r.goods_receipt_lines.filter((l) => l.nursery_lot_id).length;
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span>
                    {formatDate(r.received_on)}
                    {r.delivery_note_reference && (
                      <span className="ml-2 text-ink-faint">{r.delivery_note_reference}</span>
                    )}
                  </span>
                  <span className="text-xs text-ink-soft">
                    <span className="tabular">{total}</span> reçus
                    {lots > 0 && (
                      <span className="text-positive">
                        {" "}· {lots} lot{lots > 1 ? "s" : ""} créé{lots > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
