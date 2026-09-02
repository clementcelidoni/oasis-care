import { formatCount, type StockRow } from "@/lib/nursery/types";

/**
 * §40 NURSERY UX — « graphiques ».
 *
 * Un graphique, pas une bibliothèque : ces barres sont des `div`
 * larges d'un pourcentage. Une dépendance de traçage pèserait plus que
 * tout le module pour dessiner huit rectangles.
 *
 * CE QUE LA BARRE DIT, ET CE QU'ELLE NE DIT PAS. Sa longueur est le
 * stock PHYSIQUE de l'espèce, rapporté à l'espèce la plus nombreuse.
 * Elle se découpe en trois parts qui ne se recouvrent jamais :
 * disponible (vendable aujourd'hui), quarantaine (présent, interdit de
 * vente) et le reste (en production, bloqué, réservé sur un lot non
 * vendable…). On ne trace PAS le réservé comme une part : le réservé se
 * compte sur tous les lots, y compris ceux qui ne sont pas en vente, et
 * il chevaucherait les autres — une barre dont les morceaux dépassent le
 * total est pire qu'une absence de barre.
 */
export function RepartitionEspeces({ rows }: { rows: StockRow[] }) {
  // Les espèces qui pèsent, et elles seules : au-delà d'une dizaine de
  // barres, on ne compare plus rien, on fait défiler.
  const espèces = [...rows]
    .filter((row) => row.physical > 0)
    .sort((a, b) => b.physical - a.physical)
    .slice(0, 8);

  if (espèces.length === 0) return null;

  const maximum = espèces[0].physical;

  return (
    <div className="flex flex-col gap-3.5 px-5 py-5">
      {espèces.map((row) => {
        // Le « reste » ne peut pas être négatif : disponible et
        // quarantaine portent chacun sur des lots distincts, tous deux
        // inclus dans le physique.
        const reste = Math.max(0, row.physical - row.available - row.quarantine);
        const part = (valeur: number) => `${(valeur / maximum) * 100}%`;

        return (
          <div key={row.species_name}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[var(--text-body)]">{row.species_name}</span>
              <span className="tabular shrink-0 text-[var(--text-secondary)] text-ink-soft">
                <strong className="font-medium text-ink">{formatCount(row.available)}</strong>{" "}
                vendables sur {formatCount(row.physical)}
              </span>
            </div>

            <div
              className="flex h-2.5 gap-px overflow-hidden rounded-[var(--radius-pill)] bg-surface-sunken"
              role="img"
              aria-label={`${row.species_name} : ${row.available} vendables, ${row.quarantine} en quarantaine, ${row.physical} au total`}
            >
              <span className="bg-positive" style={{ width: part(row.available) }} />
              <span className="bg-critical" style={{ width: part(row.quarantine) }} />
              <span className="bg-line-strong" style={{ width: part(reste) }} />
            </div>
          </div>
        );
      })}

      {/* §47 — la couleur ne porte jamais seule une information : la
          légende la double par un mot. */}
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--text-secondary)] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-positive" /> Disponible
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-critical" /> Quarantaine
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-line-strong" /> Production, blocage,
          réservé
        </span>
      </p>
    </div>
  );
}
