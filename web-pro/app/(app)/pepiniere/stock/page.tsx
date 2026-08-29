import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { StockTable } from "@/components/nursery/StockTable";
import { type StockRow } from "@/lib/nursery/types";

/**
 * §STOCK VIVANT — `NurseryInventoryService`.
 *
 * « Afficher : Physical, Available, Reserved, Quarantine, In
 * Production, Expected. » Cinq des six sont là. « Attendu » — ce qui est
 * commandé au fournisseur mais pas encore reçu — vient des commandes
 * d'achat, au Milestone 9 : afficher une colonne à zéro se lirait « rien
 * n'arrive », ce qui n'est pas « on ne sait pas encore ».
 */
export default async function StockPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("nursery_stock").select("*").order("species_name");
  const rows = (data ?? []) as StockRow[];

  const totals = rows.reduce(
    (acc, r) => ({
      physical: acc.physical + r.physical,
      available: acc.available + r.available,
      reserved: acc.reserved + r.reserved,
    }),
    { physical: 0, available: 0, reserved: 0 },
  );

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Stock vivant"
        subtitle={`${rows.length} espèce${rows.length > 1 ? "s" : ""} · ${totals.physical} plantes, dont ${totals.available} vendables`}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Aucun stock"
          description="Le stock se remplit à mesure que vous créez des lots et enregistrez leurs mouvements."
        />
      ) : (
        <StockTable rows={rows} />
      )}

      <p className="mt-4 text-xs text-ink-faint">
        <strong>Physique</strong> : ce qui est sur place, quarantaine comprise.{" "}
        <strong>Disponible</strong> : ce qui est vendable aujourd&apos;hui, une fois retiré ce
        qui est réservé et ce qui n&apos;est pas en vente. Les confondre, c&apos;est soit
        vendre deux fois la même plante, soit refuser une commande qu&apos;on pouvait honorer.
      </p>
      <p className="mt-2 text-xs text-ink-faint">
        La colonne « Attendu » — commandé mais pas encore reçu — arrivera avec les commandes
        fournisseurs.
      </p>
    </div>
  );
}
