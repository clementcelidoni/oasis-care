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
import { ToProjectBar } from "./ToProjectBar";
import { ToInvoiceBar } from "./ToInvoiceBar";

/**
 * §11E — la fiche d'un devis.
 *
 * Tout est chargé côté serveur en une passe : le devis, ses sections,
 * ses lignes, ses totaux, le catalogue pour la saisie assistée, et le
 * métré du plan quand le devis est rattaché à un jardin. L'éditeur reçoit
 * des données déjà prêtes, ce qui lui évite une cascade de requêtes au
 * chargement.
 */
export default async function QuotePage({
  params,
  searchParams,
}: PageProps<"/devis/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  /**
   * §39 MODE CLIENT — « Mode présentation client. Masquer : coûts
   * internes ; marge ; notes ; informations confidentielles. »
   *
   * L'état vit dans l'URL et non dans un `useState`, pour une raison
   * précise : on retourne l'écran vers quelqu'un. Un rechargement, une
   * touche F5, un retour arrière — n'importe lequel de ces gestes
   * rallumerait les marges devant le client si le mode ne tenait qu'en
   * mémoire.
   */
  const clientMode = (await searchParams).client === "1";

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

  const [
    { data: sections }, { data: lines }, { data: totals }, { data: revisions },
    { data: project }, { data: invoice }, catalog,
  ] = await Promise.all([
      supabase.from("quote_sections").select("*").eq("quote_id", id).order("position"),
      supabase.from("quote_lines").select("*").eq("quote_id", id).order("position"),
      supabase.from("quote_totals").select("*").eq("quote_id", id).maybeSingle(),
      supabase
        .from("quote_revisions")
        .select("id, label, total_excluding_vat_cents, created_at")
        .eq("quote_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("projects")
        .select("id, number")
        .eq("quote_id", id)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("id, number, status")
        .eq("quote_id", id)
        .is("archived_at", null)
        .neq("status", "cancelled")
        .maybeSingle(),
      listCatalog(),
    ]);

  const existingProject = project as { id: string; number: string } | null;
  const existingInvoice = invoice as { id: string; number: string | null; status: string } | null;

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
            href={clientMode ? `/devis/${id}` : `/devis/${id}?client=1`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              clientMode
                ? "bg-accent text-accent-ink"
                : "border border-line-strong text-ink-soft hover:border-accent hover:text-accent"
            }`}
          >
            {clientMode ? "Quitter le mode client" : "Mode présentation client"}
          </Link>
          <Link
            href={`/devis/${id}/imprimer`}
            target="_blank"
            className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent"
          >
            Imprimer / PDF
          </Link>
        </div>
      </div>

      {/* Un mode qui cache des chiffres doit SE VOIR, sans quoi on le
          laisse allumé et on croit sa marge tombée à zéro. La bande
          traverse l'écran et le bouton de sortie est à un clic. */}
      {clientMode && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-wash px-4 py-2.5">
          <p className="text-sm text-accent">
            <strong>Mode présentation client.</strong> Les coûts d&apos;achat, la marge
            et vos notes internes sont masqués — vous pouvez retourner l&apos;écran.
          </p>
          <Link
            href={`/devis/${id}`}
            className="shrink-0 text-sm font-medium text-accent underline"
          >
            Revenir à la vue de travail
          </Link>
        </div>
      )}

      {!clientMode && <StatusBar quote={quote} />}

      {/*
        §DEVIS ACCEPTÉ — « Bouton : Transformer en projet. »
        Réservé aux devis acceptés : proposer de lancer un chantier sur
        un brouillon inviterait à démarrer des travaux que le client n'a
        pas commandés.
      */}
      {/* Transformer en chantier, facturer : des gestes internes. Les
          montrer au client l'inviterait à se demander pourquoi on parle
          déjà de facture. */}
      {!clientMode && quote.status === "accepted" && (
        <>
          <ToProjectBar quoteId={quote.id} existingProject={existingProject} />
          {/*
            Le pont vers la facture manquait à l'écran : la fonction
            existait en base depuis le Milestone 10, sans bouton pour
            l'appeler.
          */}
          <ToInvoiceBar
            quoteId={quote.id}
            existingInvoice={existingInvoice}
            totalCents={(totals?.total_excluding_vat_cents as number) ?? 0}
            globalDiscountPercent={quote.global_discount_percent}
          />
        </>
      )}

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
        editable={clientMode ? false : editable}
        clientMode={clientMode}
      />

      {/* L'historique des versions raconte les allers-retours de
          chiffrage : ce n'est pas une information pour le client. */}
      {!clientMode && (revisions ?? []).length > 0 && (
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
