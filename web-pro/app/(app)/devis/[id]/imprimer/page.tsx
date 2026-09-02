import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/crm/types";
import {
  formatCents, formatQuantity, EMPTY_TOTALS,
  type QuoteLine, type QuoteSection, type QuoteTotals,
} from "@/lib/quotes/types";
import { clientQuoteTotals } from "@/lib/portal/types";
import { PrintButton } from "./PrintButton";

/**
 * §11E — le devis tel qu'il est remis au client.
 *
 * PAS DE BIBLIOTHÈQUE PDF. Cette page est mise en forme pour
 * l'impression, et « Imprimer » du navigateur produit un vrai PDF, avec
 * les polices du système, la pagination correcte et les liens
 * conservés. Embarquer un moteur de rendu PDF ajouterait plusieurs
 * mégaoctets, une deuxième mise en page à maintenir en parallèle de
 * celle-ci, et ses propres bogues de césure — pour un résultat que le
 * navigateur sait déjà produire.
 *
 * CE QUI N'Y FIGURE PAS, DÉLIBÉRÉMENT : ni mention de conformité
 * fiscale, ni numérotation présentée comme inaltérable, ni coûts
 * d'achat ou marges. Le client voit ce qu'il paie ; ce que ça coûte à
 * l'entreprise ne le regarde pas et ne doit jamais fuiter sur le
 * document remis.
 */
export default async function PrintQuotePage({ params }: PageProps<"/devis/[id]/imprimer">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select("*, crm_customers ( display_name, legal_name, siret, billing_address_line1, billing_postal_code, billing_city, email, phone )")
    .eq("id", id)
    .maybeSingle();

  if (!quote) notFound();

  const [{ data: sections }, { data: lines }, { data: totals }, { data: organization }] =
    await Promise.all([
      supabase.from("quote_sections").select("*").eq("quote_id", id).order("position"),
      supabase.from("quote_lines").select("*").eq("quote_id", id).order("position"),
      supabase.from("quote_totals").select("*").eq("quote_id", id).maybeSingle(),
      supabase
        .from("business_organizations")
        // L’ENTÊTE EST CELLE DU DOCUMENT, pas d’une organisation prise
        // au hasard. `limit(1)` sans filtre laissait la RLS rendre toutes
        // les organisations du compte et Postgres choisir la première du
        // tas : un utilisateur membre de deux entreprises — §13 le prévoit
        // explicitement — imprimait un document au SIRET et à l’adresse de
        // l’autre.
        .select("name, legal_name, legal_form, siret, vat_number, rcs_city, address_line1, address_line2, postal_code, city, email, phone, insurance_details")
        .eq("id", quote.organization_id)
        .maybeSingle(),
    ]);

  const t = (totals ?? EMPTY_TOTALS) as QuoteTotals;
  const allLines = (lines ?? []) as QuoteLine[];
  const allSections = (sections ?? []) as QuoteSection[];
  const customer = quote.crm_customers as Record<string, string | null> | null;

  // Ventilation de la TVA par taux : obligatoire dès qu'un devis en
  // mêle plusieurs, et de toute façon ce que le client attend.
  //
  // La même fonction que le portail, et la même formule que la vue
  // `quote_totals`. Le calcul d'ici arrondissait LIGNE PAR LIGNE avant
  // de regrouper, quand la base regroupe puis arrondit : sur un devis à
  // plusieurs lignes avec remise globale, la ventilation ne retombait
  // pas sur le « Total HT » imprimé juste au-dessus.
  const breakdown = clientQuoteTotals(allLines, quote.global_discount_percent);

  const unsectioned = allLines.filter((l) => l.section_id === null);

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
              organization?.address_line2,
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
          {(organization?.legal_form || organization?.rcs_city) && (
            <p className="text-xs text-ink-faint">
              {[organization.legal_form, organization.rcs_city && "RCS " + organization.rcs_city]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {/* Mention obligatoire sur les travaux de paysage. */}
          {organization?.insurance_details && (
            <p className="mt-1 text-xs text-ink-faint">{organization.insurance_details}</p>
          )}
        </div>

        <div className="text-right">
          <h1 className="text-2xl font-semibold tracking-tight">Devis</h1>
          <p className="tabular mt-1 text-sm">{quote.number}</p>
          <p className="mt-1 text-sm text-ink-soft">Émis le {formatDate(quote.issued_on)}</p>
          {quote.valid_until && (
            <p className="text-sm text-ink-soft">Valable jusqu&apos;au {formatDate(quote.valid_until)}</p>
          )}
        </div>
      </header>

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

      {quote.title && <h2 className="mb-3 text-lg font-medium">{quote.title}</h2>}
      {quote.introduction && (
        <p className="mb-6 whitespace-pre-line text-sm leading-relaxed">{quote.introduction}</p>
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
            {quote.global_discount_percent > 0 && (
              <tr>
                <td className="py-1 pr-6 text-ink-soft">
                  Remise commerciale {quote.global_discount_percent} %
                </td>
                <td className="tabular py-1 text-right">
                  −{formatCents(
                    allLines.reduce((s, l) => s + l.sale_total_cents, 0) - t.total_excluding_vat_cents,
                  )}
                </td>
              </tr>
            )}
            <tr className="border-t border-line">
              <td className="py-1.5 pr-6 font-medium">Total HT</td>
              <td className="tabular py-1.5 text-right font-medium">
                {formatCents(t.total_excluding_vat_cents)}
              </td>
            </tr>
            {breakdown.byRate.map((entry) => (
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
                {formatCents(t.total_including_vat_cents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {quote.terms && (
        <section className="mt-8 border-t border-line pt-4">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Conditions
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">{quote.terms}</p>
        </section>
      )}

      <section className="mt-10 flex justify-between gap-10 text-sm">
        <div>
          <p className="text-ink-soft">Date et signature du client</p>
          <p className="mt-1 text-xs text-ink-faint">Précédées de la mention « Bon pour accord »</p>
          <div className="mt-2 h-24 w-64 rounded border border-line" />
        </div>
      </section>
    </div>
  );
}

function LinesTable({ title, lines }: { title: string | null; lines: QuoteLine[] }) {
  const subtotal = lines.reduce((s, l) => s + l.sale_total_cents, 0);

  return (
    <section className="mb-5 break-inside-avoid">
      {title && <h3 className="mb-1 text-sm font-semibold">{title}</h3>}
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
              <td className="tabular px-2 py-1.5 text-right">{formatQuantity(line.quantity)}</td>
              <td className="px-2 py-1.5 text-ink-soft">{line.unit}</td>
              <td className="tabular px-2 py-1.5 text-right">{formatCents(line.unit_sale_price_cents)}</td>
              <td className="tabular px-2 py-1.5 text-right text-ink-soft">{line.vat_rate} %</td>
              <td className="tabular py-1.5 pl-2 text-right">{formatCents(line.sale_total_cents)}</td>
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
    </section>
  );
}
