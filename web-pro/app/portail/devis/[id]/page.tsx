import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requirePortal } from "@/lib/portal/access";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents, formatQuantity } from "@/lib/quotes/types";
import {
  clientQuoteTotals,
  CLIENT_QUOTE_STATUS_LABELS, CLIENT_QUOTE_STATUS_TONE,
  type ClientQuote, type ClientQuoteLine, type ClientQuoteSection,
} from "@/lib/portal/types";
import { Letterhead } from "../../Letterhead";
import { PrintButton } from "../../PrintButton";

/**
 * §11S — « Voir ses devis ».
 *
 * Le devis, tel que le client l'a reçu. Mêmes colonnes, même
 * ventilation de TVA, même total — et rien de plus.
 *
 * LES TROIS COLONNES QUI MANQUENT sont le sujet du milestone :
 * `unit_cost_cents`, `cost_total_cents` et `cost_kind` n'existent pas
 * dans la vue `client_quote_lines`. Ce n'est pas un filtre appliqué
 * ici, où une distraction suffirait à le retirer : elles sont absentes
 * de la donnée qui arrive.
 *
 * Le total est recalculé par `clientQuoteTotals`, qui reproduit la
 * formule de la vue `quote_totals` — laquelle porte la marge dans les
 * mêmes lignes que le total, et reste donc fermée au client.
 */
export default async function PortalQuotePage({ params }: PageProps<"/portail/devis/[id]">) {
  const { id } = await params;
  const companies = await requirePortal();
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("client_quotes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // La vue ne rend que les devis de ce client : un identifiant d'un
  // autre client ressort vide, indiscernable d'un devis inexistant.
  if (!quote) notFound();
  const q = quote as ClientQuote & { organization_id: string };

  const [{ data: sections }, { data: lines }] = await Promise.all([
    supabase.from("client_quote_sections").select("*").eq("quote_id", id).order("position"),
    supabase.from("client_quote_lines").select("*").eq("quote_id", id).order("position"),
  ]);

  const allLines = (lines ?? []) as ClientQuoteLine[];
  const allSections = (sections ?? []) as ClientQuoteSection[];
  const totals = clientQuoteTotals(allLines, q.global_discount_percent);
  const company = companies.find((c) => c.id === q.organization_id) ?? companies[0];

  const beforeGlobalDiscount = allLines.reduce((sum, l) => sum + l.sale_total_cents, 0);
  const unsectioned = allLines.filter((l) => l.section_id === null);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <Link
        href="/portail"
        className="mb-4 inline-block text-sm text-ink-soft hover:text-ink print:hidden"
      >
        ← Vos documents
      </Link>

      <PrintButton label="Imprimer ou enregistrer ce devis" />

      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <Letterhead company={company} />
        <div className="text-right">
          <h1 className="text-2xl font-semibold tracking-tight">Devis</h1>
          <p className="tabular mt-1 text-sm">{q.number}</p>
          <p className="mt-1 text-sm text-ink-soft">Émis le {formatDate(q.issued_on)}</p>
          {q.valid_until && (
            <p className="text-sm text-ink-soft">
              Valable jusqu&apos;au {formatDate(q.valid_until)}
            </p>
          )}
          <div className="mt-2 flex justify-end print:hidden">
            <Badge tone={CLIENT_QUOTE_STATUS_TONE[q.status] ?? "neutral"}>
              {CLIENT_QUOTE_STATUS_LABELS[q.status] ?? q.status}
            </Badge>
          </div>
        </div>
      </header>

      {q.title && <h2 className="mb-3 text-lg font-medium">{q.title}</h2>}
      {q.introduction && (
        <p className="mb-6 whitespace-pre-line text-sm leading-relaxed">{q.introduction}</p>
      )}

      {unsectioned.length > 0 && <LinesTable title={null} lines={unsectioned} />}
      {allSections.map((section) => {
        const sectionLines = allLines.filter((l) => l.section_id === section.id);
        if (sectionLines.length === 0) return null;
        return <LinesTable key={section.id} title={section.title} lines={sectionLines} />;
      })}

      <section className="mt-6 flex justify-end">
        <table className="min-w-72 text-sm">
          <tbody>
            {q.global_discount_percent > 0 && (
              <tr>
                <td className="py-1 pr-6 text-ink-soft">
                  Remise commerciale {q.global_discount_percent} %
                </td>
                <td className="tabular py-1 text-right">
                  −{formatCents(beforeGlobalDiscount - totals.totalExcludingVatCents)}
                </td>
              </tr>
            )}
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
                {formatCents(totals.totalIncludingVatCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {q.terms && (
        <section className="mt-8 border-t border-line pt-4">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Conditions
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{q.terms}</p>
        </section>
      )}

      {/* §"Valider un devis" — pas depuis cet écran, et c'est dit.
          Une acceptation engage juridiquement : elle demande une
          signature, pas un bouton dans un portail. Un bouton
          « J'accepte » qui ne produirait ni trace signée ni preuve de
          consentement donnerait au client l'impression d'avoir signé
          quelque chose. */}
      <section className="mt-8 rounded-lg border border-line bg-canvas px-4 py-3 print:hidden">
        <p className="text-sm font-medium">Pour accepter ce devis</p>
        <p className="mt-1 text-sm text-ink-soft">
          Imprimez-le, portez la mention « Bon pour accord » suivie de votre
          date et de votre signature, et renvoyez-le à{" "}
          {company?.email ? (
            <a className="text-accent hover:underline" href={`mailto:${company.email}`}>
              {company.email}
            </a>
          ) : (
            <>votre professionnel</>
          )}
          . Une signature en ligne viendra plus tard ; en attendant, un devis
          accepté doit rester un document signé.
        </p>
      </section>

      <section className="mt-10 hidden justify-between gap-10 text-sm print:flex">
        <div>
          <p className="text-ink-soft">Date et signature du client</p>
          <p className="mt-1 text-xs text-ink-faint">
            Précédées de la mention « Bon pour accord »
          </p>
          <div className="mt-2 h-24 w-64 rounded border border-line" />
        </div>
      </section>
    </div>
  );
}

function LinesTable({ title, lines }: { title: string | null; lines: ClientQuoteLine[] }) {
  const subtotal = lines.reduce((sum, l) => sum + l.sale_total_cents, 0);

  return (
    <section className="mb-5 break-inside-avoid">
      {title && <h3 className="mb-1 text-sm font-semibold">{title}</h3>}
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
            {lines.map((line) => (
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
                  {formatCents(line.unit_sale_price_cents)}
                </td>
                <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                  {line.vat_rate} %
                </td>
                <td className="tabular py-1.5 pl-2 text-right">
                  {formatCents(line.sale_total_cents)}
                </td>
              </tr>
            ))}
          </tbody>
          {title && lines.length > 1 && (
            <tfoot>
              <tr>
                <td colSpan={5} className="py-1 pr-2 text-right text-xs text-ink-soft">
                  Sous-total {title.toLowerCase()}
                </td>
                <td className="tabular py-1 pl-2 text-right text-xs font-medium">
                  {formatCents(subtotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
