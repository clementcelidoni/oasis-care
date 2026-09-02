"use client";

import { setCatalogPrice } from "@/lib/quotes/catalogActions";
import { centsToInput, VAT_RATES, type CatalogItem } from "@/lib/quotes/types";

/**
 * Les trois champs de prix d'un article, enregistrés ensemble.
 *
 * Ensemble et non séparément : passer par `set_price_book_price` ouvre
 * une nouvelle période tarifaire à chaque appel. Trois enregistrements
 * indépendants créeraient trois périodes le même jour pour une seule
 * modification, et l'historique deviendrait illisible.
 */
export function PriceCell({ item }: { item: CatalogItem }) {
  return (
    <form
      action={setCatalogPrice}
      className="flex items-center gap-1"
      onBlur={(e) => {
        // Ne soumet que si le focus quitte réellement le formulaire, et
        // pas en passant d'un champ à l'autre.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          e.currentTarget.requestSubmit();
        }
      }}
    >
      <input type="hidden" name="catalog_item_id" value={item.id} />
      <input
        name="purchase_price"
        defaultValue={centsToInput(item.purchase_price_cents)}
        placeholder="—"
        title="Prix d'achat HT"
        className="w-24 rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm tabular outline-none hover:border-line focus:border-accent focus:bg-surface"
      />
      <input
        name="sale_price"
        defaultValue={centsToInput(item.sale_price_cents)}
        placeholder="—"
        title="Prix de vente HT"
        className="w-24 rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm tabular outline-none hover:border-line focus:border-accent focus:bg-surface"
      />
      <select
        name="vat_rate"
        defaultValue={String(item.vat_rate ?? 20)}
        title="Taux de TVA"
        className="w-16 rounded border border-transparent bg-transparent px-1 py-1 text-right text-sm tabular outline-none hover:border-line focus:border-accent focus:bg-surface"
      >
        {VAT_RATES.map((r) => (
          <option key={r} value={r}>{r} %</option>
        ))}
      </select>
    </form>
  );
}
