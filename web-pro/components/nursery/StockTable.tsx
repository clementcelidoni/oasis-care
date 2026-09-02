import { formatCount, type StockRow } from "@/lib/nursery/types";

/**
 * §STOCK VIVANT — « Ne pas confondre stock physique et disponible à
 * vendre. » Les deux colonnes sont côte à côte et nommées sans
 * ambiguïté ; c'est le seul moyen de ne pas les confondre à la lecture.
 */
export function StockTable({ rows }: { rows: StockRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <th className="py-2 pl-4 pr-2 font-medium">Espèce</th>
            <th className="w-24 px-2 py-2 text-right font-medium">Physique</th>
            <th className="w-24 px-2 py-2 text-right font-medium">Disponible</th>
            <th className="w-24 px-2 py-2 text-right font-medium">Réservé</th>
            <th className="w-24 px-2 py-2 text-right font-medium">Quarantaine</th>
            <th className="w-28 px-2 py-2 text-right font-medium">En production</th>
            <th className="w-24 py-2 pr-4 text-right font-medium">Attendu</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.species_name} className="border-b border-line last:border-0">
              <td className="py-1.5 pl-4 pr-2">{row.species_name}</td>
              <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                {formatCount(row.physical)}
              </td>
              <td className="tabular px-2 py-1.5 text-right font-medium">
                {formatCount(row.available)}
              </td>
              <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                {row.reserved > 0 ? formatCount(row.reserved) : "—"}
              </td>
              <td className={`tabular px-2 py-1.5 text-right ${row.quarantine > 0 ? "text-critical" : "text-ink-faint"}`}>
                {row.quarantine > 0 ? formatCount(row.quarantine) : "—"}
              </td>
              <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                {row.in_production > 0 ? formatCount(row.in_production) : "—"}
              </td>
              {/* « Attendu » n'est pas du stock : c'est une promesse de
                  fournisseur. Teinté différemment pour qu'on ne le
                  confonde pas avec du disponible en lisant vite. */}
              <td className="tabular py-1.5 pr-4 text-right text-info">
                {row.expected > 0 ? formatCount(row.expected) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
