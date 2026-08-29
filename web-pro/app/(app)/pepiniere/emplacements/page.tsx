import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import {
  LOCATION_KIND_LABELS, formatCount,
  type NurseryLocation, type LocationKind,
} from "@/lib/nursery/types";
import { NewLocationForm } from "./NewLocationForm";
import { ArchiveButton } from "./ArchiveButton";

/**
 * §NURSERY DIGITAL TWIN — les emplacements.
 *
 * Hiérarchiques : site → serre → tunnel → rang → tablette. C'est ainsi
 * qu'une pépinière est organisée, et c'est ce qui permet de demander
 * « tout ce qui est dans la serre 2 ».
 *
 * L'occupation est COMPTÉE sur les lots présents, jamais stockée : une
 * occupation enregistrée se désynchroniserait au premier déplacement.
 */
export default async function LocationsPage() {
  const supabase = await createClient();

  const [{ data: locations }, { data: occupation }] = await Promise.all([
    supabase
      .from("nursery_locations")
      .select("id, parent_id, code, name, kind, surface_m2, capacity")
      .is("archived_at", null)
      .order("code"),
    supabase.from("nursery_location_occupation").select("*"),
  ]);

  const all = (locations ?? []) as NurseryLocation[];
  const occupancyById = new Map(
    (occupation ?? []).map((o) => [
      o.location_id as string,
      { occupied: o.occupied as number, percent: o.occupation_percent as number | null },
    ]),
  );

  // Les racines d'abord, puis leurs enfants : un arbre plat, indenté.
  const roots = all.filter((l) => l.parent_id === null);
  const childrenOf = (id: string) => all.filter((l) => l.parent_id === id);

  const rows: { location: NurseryLocation; depth: number }[] = [];
  const walk = (location: NurseryLocation, depth: number) => {
    rows.push({ location, depth });
    for (const child of childrenOf(location.id)) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // Un emplacement dont le parent a été archivé ne doit pas disparaître
  // de la liste : on le rattache à la racine plutôt que de le perdre.
  for (const orphan of all) {
    if (!rows.some((r) => r.location.id === orphan.id)) rows.push({ location: orphan, depth: 0 });
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Emplacements"
        subtitle={`${all.length} emplacement${all.length > 1 ? "s" : ""}`}
      />

      <NewLocationForm locations={all} />

      {rows.length === 0 ? (
        <EmptyState
          title="Aucun emplacement"
          description="Créez d'abord vos sites et vos serres, puis les rangs et tablettes qu'ils contiennent."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pl-4 pr-2 font-medium">Emplacement</th>
                <th className="w-32 px-2 py-2 font-medium">Type</th>
                <th className="w-20 px-2 py-2 text-right font-medium">Surface</th>
                <th className="w-24 px-2 py-2 text-right font-medium">Occupation</th>
                <th className="w-28 px-2 py-2 font-medium">Remplissage</th>
                <th className="w-8 py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ location, depth }) => {
                const o = occupancyById.get(location.id);
                const percent = o?.percent ?? null;
                return (
                  <tr key={location.id} className="border-b border-line last:border-0">
                    <td className="py-1.5 pl-4 pr-2" style={{ paddingLeft: `${16 + depth * 18}px` }}>
                      <span className="font-medium">{location.code}</span>
                      {location.name && location.name !== location.code && (
                        <span className="ml-1.5 text-ink-soft">{location.name}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-ink-soft">
                      {LOCATION_KIND_LABELS[location.kind as LocationKind]}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                      {location.surface_m2 ? `${location.surface_m2} m²` : "—"}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">
                      {formatCount(o?.occupied ?? 0)}
                      {location.capacity ? (
                        <span className="text-ink-faint"> / {formatCount(location.capacity)}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5">
                      {percent === null ? (
                        <span className="text-[11px] text-ink-faint">Sans capacité</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
                            <div
                              className={`h-full rounded-full ${percent > 100 ? "bg-critical" : "bg-accent"}`}
                              style={{ width: `${Math.min(100, percent)}%` }}
                            />
                          </div>
                          <span
                            className={`tabular text-[11px] ${percent > 100 ? "text-critical" : "text-ink-faint"}`}
                          >
                            {percent} %
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <ArchiveButton locationId={location.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
