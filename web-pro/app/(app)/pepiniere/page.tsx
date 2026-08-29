import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui";
import { ensureStages } from "@/lib/nursery/actions";
import {
  LOT_STATUSES, LOT_STATUS_LABELS, LOT_STATUS_TONE, formatCount, availableOf,
  type NurseryLot, type StockRow,
} from "@/lib/nursery/types";
import { NewLotForm } from "./NewLotForm";
import { StockTable } from "@/components/nursery/StockTable";

/**
 * §11I — le tableau de bord de la pépinière.
 *
 * En tête, le stock vivant par espèce ; en dessous, les lots. C'est
 * l'ordre dans lequel on se pose les questions : « combien de
 * Trachycarpus puis-je vendre » vient avant « dans quel lot sont-ils ».
 */
export default async function NurseryPage({ searchParams }: PageProps<"/pepiniere">) {
  const params = await searchParams;
  const status = typeof params.statut === "string" ? params.statut : "";
  const query = typeof params.q === "string" ? params.q.trim() : "";

  // Les étapes de production à la première visite — voir `ensureStages`.
  await ensureStages();

  const supabase = await createClient();

  let request = supabase
    .from("nursery_lots")
    .select("*, nursery_locations ( code, name )")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  if (status) request = request.eq("status", status);
  if (query) {
    const safe = query.replace(/[%,()]/g, " ");
    request = request.or(`lot_code.ilike.%${safe}%,species_name.ilike.%${safe}%`);
  }

  const [{ data: lots, error }, { data: stock }, { data: locations }, { data: stages }] =
    await Promise.all([
      request,
      supabase.from("nursery_stock").select("*").order("species_name"),
      supabase.from("nursery_locations").select("id, code, name").is("archived_at", null).order("code"),
      supabase.from("nursery_stages").select("id, code, label").order("position"),
    ]);

  const rows = (lots ?? []) as unknown as (NurseryLot & {
    nursery_locations: { code: string; name: string } | null;
  })[];
  const stockRows = (stock ?? []) as StockRow[];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Pépinière"
        subtitle={`${rows.length} lot${rows.length > 1 ? "s" : ""}`}
        action={
          <NewLotForm
            locations={(locations ?? []) as { id: string; code: string; name: string }[]}
            stages={(stages ?? []) as { id: string; code: string; label: string }[]}
          />
        }
      />

      {stockRows.length > 0 && (
        <section className="mb-6">
          <div className="mb-1.5 flex items-baseline justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Stock vivant
            </h2>
            <Link href="/pepiniere/stock" className="text-xs text-ink-faint hover:text-accent">
              Tout voir
            </Link>
          </div>
          <StockTable rows={stockRows.slice(0, 6)} />
        </section>
      )}

      <nav className="mb-4 flex flex-wrap gap-1.5">
        <FilterLink current={status} value="" label="Tous" q={query} />
        {LOT_STATUSES.map((s) => (
          <FilterLink key={s} current={status} value={s} label={LOT_STATUS_LABELS[s]} q={query} />
        ))}
      </nav>

      <form className="mb-4">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Rechercher un code de lot, une espèce…"
          className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
        {status && <input type="hidden" name="statut" value={status} />}
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
          {error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={status || query ? "Aucun lot ne correspond" : "Aucun lot pour l'instant"}
          description={
            status || query
              ? "Changez de filtre ou de terme de recherche."
              : "Créez votre premier lot. Sa quantité entrera par un mouvement de réception, pour que son journal commence par son origine."
          }
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-2 pl-4 pr-2 font-medium">Lot</th>
                  <th className="px-2 py-2 font-medium">Espèce</th>
                  <th className="w-20 px-2 py-2 font-medium">Contenant</th>
                  <th className="w-24 px-2 py-2 font-medium">Emplacement</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Physique</th>
                  <th className="w-20 px-2 py-2 text-right font-medium">Réservé</th>
                  <th className="w-24 px-2 py-2 text-right font-medium">Disponible</th>
                  <th className="w-28 py-2 pr-4 font-medium">État</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lot) => (
                  <tr key={lot.id} className="border-b border-line last:border-0 hover:bg-canvas">
                    <td className="py-1.5 pl-4 pr-2">
                      <Link href={`/pepiniere/lots/${lot.id}`} className="font-medium hover:text-accent">
                        {lot.lot_code}
                      </Link>
                    </td>
                    <td className="px-2 py-1.5">
                      {lot.species_name}
                      {lot.cultivar && <span className="text-ink-faint"> ‘{lot.cultivar}’</span>}
                    </td>
                    <td className="px-2 py-1.5 text-ink-soft">{lot.container_size ?? "—"}</td>
                    <td className="px-2 py-1.5 text-ink-soft">
                      {lot.nursery_locations?.code ?? "—"}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {formatCount(lot.current_quantity)}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                      {lot.reserved_quantity > 0 ? formatCount(lot.reserved_quantity) : "—"}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right font-medium">
                      {formatCount(availableOf(lot))}
                    </td>
                    <td className="py-1.5 pr-4">
                      <Badge tone={LOT_STATUS_TONE[lot.status]}>
                        {LOT_STATUS_LABELS[lot.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function FilterLink({
  current, value, label, q,
}: { current: string; value: string; label: string; q: string }) {
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  if (value) search.set("statut", value);
  const href = search.toString() ? `/pepiniere?${search}` : "/pepiniere";

  return (
    <Link
      href={href}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        current === value ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-canvas"
      }`}
    >
      {label}
    </Link>
  );
}
