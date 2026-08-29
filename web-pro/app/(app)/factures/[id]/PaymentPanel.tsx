"use client";

import { useState } from "react";
import { recordPayment, createCreditNote } from "@/lib/finance/actions";
import { formatCents, centsToInput, VAT_RATES } from "@/lib/quotes/types";
import {
  PAYMENT_METHODS, PAYMENT_METHOD_LABELS,
  type Invoice, type InvoiceBalance,
} from "@/lib/finance/types";

/**
 * Encaisser, ou corriger.
 *
 * Deux gestes très différents, volontairement côte à côte : quand une
 * facture émise pose problème, la tentation est de la retoucher. L'écran
 * montre plutôt les deux issues réelles — le client paie, ou on émet un
 * avoir.
 *
 * ENREGISTRER UN ENCAISSEMENT NE DÉCLENCHE AUCUN PAIEMENT. Oasis ne
 * touche à aucun compte bancaire : on constate ce qui est arrivé.
 */
export function PaymentPanel({
  invoice, balance,
}: {
  invoice: Invoice;
  balance: InvoiceBalance;
}) {
  const [tab, setTab] = useState<"payment" | "credit">("payment");
  const settled = balance.outstanding_cents <= 0;

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
      <nav className="flex gap-1 border-b border-line bg-canvas px-2 py-1.5">
        <button
          onClick={() => setTab("payment")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            tab === "payment" ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-surface"
          }`}
        >
          Encaisser
        </button>
        <button
          onClick={() => setTab("credit")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            tab === "credit" ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-surface"
          }`}
        >
          Émettre un avoir
        </button>
      </nav>

      <div className="px-4 py-3">
        {tab === "payment" ? (
          <form action={recordPayment} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Montant reçu</span>
              <input
                name="amount"
                defaultValue={
                  balance.outstanding_cents > 0 ? centsToInput(balance.outstanding_cents) : ""
                }
                disabled={settled}
                className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Moyen</span>
              <select
                name="method"
                defaultValue="transfer"
                disabled={settled}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Reçu le</span>
              <input
                type="date"
                name="received_on"
                defaultValue={new Date().toISOString().slice(0, 10)}
                disabled={settled}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="flex min-w-32 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Référence</span>
              <input
                name="reference"
                placeholder="VIR-001, n° de chèque…"
                disabled={settled}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={settled}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-40"
            >
              Enregistrer
            </button>
            <p className="w-full text-[11px] text-ink-faint">
              {settled
                ? "Cette facture est soldée."
                : `Reste ${formatCents(balance.outstanding_cents)}. Enregistrer un encaissement constate un règlement reçu — Oasis ne déclenche aucun paiement.`}
            </p>
          </form>
        ) : (
          <form action={createCreditNote} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <label className="flex min-w-40 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Objet de l&apos;avoir</span>
              <input
                name="description"
                required
                placeholder="Prestation non réalisée"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Montant HT</span>
              <input
                name="amount"
                required
                className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">TVA</span>
              <select
                name="vat_rate"
                defaultValue="20"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                {VAT_RATES.map((r) => <option key={r} value={r}>{r} %</option>)}
              </select>
            </label>
            <label className="flex min-w-32 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Motif</span>
              <input
                name="reason"
                placeholder="Pourquoi cet avoir"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              Émettre l&apos;avoir
            </button>
            <p className="w-full text-[11px] text-ink-faint">
              L&apos;avoir est émis immédiatement et porte son propre numéro. Il ne remplace
              pas la facture : les deux documents restent, et c&apos;est ce qui rend la
              correction lisible.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
