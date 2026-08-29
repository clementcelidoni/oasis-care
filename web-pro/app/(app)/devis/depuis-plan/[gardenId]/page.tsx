import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadTwin } from "@/lib/twin/actions";
import { computeQuantities } from "@/lib/twin/quantities";
import { proposeQuoteLines } from "@/lib/quotes/fromTwin";
import { QUOTE_STATUS_LABELS, isEditable, type QuoteStatus } from "@/lib/quotes/types";
import { ProposalForm } from "./ProposalForm";

/**
 * §"DIGITAL TWIN → DEVIS" — l'écran de relecture.
 *
 * Entre le plan et le devis il y a cette page, et elle est obligatoire.
 * « NE PAS ajouter silencieusement des coûts » : chaque ligne est
 * cochable, sa quantité modifiable, et son origine écrite en clair
 * dessous. Rien n'est écrit avant le bouton du bas.
 */
export default async function FromPlanPage({ params }: PageProps<"/devis/depuis-plan/[gardenId]">) {
  const { gardenId } = await params;

  const twin = await loadTwin(gardenId);
  if (!twin) notFound();

  const report = computeQuantities({
    boundaryPoints: twin.boundary?.points ?? [],
    areas: twin.areas,
    objects: twin.objects,
    pipes: twin.pipes,
    cables: twin.cables,
  });
  const proposed = proposeQuoteLines(report);

  const supabase = await createClient();
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id, number, title, status")
    .is("archived_at", null)
    .in("status", ["draft", "internalReview"])
    .order("created_at", { ascending: false })
    .limit(50);

  const openQuotes = ((quotes ?? []) as { id: string; number: string; title: string; status: QuoteStatus }[])
    .filter((q) => isEditable(q.status))
    .map((q) => ({
      id: q.id,
      label: `${q.number} — ${q.title || "Sans objet"} (${QUOTE_STATUS_LABELS[q.status].toLowerCase()})`,
    }));

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href={`/digital-twin/${gardenId}`} className="hover:text-ink">
          {twin.gardenName}
        </Link>
        <span>/</span>
        <span>Métré vers devis</span>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">Verser le métré dans un devis</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        Ces lignes sont <strong>proposées</strong> d&apos;après ce qui est dessiné sur le plan.
        Décochez ce qui ne vous convient pas, corrigez les quantités, puis validez. Rien
        n&apos;est ajouté à votre devis avant.
      </p>

      {proposed.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-soft">
          Il n&apos;y a rien de mesurable sur ce plan. Tracez des zones, un réseau, ou placez
          des végétaux, puis revenez.
        </p>
      ) : openQuotes.length === 0 ? (
        <div className="mt-6 rounded-lg border border-line bg-surface px-4 py-6 text-center">
          <p className="text-sm">
            Aucun devis modifiable pour l&apos;instant. Créez-en un, puis revenez ici.
          </p>
          <Link
            href="/devis"
            className="mt-3 inline-block rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
          >
            Aller aux devis
          </Link>
        </div>
      ) : (
        <ProposalForm gardenId={gardenId} lines={proposed} quotes={openQuotes} />
      )}
    </div>
  );
}
