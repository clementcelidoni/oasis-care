import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePortal } from "@/lib/portal/access";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents, formatQuantity } from "@/lib/quotes/types";
import {
  clientInvoiceTotals,
  CLIENT_INVOICE_STATUS_LABELS, CLIENT_INVOICE_STATUS_TONE,
  type ClientInvoice, type ClientInvoiceLine, type ClientInvoiceBalance,
} from "@/lib/portal/types";
import { Letterhead } from "../../Letterhead";
import { PrintButton } from "../../PrintButton";

/**
 * §11S — « Voir ses factures ».
 *
 * Une facture NON ÉMISE n'apparaît pas : la vue `client_invoices`
 * exige `issued_at is not null`. C'est cohérent avec le Milestone 10,
 * où une facture n'a de numéro qu'à l'émission — montrer un brouillon
 * au client, c'est lui montrer un montant qui peut encore changer.
 *
 * Le solde vient de la base (`client_invoice_balance`), pas d'un calcul
 * local : règlements et avoirs vivent dans des tables que le client ne
 * lit pas, et la vue en rend le résultat sans en rendre le détail.
 */
export default async function PortalInvoicePage({
  params,
}: PageProps<"/portail/factures/[id]">) {
  const { id } = await params;
  const companies = await requirePortal();
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from("client_invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!invoice) notFound();
  const f = invoice as ClientInvoice & { organization_id: string };

  const [{ data: lines }, { data: balance }] = await Promise.all([
    supabase.from("client_invoice_lines").select("*").eq("invoice_id", id).order("position"),
    supabase.from("client_invoice_balance").select("*").eq("invoice_id", id).maybeSingle(),
  ]);

  const allLines = (lines ?? []) as ClientInvoiceLine[];
  const totals = clientInvoiceTotals(allLines);
  const b = balance as ClientInvoiceBalance | null;
  const company = companies.find((c) => c.id === f.organization_id) ?? companies[0];

  const outstanding = b?.outstanding_cents ?? totals.totalIncludingVatCents;
  const late = f.due_on !== null && outstanding > 0 && new Date(f.due_on) < new Date();

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <Link
        href="/portail"
        className="mb-4 inline-block text-sm text-ink-soft hover:text-ink print:hidden"
      >
        ← Vos documents
      </Link>

      <PrintButton label="Imprimer ou enregistrer cette facture" />

      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <Letterhead company={company} />
        <div className="text-right">
          <h1 className="text-2xl font-semibold tracking-tight">Facture</h1>
          <p className="tabular mt-1 text-sm">{f.number}</p>
          <p className="mt-1 text-sm text-ink-soft">Émise le {formatDate(f.issued_on)}</p>
          {f.due_on && (
            <p className={`text-sm ${late ? "font-medium text-critical" : "text-ink-soft"}`}>
              Échéance {formatDate(f.due_on)}
            </p>
          )}
          <div className="mt-2 flex justify-end print:hidden">
            <Badge tone={CLIENT_INVOICE_STATUS_TONE[f.status] ?? "neutral"}>
              {CLIENT_INVOICE_STATUS_LABELS[f.status] ?? f.status}
            </Badge>
          </div>
        </div>
      </header>

      {f.introduction && (
        <p className="mb-6 whitespace-pre-line text-sm leading-relaxed">{f.introduction}</p>
      )}

      <div className="overflow-x-auto">
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
                <td className="py-1.5 pr-2">
                  {line.description}
                  {line.discount_percent > 0 && (
                    <span className="ml-1 text-xs text-ink-faint">
                      (remise {line.discount_percent} %)
                    </span>
                  )}
                </td>
                <td className="tabular px-2 py-1.5 text-right">
                  {formatQuantity(line.quantity)}
                </td>
                <td className="px-2 py-1.5 text-ink-soft">{line.unit}</td>
                <td className="tabular px-2 py-1.5 text-right">
                  {formatCents(line.unit_price_cents)}
                </td>
                <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                  {line.vat_rate} %
                </td>
                <td className="tabular py-1.5 pl-2 text-right">
                  {formatCents(line.total_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-6 flex justify-end">
        <table className="min-w-72 text-sm">
          <tbody>
            <tr className="border-t border-line">
              <td className="py-1.5 pr-6 font-medium">Total HT</td>
              <td className="tabular py-1.5 text-right font-medium">
                {formatCents(totals.totalExcludingVatCents)}
              </td>
            </tr>
            {totals.byRate.map((entry) => (
              <tr key={entry.rate}>
                <td className="py-1 pr-6 text-ink-soft">
                  TVA {entry.rate} % sur {formatCents(entry.baseCents)}
                </td>
                <td className="tabular py-1 text-right text-ink-soft">
                  {formatCents(entry.vatCents)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line-strong">
              <td className="py-2 pr-6 text-base font-semibold">Total TTC</td>
              <td className="tabular py-2 text-right text-base font-semibold">
                {formatCents(b?.total_including_vat_cents ?? totals.totalIncludingVatCents)}
              </td>
            </tr>

            {/* Ce qui a déjà été réglé, et ce qui reste. Un client qui a
                payé un acompte doit le lire ici, sinon il rappelle. */}
            {b && b.paid_cents > 0 && (
              <tr>
                <td className="py-1 pr-6 text-ink-soft">Déjà réglé</td>
                <td className="tabular py-1 text-right text-ink-soft">
                  −{formatCents(b.paid_cents)}
                </td>
              </tr>
            )}
            {b && b.credited_cents > 0 && (
              <tr>
                <td className="py-1 pr-6 text-ink-soft">Avoir</td>
                <td className="tabular py-1 text-right text-ink-soft">
                  −{formatCents(b.credited_cents)}
                </td>
              </tr>
            )}
            {b && (b.paid_cents > 0 || b.credited_cents > 0) && (
              <tr className="border-t border-line">
                <td className="py-2 pr-6 font-semibold">Reste à régler</td>
                <td
                  className={`tabular py-2 text-right font-semibold ${
                    outstanding > 0 ? "" : "text-positive"
                  }`}
                >
                  {formatCents(outstanding)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {outstanding <= 0 && (
        <p className="mt-4 text-right text-sm font-medium text-positive">
          Cette facture est réglée. Merci.
        </p>
      )}

      {f.terms && (
        <section className="mt-8 border-t border-line pt-4">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Conditions de règlement
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{f.terms}</p>
        </section>
      )}

      {/* Pas de paiement en ligne. Le brancher demande un prestataire,
          un contrat et une conformité qui ne s'improvisent pas — et un
          bouton « Payer » qui n'encaisse rien serait pire que rien. */}
      {outstanding > 0 && (
        <section className="mt-6 rounded-lg border border-line bg-canvas px-4 py-3 print:hidden">
          <p className="text-sm font-medium">Pour régler cette facture</p>
          <p className="mt-1 text-sm text-ink-soft">
            Le règlement se fait directement auprès de{" "}
            {company?.name ?? "votre professionnel"}, selon les conditions
            ci-dessus
            {company?.email && (
              <>
                {" "}
                — ou en écrivant à{" "}
                <a className="text-accent hover:underline" href={`mailto:${company.email}`}>
                  {company.email}
                </a>
              </>
            )}
            . Le paiement en ligne n&apos;est pas encore disponible dans ce
            portail.
          </p>
        </section>
      )}
    </div>
  );
}
