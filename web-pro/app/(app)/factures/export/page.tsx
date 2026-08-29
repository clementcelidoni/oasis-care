import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents } from "@/lib/quotes/types";
import { ExportButtons } from "./ExportButtons";

/**
 * §"Prévoir export vers expert-comptable / logiciel comptable."
 *
 * Un CSV, pas un format propriétaire. Le document interdit d'« intégrer
 * un fournisseur précis avant décision » : se lier à Sage ou Pennylane
 * aujourd'hui reviendrait à choisir à la place de l'utilisateur. Un
 * tableur se relit à l'œil, s'ouvre partout, et tout logiciel comptable
 * sait l'importer.
 *
 * L'écran affiche ce qui SERA exporté avant de l'exporter : un export
 * dont on découvre le contenu en l'ouvrant chez le comptable est un
 * export qu'on refait.
 */
export default async function ExportPage({ searchParams }: PageProps<"/factures/export">) {
  const params = await searchParams;
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    .toISOString().slice(0, 10);
  const from = typeof params.du === "string" ? params.du : defaultFrom;
  const to = typeof params.au === "string" ? params.au : now.toISOString().slice(0, 10);

  const supabase = await createClient();

  const [{ data: invoices }, { data: payments }, { data: expenses }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, number, issued_on, status, crm_customers ( display_name )")
      .not("issued_at", "is", null)
      .gte("issued_on", from)
      .lte("issued_on", to)
      .order("issued_on"),
    supabase
      .from("payments")
      .select("id, received_on, amount_cents, method, reference")
      .gte("received_on", from)
      .lte("received_on", to)
      .order("received_on"),
    supabase
      .from("business_expenses")
      .select("id, spent_on, description, amount_cents, vat_cents, invoice_reference, suppliers ( name )")
      .gte("spent_on", from)
      .lte("spent_on", to)
      .order("spent_on"),
  ]);

  const invoiceRows = (invoices ?? []) as unknown as {
    id: string; number: string; issued_on: string; status: string;
    crm_customers: { display_name: string } | null;
  }[];

  // Les totaux des factures exportées, chargés à part pour ne pas
  // dépendre d'une jointure sur une vue.
  const { data: totals } = await supabase.from("invoice_totals").select("*");
  const totalById = new Map(
    (totals ?? []).map((t) => [
      t.invoice_id as string,
      {
        ht: t.total_excluding_vat_cents as number,
        vat: t.total_vat_cents as number,
        ttc: t.total_including_vat_cents as number,
      },
    ]),
  );

  const paymentRows = (payments ?? []) as {
    id: string; received_on: string; amount_cents: number;
    method: string; reference: string | null;
  }[];

  const expenseRows = (expenses ?? []) as unknown as {
    id: string; spent_on: string; description: string; amount_cents: number;
    vat_cents: number; invoice_reference: string | null;
    suppliers: { name: string } | null;
  }[];

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/factures" className="hover:text-ink">Factures</Link>
        <span>/</span>
        <span>Export comptable</span>
      </div>

      <PageHeader
        title="Export comptable"
        subtitle={`Du ${formatDate(from)} au ${formatDate(to)}`}
      />

      <form className="mb-5 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface px-4 py-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Du</span>
          <input
            type="date"
            name="du"
            defaultValue={from}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-faint">Au</span>
          <input
            type="date"
            name="au"
            defaultValue={to}
            className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent"
        >
          Afficher la période
        </button>
      </form>

      <ExportButtons
        from={from}
        to={to}
        invoices={invoiceRows.map((i) => ({
          numero: i.number,
          date: i.issued_on,
          client: i.crm_customers?.display_name ?? "",
          ht: (totalById.get(i.id)?.ht ?? 0) / 100,
          tva: (totalById.get(i.id)?.vat ?? 0) / 100,
          ttc: (totalById.get(i.id)?.ttc ?? 0) / 100,
          etat: i.status,
        }))}
        payments={paymentRows.map((p) => ({
          date: p.received_on,
          montant: p.amount_cents / 100,
          moyen: p.method,
          reference: p.reference ?? "",
        }))}
        expenses={expenseRows.map((e) => ({
          date: e.spent_on,
          libelle: e.description,
          fournisseur: e.suppliers?.name ?? "",
          ht: e.amount_cents / 100,
          tva: e.vat_cents / 100,
          piece: e.invoice_reference ?? "",
        }))}
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        <Summary
          label="Factures émises"
          count={invoiceRows.length}
          amount={invoiceRows.reduce((s, i) => s + (totalById.get(i.id)?.ttc ?? 0), 0)}
        />
        <Summary
          label="Encaissements"
          count={paymentRows.length}
          amount={paymentRows.reduce((s, p) => s + p.amount_cents, 0)}
        />
        <Summary
          label="Dépenses"
          count={expenseRows.length}
          amount={expenseRows.reduce((s, e) => s + e.amount_cents + e.vat_cents, 0)}
        />
      </section>

      <p className="mt-6 text-xs text-ink-faint">
        Ces fichiers sont destinés à votre expert-comptable. Ils ne constituent
        <strong> pas une comptabilité certifiée</strong> : Oasis Care Pro ne tient ni journal
        comptable, ni archivage à valeur probante, et n&apos;est pas certifié NF525. Seules
        les factures <strong>émises</strong> figurent dans l&apos;export — un brouillon
        n&apos;a pas de numéro et n&apos;existe pas comptablement.
      </p>
      <p className="mt-2 text-xs text-ink-faint">
        Le format est un CSV volontairement neutre : se lier aujourd&apos;hui à un logiciel
        comptable précis reviendrait à choisir à votre place.
      </p>
    </div>
  );
}

function Summary({ label, count, amount }: { label: string; count: number; amount: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-1 tabular text-xl font-semibold">{formatCents(amount)}</p>
      <p className="mt-1 text-[11px] text-ink-faint">
        {count} ligne{count > 1 ? "s" : ""}
      </p>
    </div>
  );
}
