import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import {
  LOT_STATUS_LABELS, LOT_STATUS_TONE, MOVEMENT_KIND_LABELS,
  INSPECTION_RESULT_LABELS, INSPECTION_RESULT_TONE,
  formatCount, availableOf,
  type NurseryLot, type NurseryLocation, type Movement,
  type MovementKind, type InspectionResult,
} from "@/lib/nursery/types";
import { LotActions } from "./LotActions";
import { LotHeader } from "./LotHeader";
import { ReleaseButton } from "./ReleaseButton";

/**
 * §11I — la fiche d'un lot.
 *
 * Les trois quantités en tête, parce que les confondre est l'erreur que
 * ce module existe pour empêcher : ce qu'on a, ce qui est promis, ce
 * qu'on peut encore vendre.
 */
export default async function LotPage({ params }: PageProps<"/pepiniere/lots/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("nursery_lots")
    .select("*, nursery_locations ( id, code, name ), suppliers ( name )")
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const lot = data as NurseryLot & {
    nursery_locations: { id: string; code: string; name: string } | null;
    suppliers: { name: string } | null;
  };

  const [
    { data: movements }, { data: locations }, { data: reservations },
    { data: inspections }, { data: repottings }, { data: customers }, { data: stages },
    { data: parent },
  ] = await Promise.all([
    supabase
      .from("nursery_stock_movements")
      .select("id, kind, quantity, reason, occurred_at, to_location_id")
      .eq("lot_id", id)
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("nursery_locations")
      .select("id, parent_id, code, name, kind, surface_m2, capacity")
      .is("archived_at", null)
      .order("code"),
    supabase
      .from("nursery_reservations")
      .select("id, quantity, status, expires_on, notes, crm_customers ( display_name )")
      .eq("lot_id", id)
      .eq("status", "active"),
    supabase
      .from("nursery_inspections")
      .select("id, inspected_on, result, findings, action_taken")
      .eq("lot_id", id)
      .order("inspected_on", { ascending: false })
      .limit(20),
    supabase
      .from("repotting_events")
      .select("id, from_container, to_container, quantity, substrate, losses, occurred_on")
      .eq("lot_id", id)
      .order("occurred_on", { ascending: false })
      .limit(20),
    supabase.from("crm_customers").select("id, display_name").is("archived_at", null).order("display_name"),
    supabase.from("nursery_stages").select("id, code, label").order("position"),
    lot.parent_lot_id
      ? supabase.from("nursery_lots").select("id, lot_code").eq("id", lot.parent_lot_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const activeReservations = (reservations ?? []) as unknown as {
    id: string; quantity: number; status: string; expires_on: string | null;
    notes: string | null; crm_customers: { display_name: string } | null;
  }[];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-1 flex items-center gap-2 text-sm text-ink-faint">
        <Link href="/pepiniere" className="hover:text-ink">Pépinière</Link>
        <span>/</span>
        <span className="tabular">{lot.lot_code}</span>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {lot.species_name}
            {lot.cultivar && <span className="text-ink-soft"> ‘{lot.cultivar}’</span>}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {[
              lot.container_size,
              lot.nursery_locations ? `${lot.nursery_locations.code} — ${lot.nursery_locations.name}` : null,
              lot.suppliers?.name,
              lot.supplier_lot_reference ? `lot fournisseur ${lot.supplier_lot_reference}` : null,
            ].filter(Boolean).join(" · ")}
          </p>
          {parent && (
            <p className="mt-1 text-sm text-ink-soft">
              Détaché du lot{" "}
              <Link href={`/pepiniere/lots/${parent.id}`} className="hover:text-ink">
                {parent.lot_code}
              </Link>
            </p>
          )}
        </div>
        <Badge tone={LOT_STATUS_TONE[lot.status]}>{LOT_STATUS_LABELS[lot.status]}</Badge>
      </div>

      {/*
        §"Ne pas confondre stock physique et disponible à vendre." Les
        trois nombres côte à côte, nommés sans ambiguïté.
      */}
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Figure label="Physique" value={lot.current_quantity} hint="Ce qui est sur place" />
        <Figure label="Réservé" value={lot.reserved_quantity} hint="Promis à quelqu'un" muted />
        <Figure
          label="Disponible"
          value={availableOf(lot)}
          hint={lot.status === "available" ? "Vendable aujourd'hui" : `Rien de vendable : lot ${LOT_STATUS_LABELS[lot.status].toLowerCase()}`}
          strong
        />
      </section>

      <LotHeader lot={lot} stages={(stages ?? []) as { id: string; label: string }[]} />

      <LotActions
        lot={lot}
        locations={(locations ?? []) as NurseryLocation[]}
        customers={(customers ?? []) as { id: string; display_name: string }[]}
      />

      {activeReservations.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Réservations en cours
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {activeReservations.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  <strong className="tabular">{formatCount(r.quantity)}</strong>{" "}
                  pour {r.crm_customers?.display_name ?? "un client non précisé"}
                  {r.expires_on && (
                    <span className="text-ink-faint"> · jusqu&apos;au {formatDate(r.expires_on)}</span>
                  )}
                </span>
                <ReleaseButton reservationId={r.id} lotId={id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(inspections ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Inspections
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {(inspections ?? []).map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                <span className="w-24 shrink-0 tabular text-xs text-ink-faint">
                  {formatDate(i.inspected_on)}
                </span>
                <Badge tone={INSPECTION_RESULT_TONE[i.result as InspectionResult]}>
                  {INSPECTION_RESULT_LABELS[i.result as InspectionResult]}
                </Badge>
                <span className="min-w-0 flex-1">
                  {i.findings}
                  {i.action_taken && (
                    <span className="block text-[11px] text-ink-faint">{i.action_taken}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(repottings ?? []).length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Rempotages
          </h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {(repottings ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-24 shrink-0 tabular text-xs text-ink-faint">
                  {formatDate(r.occurred_on)}
                </span>
                <span className="min-w-0 flex-1">
                  {r.from_container ? `${r.from_container} → ` : ""}{r.to_container}
                  {r.substrate && <span className="text-ink-faint"> · {r.substrate}</span>}
                </span>
                <span className="tabular text-xs text-ink-soft">
                  {formatCount(r.quantity)}
                  {r.losses > 0 && <span className="text-critical"> · {r.losses} perdus</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Journal des mouvements
        </h2>
        {(movements ?? []).length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-soft">
            Aucun mouvement.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {((movements ?? []) as Movement[]).map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-1.5 text-sm">
                <span className="w-28 shrink-0 tabular text-xs text-ink-faint">
                  {formatDate(m.occurred_at)}
                </span>
                <span className="w-40 shrink-0">
                  {MOVEMENT_KIND_LABELS[m.kind as MovementKind] ?? m.kind}
                </span>
                <span className="w-16 shrink-0 tabular text-right">
                  {m.quantity > 0 ? formatCount(m.quantity) : ""}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-soft">{m.reason ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-ink-faint">
          Le journal ne se modifie pas. Une erreur se corrige par un mouvement
          d&apos;inventaire, qui laisse la trace de la correction.
        </p>
      </section>
    </div>
  );
}

function Figure({
  label, value, hint, strong, muted,
}: {
  label: string;
  value: number;
  hint: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
      <p
        className={`mt-1 tabular ${strong ? "text-2xl font-semibold" : "text-xl font-medium"} ${
          muted ? "text-ink-soft" : ""
        }`}
      >
        {formatCount(value)}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>
    </div>
  );
}
