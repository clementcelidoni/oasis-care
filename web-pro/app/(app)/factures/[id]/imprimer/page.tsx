import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/crm/types";
import { formatCents, formatQuantity } from "@/lib/quotes/types";
import { EMPTY_BALANCE, type InvoiceLine, type InvoiceBalance } from "@/lib/finance/types";
import { PrintButton } from "@/app/(app)/devis/[id]/imprimer/PrintButton";

/**
 * La facture telle qu'elle est remise au client.
 *
 * Même mise en page et mêmes règles que le devis : pas de bibliothèque
 * PDF — « Imprimer » du navigateur en produit un vrai —, et jamais un
 * coût d'achat ni une marge. Le client voit ce qu'il paie.
 *
 * UNE MENTION EN PLUS, ET ELLE COMPTE : le pied de page dit que le
 * document n'est pas issu d'un logiciel de comptabilité certifié.
 * L'omettre laisserait croire à une conformité qu'Oasis n'a pas, et
 * c'est l'utilisateur qui en porterait le risque en cas de contrôle.
 */
export default async function PrintInvoicePage({
  params,
}: PageProps<"/factures/[id]/imprimer">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, crm_customers ( display_name, legal_name, siret, billing_address_line1, billing_postal_code, billing_city )")
    .eq("id", id)
    .maybeSingle();

  if (!invoice) notFound();

  const [{ data: lines }, { data: balance }, { data: organization }] = await Promise.all([
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("position"),
    supabase.from("invoice_balance").select("*").eq("invoice_id", id).maybeSingle(),
    supabase
      .from("business_organizations")
      .select("name, legal_name, siret, vat_number, address_line1, postal_code, city, email, phone")
      .limit(1)
      .maybeSingle(),
  ]);

  const allLines = (lines ?? []) as InvoiceLine[];
  const b = (balance ?? EMPTY_BALANCE) as InvoiceBalance;
  const customer = invoice.crm_customers as Record<string, string | null> | null;

  const totalHT = allLines.reduce((s, l) => s + l.total_cents, 0);
  const byRate = new Map<number, number>();
  for (const l of allLines) byRate.set(l.vat_rate, (byRate.get(l.vat_rate) ?? 0) + l.total_cents);

  return (
    <div className="mx-auto max-w-3xl bg-surface px-10 py-10 print:max-w-none print:px-0 print:py-0">
      <PrintButton />

      <header className="mb-8 flex items-start justify-between gap-8">
        <div>
          <p className="text-lg font-semibold">{organization?.name ?? "Oasis Care Pro"}</p>
          {organization?.legal_name && organization.legal_name !== organization.name && (
            <p className="text-sm text-ink-soft">{organization.legal_name}</p>
          )}
          <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">
            {[organization?.address_line1,
              [organization?.postal_code, organization?.city].filter(Boolean).join(" "),
            ].filter(Boolean).join("\n")}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {[organization?.email, organization?.phone].filter(Boolean).join(" · ")}
          </p>
          {organization?.siret && (
            <p className="mt-1 text-xs text-ink-faint">SIRET {organization.siret}</p>
          )}
          {organization?.vat_number && (
            <p className="text-xs text-ink-faint">TVA {organization.vat_number}</p>
          )}
        </div>

        <div className="text-right">
          <h1 className="text-2xl font-semibold tracking-tight">Facture</h1>
          <p className="tabular mt-1 text-sm">{invoice.number ?? "BROUILLON"}</p>
          {invoice.issued_on && (
            <p className="mt-1 text-sm text-ink-soft">Émise le {formatDate(invoice.issued_on)}</p>
          )}
          {invoice.due_on && (
            <p className="text-sm text-ink-soft">Échéance {formatDate(invoice.due_on)}</p>
          )}
        </div>
      </header>

      {!invoice.issued_at && (
        <p className="mb-6 rounded border border-critical px-3 py-2 text-sm text-critical print:border-black print:text-black">
          <strong>Brouillon</strong> — cette facture n&apos;est pas émise, n&apos;a pas de
          numéro et ne doit pas être remise à un client.
        </p>
      )}

      <section className="mb-8 rounded-lg border border-line p-4">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Client</p>
        <p className="font-medium">{customer?.legal_name || customer?.display_name}</p>
        <p className="whitespace-pre-line text-sm text-ink-soft">
          {[customer?.billing_address_line1,
            [customer?.billing_postal_code, customer?.billing_city].filter(Boolean).join(" "),
          ].filter(Boolean).join("\n")}
        </p>
        {customer?.siret && <p className="mt-1 text-xs text-ink-faint">SIRET {customer.siret}</p>}
      </section>

      {invoice.introduction && (
        <p className="mb-6 whitespace-pre-line text-sm leading-relaxed">{invoice.introduction}</p>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <th className="py-1 pr-2 font-medium">Désignation</th>
            <th className="w-20 px-2 py-1 text-right font-medium">Qté</th>
            <th className="w-14 px-2 py-1 font-medium">Unité</th>
            <th className="w-24 px-2 py-1 text-right font-medium">P.U. HT</th>
            <th className="w-14 px-2 py-1 text-right font-medium">TVA</th>
            <th className="w-28 py-1 pl-2 text-right font-medium">Total HT</th>
          </tr>
        </thead>
        <tbody>
          {allLines.map((line) => (
            <tr key={line.id} className="border-b border-line last:border-0">
              <td className="py-1.5 pr-2">{line.description}</td>
              <td className="tabular px-2 py-1.5 text-right">{formatQuantity(line.quantity)}</td>
              <td className="px-2 py-1.5 text-ink-soft">{line.unit}</td>
              <td className="tabular px-2 py-1.5 text-right">{formatCents(line.unit_price_cents)}</td>
              <td className="tabular px-2 py-1.5 text-right text-ink-soft">{line.vat_rate} %</td>
              <td className="tabular py-1.5 pl-2 text-right">{formatCents(line.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-6 flex justify-end">
        <table className="min-w-72 text-sm">
          <tbody>
            <tr className="border-t border-line">
              <td className="py-1.5 pr-6 font-medium">Total HT</td>
              <td className="tabular py-1.5 text-right font-medium">{formatCents(totalHT)}</td>
            </tr>
            {[...byRate.entries()].sort((a, b2) => b2[0] - a[0]).map(([rate, base]) => (
              <tr key={rate}>
                <td className="py-1 pr-6 text-ink-soft">TVA {rate} % sur {formatCents(base)}</td>
                <td className="tabular py-1 text-right text-ink-soft">
                  {formatCents(Math.round((base * rate) / 100))}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line-strong">
              <td className="py-2 pr-6 text-base font-semibold">Total TTC</td>
              <td className="tabular py-2 text-right text-base font-semibold">
                {formatCents(b.total_including_vat_cents)}
              </td>
            </tr>
            {b.paid_cents > 0 && (
              <>
                <tr>
                  <td className="py-1 pr-6 text-ink-soft">Déjà réglé</td>
                  <td className="tabular py-1 text-right text-ink-soft">
                    −{formatCents(b.paid_cents)}
                  </td>
                </tr>
                <tr className="border-t border-line">
                  <td className="py-1.5 pr-6 font-medium">Reste à régler</td>
                  <td className="tabular py-1.5 text-right font-medium">
                    {formatCents(Math.max(0, b.outstanding_cents))}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </section>

      {invoice.terms && (
        <section className="mt-8 border-t border-line pt-4">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Conditions
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">
            {invoice.terms}
          </p>
        </section>
      )}

      <footer className="mt-10 border-t border-line pt-3 text-[10px] leading-relaxed text-ink-faint">
        Document établi avec Oasis Care Pro, qui n&apos;est pas un logiciel de comptabilité
        certifié. Il ne tient ni journal comptable ni archivage à valeur probante, et
        n&apos;est pas certifié NF525.
      </footer>
    </div>
  );
}
