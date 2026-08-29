import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import {
  INVOICE_STATUS_LABELS, INVOICE_STATUS_TONE, isLocked, balanceTone, EMPTY_BALANCE,
  type Invoice, type InvoiceLine, type InvoiceBalance,
} from "@/lib/finance/types";
import { InvoiceEditor } from "./InvoiceEditor";
import { IssueBar } from "./IssueBar";
import { PaymentPanel } from "./PaymentPanel";

/**
 * §11O — la fiche d'une facture.
 *
 * Un brouillon se rédige ; une facture émise se lit et s'encaisse. Les
 * deux états n'offrent pas les mêmes gestes, et l'écran ne fait pas
 * semblant du contraire.
 */
export default async function InvoicePage({ params }: PageProps<"/factures/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("invoices")
    .select("*, crm_customers ( id, display_name, billing_city ), quotes ( id, number )")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const invoice = data as Invoice & {
    crm_customers: { id: string; display_name: string; billing_city: string | null } | null;
    quotes: { id: string; number: string } | null;
  };

  const [{ data: lines }, { data: balance }, { data: allocations }, { data: creditNotes }] =
    await Promise.all([
      supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("position"),
      supabase.from("invoice_balance").select("*").eq("invoice_id", id).maybeSingle(),
      supabase
        .from("payment_allocations")
        .select("id, amount_cents, payments ( received_on, method, reference )")
        .eq("invoice_id", id),
      supabase
        .from("credit_notes")
        .select("id, number, reason, issued_on, credit_note_lines ( total_cents, vat_rate )")
        .eq("invoice_id", id)
        .order("issued_on", { ascending: false }),
    ]);

  const b = (balance ?? EMPTY_BALANCE) as InvoiceBalance;
  const locked = isLocked(invoice);

  const payments = (allocations ?? []) as unknown as {
    id: string; amount_cents: number;
    payments: { received_on: string; method: string; reference: string | null } | null;
  }[];

  const notes = (creditNotes ?? []) as unknown as {
    id: string; number: string | null; reason: string; issued_on: string | null;
    credit_note_lines: { total_cents: number; vat_rate: number }[];
  }[];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/factures" className="hover:text-ink">Factures</Link>
        <span>/</span>
        <span className="tabular">{invoice.number ?? "Brouillon"}</span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {invoice.crm_customers ? (
              <Link href={`/crm/clients/${invoice.crm_customers.id}`} className="hover:text-accent">
                {invoice.crm_customers.display_name}
              </Link>
            ) : "Client supprimé"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {invoice.issued_on
              ? `Émise le ${formatDate(invoice.issued_on)}`
              : "Brouillon, non émise"}
            {invoice.due_on && ` · échéance ${formatDate(invoice.due_on)}`}
            {invoice.quotes && (
              <>
                {" · issue du devis "}
                <Link href={`/devis/${invoice.quotes.id}`} className="tabular hover:text-ink">
                  {invoice.quotes.number}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <Badge tone={INVOICE_STATUS_TONE[invoice.status]}>
            {INVOICE_STATUS_LABELS[invoice.status]}
          </Badge>
          <p className="mt-1.5 tabular text-lg font-semibold">
            {formatCents(b.total_including_vat_cents)}
          </p>
          {b.outstanding_cents !== b.total_including_vat_cents && (
            <p
              className={`tabular text-xs ${
                balanceTone(b.outstanding_cents) === "critical" ? "text-critical" : "text-ink-faint"
              }`}
            >
              {b.outstanding_cents < 0
                ? `${formatCents(-b.outstanding_cents)} dus au client`
                : b.outstanding_cents === 0
                  ? "soldée"
                  : `reste ${formatCents(b.outstanding_cents)}`}
            </p>
          )}
        </div>
      </div>

      <IssueBar invoice={invoice} lineCount={(lines ?? []).length} />

      <InvoiceEditor
        invoice={invoice}
        lines={(lines ?? []) as InvoiceLine[]}
        locked={locked}
      />

      {locked && <PaymentPanel invoice={invoice} balance={b} />}

      {payments.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Encaissements
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {payments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  {a.payments ? formatDate(a.payments.received_on) : "—"}
                  {a.payments?.reference && (
                    <span className="ml-2 text-ink-faint">{a.payments.reference}</span>
                  )}
                </span>
                <span className="tabular font-medium">{formatCents(a.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Avoirs
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {notes.map((n) => {
              const total = n.credit_note_lines.reduce(
                (s, l) => s + l.total_cents + Math.round((l.total_cents * l.vat_rate) / 100), 0,
              );
              return (
                <li key={n.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span>
                    <span className="tabular font-medium">{n.number}</span>
                    {n.issued_on && <span className="ml-2 text-ink-soft">{formatDate(n.issued_on)}</span>}
                    {n.reason && <span className="ml-2 text-[11px] text-ink-faint">{n.reason}</span>}
                  </span>
                  <span className="tabular font-medium text-critical">−{formatCents(total)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {locked && (
        <p className="text-xs text-ink-faint">
          Cette facture est émise : son contenu ne se modifie plus, et la base le refuse
          — pas seulement cet écran. Une erreur se corrige par un <strong>avoir</strong>,
          qui laisse les deux documents en place. C&apos;est plus lourd, et c&apos;est le
          but : ce que le client a reçu doit rester ce qu&apos;il a reçu.
        </p>
      )}
    </div>
  );
}
