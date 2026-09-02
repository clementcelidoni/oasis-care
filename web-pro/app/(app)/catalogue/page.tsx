import Link from "next/link";
import { PageHeader, Card, EmptyState, ConfirmDialog } from "@/components/ui";
import { listCatalog } from "@/lib/quotes/catalogActions";
import {
  CATALOG_ITEM_TYPES, CATALOG_ITEM_TYPE_LABELS, formatCents, formatPercent,
} from "@/lib/quotes/types";
import { NewItemForm } from "./NewItemForm";
import { archiveCatalogItem } from "@/lib/quotes/catalogActions";
import { PriceCell } from "./PriceCell";

/**
 * §11D — la bibliothèque de prix.
 *
 * Un article et son tarif en cours sur une même ligne, parce que c'est
 * ainsi qu'on les consulte. Les tarifs passés existent en base mais ne
 * sont pas montrés ici : ils servent à ne pas rechiffrer un vieux devis,
 * pas à être feuilletés.
 */
export default async function CatalogPage({ searchParams }: PageProps<"/catalogue">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const type = typeof params.type === "string" ? params.type : "";

  const items = await listCatalog(query || undefined, type || undefined);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Bibliothèque de prix"
        subtitle={`${items.length} article${items.length > 1 ? "s" : ""}`}
      />

      <form className="mb-3">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Rechercher un article, une référence…"
          className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
        {type && <input type="hidden" name="type" value={type} />}
      </form>

      <nav className="mb-4 flex flex-wrap gap-1.5">
        <TypeLink current={type} value="" label="Tous" q={query} />
        {CATALOG_ITEM_TYPES.map((t) => (
          <TypeLink key={t} current={type} value={t} label={CATALOG_ITEM_TYPE_LABELS[t]} q={query} />
        ))}
      </nav>

      <NewItemForm />

      {items.length === 0 ? (
        <EmptyState
          title={query || type ? "Aucun résultat" : "Bibliothèque vide"}
          description={
            query || type
              ? "Essayez un autre terme, ou changez de catégorie."
              : "Ajoutez vos articles courants : un prix saisi ici se retrouve dans tous vos devis."
          }
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-2 pl-4 pr-2 font-medium">Article</th>
                  <th className="w-24 px-2 py-2 font-medium">Catégorie</th>
                  <th className="w-14 px-2 py-2 font-medium">Unité</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Achat</th>
                  <th className="w-28 px-2 py-2 text-right font-medium">Vente HT</th>
                  <th className="w-16 px-2 py-2 text-right font-medium">TVA</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Marque</th>
                  <th className="w-10 py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const margin =
                    item.sale_price_cents && item.sale_price_cents > 0
                      ? ((item.sale_price_cents - (item.purchase_price_cents ?? 0)) /
                          item.sale_price_cents) * 100
                      : null;
                  return (
                    <tr key={item.id} className="border-b border-line last:border-0">
                      <td className="py-1.5 pl-4 pr-2">
                        <span className="font-medium">{item.name}</span>
                        {item.reference && (
                          <span className="ml-1.5 text-xs text-ink-faint">{item.reference}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-ink-soft">
                        {CATALOG_ITEM_TYPE_LABELS[item.item_type]}
                      </td>
                      <td className="px-2 py-1.5 text-ink-soft">{item.unit}</td>
                      <td colSpan={3} className="px-2 py-1">
                        <PriceCell item={item} />
                      </td>
                      <td
                        className={`tabular px-2 py-1.5 text-right ${
                          margin !== null && margin < 0 ? "text-critical" : "text-ink-soft"
                        }`}
                      >
                        {item.sale_price_cents === null ? "—" : formatPercent(margin)}
                      </td>
                      {/* RETIRER UN ARTICLE — l'action existait depuis le
                          Milestone 5, sans aucun bouton pour l'appeler :
                          un article entré par erreur restait dans la
                          bibliothèque pour toujours.

                          Elle ARCHIVE, elle ne supprime pas. Les devis
                          qui citent cet article gardent leur référence,
                          et leurs montants ne bougent pas — ils sont
                          photographiés sur la ligne au moment du
                          chiffrage. */}
                      <td className="py-1.5 pr-4 text-right">
                        <ConfirmDialog
                          triggerLabel="✕"
                          triggerVariant="ghost"
                          title={`Retirer « ${item.name} » ?`}
                          message="L'article disparaît de la bibliothèque de prix. Les devis qui le citent déjà ne changent pas : leurs montants ont été enregistrés au moment du chiffrage."
                          confirmLabel="Retirer de la bibliothèque"
                          action={archiveCatalogItem}
                          hidden={{ catalog_item_id: item.id }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        Modifier un prix n&apos;écrase pas l&apos;ancien : la période en cours est close et une
        nouvelle s&apos;ouvre. Les devis déjà rédigés gardent le prix du jour où ils ont été
        établis. Total du catalogue vendu :{" "}
        {formatCents(items.reduce((s, i) => s + (i.sale_price_cents ?? 0), 0))} — indicatif.
      </p>
    </div>
  );
}

function TypeLink({
  current, value, label, q,
}: { current: string; value: string; label: string; q: string }) {
  const active = current === value;
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  if (value) search.set("type", value);
  const href = search.toString() ? `/catalogue?${search}` : "/catalogue";

  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        active ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"
      }`}
    >
      {label}
    </Link>
  );
}
