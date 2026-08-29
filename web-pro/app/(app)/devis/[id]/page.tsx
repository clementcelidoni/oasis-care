import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { listCatalog } from "@/lib/quotes/catalogActions";
import {
  QUOTE_STATUS_LABELS, QUOTE_STATUS_TONE, isEditable, formatCents, EMPTY_TOTALS,
  type Quote, type QuoteLine, type QuoteSection, type QuoteTotals,
} from "@/lib/quotes/types";
import { QuoteEditor } from "./QuoteEditor";
import { StatusBar } from "./StatusBar";

/**
 * §11E — la fiche d'un devis.
 *
 * Tout est chargé côté serveur en une passe : le devis, ses sections,
 * ses lignes, ses totaux, le catalogue pour la saisie assistée, et le
 * métré du plan quand le devis est rattaché à un jardin. L'éditeur reçoit
 * des données déjà prêtes, ce qui lui évite une cascade de requêtes au
 * chargement.
 */
export default async function QuotePage({ params }: PageProps<"/devis/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("quotes")
    .select("*, crm_customers ( id, display_name, billing_city )")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  // PostgREST rend du `any` : on fixe la forme ici, une fois, plutôt
  // que de la deviner à chaque usage plus bas.
  const quote = data as Quote & {
    crm_customers: { id: string; display_name: string; billing_city: string | null } | null;
  };

  const [{ data: sections }, { data: lines }, { data: totals }, { data: revisions }, catalog] =
    await Promise.all([
      supabase.from("quote_sections").select("*").eq("quote_id", id).order("position"),
      supabase.from("quote_lines").select("*").eq("quote_id", id).order("position"),
      supabase.from("quote_totals").select("*").eq("quote_id", id).maybeSingle(),
      supabase
        .from("quote_revisions")
        .select("id, label, total_excluding_vat_cents, created_at")
        .eq("quote_id", id)
        .order("created_at", { ascending: false }),
      listCatalog(),
    ]);

  const customer = quote.crm_customers;
  const editable = isEditable(quote.status);

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/devis" className="hover:text-ink">Devis</Link>
        <span>/</span>
        <span className="tabular">{quote.number}</span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{quote.title || "Devis"}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {customer ? (
              <Link href={`/crm/clients/${customer.id}`} className="hover:text-ink">
                {customer.display_name}
              </Link>
            ) : (
              "Client supprimé"
            )}
            {customer?.billing_city ? ` · ${customer.billing_city}` : ""}
            {" · "}
            Émis le {formatDate(quote.issued_on)}
            {quote.valid_until ? ` · valable jusqu'au ${formatDate(quote.valid_until)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={QUOTE_STATUS_TONE[quote.status]}>
            {QUOTE_STATUS_LABELS[quote.status]}
          </Badge>
          <Link
            href={`/devis/${id}/imprimer`}
            target="_blank"
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent"
          >
            Imprimer / PDF
          </Link>
        </div>
      </div>

      <StatusBar quote={quote} />

      {!editable && (
        <p className="mb-5 rounded-lg bg-info-wash px-3 py-2 text-sm text-info">
          Ce devis est <strong>{QUOTE_STATUS_LABELS[quote.status].toLowerCase()}</strong> : il
          n&apos;est plus modifiable. Le client a reçu cette version, et la changer ferait
          diverger ce qu&apos;il a en main de ce que vous voyez. Enregistrez une version, puis
          repassez en brouillon pour reprendre le chiffrage.
        </p>
      )}

      <QuoteEditor
        quote={quote}
        sections={(sections ?? []) as QuoteSection[]}
        lines={(lines ?? []) as QuoteLine[]}
        totals={(totals ?? EMPTY_TOTALS) as QuoteTotals}
        catalog={catalog}
        editable={editable}
      />

      {(revisions ?? []).length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Versions enregistrées
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {(revisions ?? []).map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{r.label}</span>
                <span className="flex items-center gap-4 text-ink-soft">
                  <span className="tabular">{formatCents(r.total_excluding_vat_cents)} HT</span>
                  <span className="tabular text-xs text-ink-faint">{formatDate(r.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
