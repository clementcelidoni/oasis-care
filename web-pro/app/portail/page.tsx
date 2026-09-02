import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePortal } from "@/lib/portal/access";
import { Card, Badge, EmptyState } from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import { formatDate } from "@/lib/crm/types";
import {
  clientQuoteTotals, projectProgress,
  CLIENT_QUOTE_STATUS_LABELS, CLIENT_QUOTE_STATUS_TONE,
  CLIENT_INVOICE_STATUS_LABELS, CLIENT_INVOICE_STATUS_TONE,
  CLIENT_PROJECT_STATUS_LABELS, CLIENT_PROJECT_STATUS_TONE,
  type ClientQuote, type ClientQuoteLine, type ClientInvoice,
  type ClientInvoiceBalance, type ClientProject, type ClientProjectPhase,
} from "@/lib/portal/types";

/**
 * §11S — « Voir ses devis, factures, chantiers, planning ».
 *
 * Une seule page plutôt que quatre listes séparées : un particulier a
 * trois devis et cinq factures, pas trois cents. Répartir si peu de
 * choses sur quatre écrans obligerait à chercher.
 *
 * TOUTES les données viennent des vues `client_*`. Aucune requête de
 * cette page ne touche `quotes`, `invoices` ou `projects` — ces tables
 * lui sont fermées, et c'est ce qui garantit qu'aucun coût ne peut
 * remonter ici par distraction.
 */
export default async function PortalHomePage() {
  await requirePortal();
  const supabase = await createClient();

  const [
    { data: quotes }, { data: quoteLines },
    { data: invoices }, { data: balances },
    { data: projects }, { data: phases },
  ] = await Promise.all([
    supabase.from("client_quotes").select("*").order("issued_on", { ascending: false }),
    supabase.from("client_quote_lines").select("quote_id, vat_rate, sale_total_cents"),
    supabase.from("client_invoices").select("*").order("issued_on", { ascending: false }),
    supabase.from("client_invoice_balance").select("*"),
    supabase.from("client_projects").select("*").order("planned_start_on", { ascending: false }),
    supabase.from("client_project_phases").select("project_id, progress_percent"),
  ]);

  const quoteList = (quotes ?? []) as ClientQuote[];
  const invoiceList = (invoices ?? []) as ClientInvoice[];
  const projectList = (projects ?? []) as ClientProject[];

  const linesByQuote = new Map<string, Pick<ClientQuoteLine, "vat_rate" | "sale_total_cents">[]>();
  for (const line of (quoteLines ?? []) as ClientQuoteLine[]) {
    const bucket = linesByQuote.get(line.quote_id) ?? [];
    bucket.push(line);
    linesByQuote.set(line.quote_id, bucket);
  }

  const balanceById = new Map(
    ((balances ?? []) as ClientInvoiceBalance[]).map((b) => [b.invoice_id, b]),
  );

  const phasesByProject = new Map<string, Pick<ClientProjectPhase, "progress_percent">[]>();
  for (const phase of (phases ?? []) as ClientProjectPhase[]) {
    const bucket = phasesByProject.get(phase.project_id) ?? [];
    bucket.push(phase);
    phasesByProject.set(phase.project_id, bucket);
  }

  // Ce qui reste à payer, tous documents confondus. C'est le seul
  // chiffre qu'un client cherche en arrivant.
  const outstanding = ((balances ?? []) as ClientInvoiceBalance[])
    .reduce((sum, b) => sum + b.outstanding_cents, 0);

  const nothingYet =
    quoteList.length === 0 && invoiceList.length === 0 && projectList.length === 0;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Vos documents</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {outstanding > 0 ? (
            <>
              Il reste{" "}
              <strong className="tabular text-ink">{formatCents(outstanding)}</strong> à
              régler.
            </>
          ) : (
            "Rien à régler pour le moment."
          )}
        </p>
      </header>

      {nothingYet && (
        <EmptyState
          title="Rien à afficher pour l'instant"
          description="Vos devis, factures et chantiers apparaîtront ici dès que votre professionnel les aura établis."
        />
      )}

      {quoteList.length > 0 && (
        <Section title="Devis" count={quoteList.length}>
          <ul className="divide-y divide-line">
            {quoteList.map((quote) => {
              const totals = clientQuoteTotals(
                linesByQuote.get(quote.id) ?? [],
                quote.global_discount_percent,
              );
              return (
                <li key={quote.id}>
                  <Link
                    href={`/portail/devis/${quote.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-canvas"
                  >
                    <span className="tabular text-xs text-ink-faint">{quote.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {quote.title}
                    </span>
                    <Badge tone={CLIENT_QUOTE_STATUS_TONE[quote.status] ?? "neutral"}>
                      {CLIENT_QUOTE_STATUS_LABELS[quote.status] ?? quote.status}
                    </Badge>
                    <span className="tabular text-sm font-medium">
                      {formatCents(totals.totalIncludingVatCents)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {invoiceList.length > 0 && (
        <Section title="Factures" count={invoiceList.length}>
          <ul className="divide-y divide-line">
            {invoiceList.map((invoice) => {
              const balance = balanceById.get(invoice.id);
              return (
                <li key={invoice.id}>
                  <Link
                    href={`/portail/factures/${invoice.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-canvas"
                  >
                    <span className="tabular text-xs text-ink-faint">{invoice.number}</span>
                    <span className="min-w-0 flex-1 text-sm">
                      {invoice.due_on
                        ? `Échéance ${formatDate(invoice.due_on)}`
                        : `Émise le ${formatDate(invoice.issued_on)}`}
                    </span>
                    <Badge tone={CLIENT_INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>
                      {CLIENT_INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                    </Badge>
                    <span className="tabular text-sm font-medium">
                      {formatCents(balance?.total_including_vat_cents ?? 0)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {projectList.length > 0 && (
        <Section title="Chantiers" count={projectList.length}>
          <ul className="divide-y divide-line">
            {projectList.map((project) => {
              const progress = projectProgress(phasesByProject.get(project.id) ?? []);
              return (
                <li key={project.id}>
                  <Link
                    href={`/portail/chantiers/${project.id}`}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-canvas"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {project.name}
                    </span>
                    <Badge tone={CLIENT_PROJECT_STATUS_TONE[project.status] ?? "neutral"}>
                      {CLIENT_PROJECT_STATUS_LABELS[project.status] ?? project.status}
                    </Badge>
                    <span className="flex w-32 items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${progress}%` }}
                        />
                      </span>
                      <span className="tabular w-9 text-right text-xs text-ink-soft">
                        {progress} %
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({
  title, count, children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <span className="text-xs text-ink-faint">{count}</span>
        </div>
        {children}
      </Card>
    </section>
  );
}
