import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { StockTable } from "@/components/nursery/StockTable";
import { type StockRow } from "@/lib/nursery/types";

/**
 * §STOCK VIVANT — `NurseryInventoryService`.
 *
 * « Afficher : Physical, Available, Reserved, Quarantine, In
 * Production, Expected. » Les six y sont.
 *
 * « Attendu » manquait au Milestone 8, faute de commandes fournisseurs :
 * une colonne à zéro se serait lue « rien n'arrive », ce qui n'est pas
 * « on ne sait pas encore ». Le Milestone 9 a livré les commandes et la
 * vue `nursery_stock` rend la colonne depuis — mais l'écran a continué
 * d'annoncer qu'elle arriverait, pendant deux jalons.
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
      expected: acc.expected + (r.expected ?? 0),
    }),
    { physical: 0, available: 0, reserved: 0, expected: 0 },
  );

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Stock vivant"
        subtitle={`${rows.length} espèce${rows.length > 1 ? "s" : ""} · ${totals.physical} plantes, dont ${totals.available} vendables${totals.expected > 0 ? ` · ${totals.expected} attendues` : ""}`}
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
        « Attendu » compte ce qui est commandé au fournisseur et pas encore reçu. Ce n&apos;est
        pas du stock : on ne peut pas le vendre, mais on peut compter dessus pour honorer une
        commande à date.
      </p>
    </div>
  );
}
