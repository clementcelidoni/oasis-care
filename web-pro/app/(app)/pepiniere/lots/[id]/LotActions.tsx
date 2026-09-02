"use client";

import { useState } from "react";
import {
  recordMovement, splitLot, recordRepotting, recordInspection, createReservation,
} from "@/lib/nursery/actions";
import {
  MOVEMENT_KINDS, MOVEMENT_KIND_LABELS, MOVEMENTS_WITHOUT_QUANTITY,
  INSPECTION_RESULTS, INSPECTION_RESULT_LABELS, availableOf,
  type NurseryLot, type NurseryLocation, type MovementKind,
} from "@/lib/nursery/types";

type Tab = "movement" | "reserve" | "split" | "repot" | "inspect";

const TAB_LABELS: Record<Tab, string> = {
  movement: "Mouvement",
  reserve: "Réserver",
  split: "Scinder",
  repot: "Rempoter",
  inspect: "Inspecter",
};

/**
 * Les gestes possibles sur un lot, en onglets.
 *
 * Cinq formulaires empilés rendraient la fiche illisible, et un menu
 * cacherait ce qu'on peut faire. Les onglets montrent les possibilités
 * sans les afficher toutes.
 */
export function LotActions({
  lot, locations, customers,
}: {
  lot: NurseryLot;
  locations: NurseryLocation[];
  customers: { id: string; display_name: string }[];
}) {
  const [tab, setTab] = useState<Tab>("movement");
  const [kind, setKind] = useState<MovementKind>("receive");
  const available = availableOf(lot);

  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-line bg-surface">
      <nav className="flex flex-wrap gap-1 border-b border-line bg-canvas px-2 py-1.5">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              tab === t ? "bg-accent-wash text-accent" : "text-ink-soft hover:bg-surface"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      <div className="px-4 py-3">
        {tab === "movement" && (
          <form action={recordMovement} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="lot_id" value={lot.id} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Type</span>
              <select
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as MovementKind)}
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                {MOVEMENT_KINDS.filter((k) => k !== "split").map((k) => (
                  <option key={k} value={k}>{MOVEMENT_KIND_LABELS[k]}</option>
                ))}
              </select>
            </label>

            {/*
              Mettre en quarantaine ou déplacer ne change pas le nombre :
              demander une quantité inviterait à en saisir une, et elle
              serait ignorée. Pire qu'un champ absent.
            */}
            {!MOVEMENTS_WITHOUT_QUANTITY.includes(kind) && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-faint">
                  {kind === "adjustment" ? "Quantité comptée" : "Quantité"}
                </span>
                <input
                  name="quantity"
                  defaultValue="0"
                  className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
                />
              </label>
            )}

            {(kind === "move" || kind === "quarantine" || kind === "release") && (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-ink-faint">Vers</span>
                <select
                  name="to_location_id"
                  defaultValue=""
                  className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
                >
                  <option value="">Ne pas déplacer</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex min-w-40 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Motif</span>
              <input
                name="reason"
                placeholder="Pourquoi ce mouvement"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>

            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              Enregistrer
            </button>

            {kind === "adjustment" && (
              <p className="w-full text-[11px] text-ink-faint">
                Un inventaire remplace la quantité connue par celle que vous avez comptée.
                L&apos;écart reste visible dans le journal.
              </p>
            )}
          </form>
        )}

        {tab === "reserve" && (
          <form action={createReservation} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="lot_id" value={lot.id} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Quantité</span>
              <input
                name="quantity"
                defaultValue="1"
                className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Pour</span>
              <select
                name="customer_id"
                defaultValue=""
                className="max-w-48 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                <option value="">Client non précisé</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.display_name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Jusqu&apos;au</span>
              <input
                type="date"
                name="expires_on"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="flex min-w-32 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Note</span>
              <input
                name="notes"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={available === 0}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-40"
            >
              Réserver
            </button>
            <p className="w-full text-[11px] text-ink-faint">
              {available === 0
                ? "Rien de disponible à réserver sur ce lot."
                : `${available} disponibles. Réserver ne fait pas sortir les plantes : le physique ne bougera qu'à la vente.`}
            </p>
          </form>
        )}

        {tab === "split" && (
          <form action={splitLot} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="lot_id" value={lot.id} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Quantité détachée</span>
              <input
                name="quantity"
                defaultValue="1"
                className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Code du nouveau lot</span>
              <input
                name="new_lot_code"
                required
                defaultValue={`${lot.lot_code}-B`}
                className="w-40 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Emplacement</span>
              <select
                name="to_location_id"
                defaultValue=""
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                <option value="">Le même</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              Scinder
            </button>
            <p className="w-full text-[11px] text-ink-faint">
              Le nouveau lot garde la filiation vers celui-ci, donc la traçabilité remonte
              jusqu&apos;au bordereau du fournisseur.
              {lot.reserved_quantity > 0 && (
                <> Les {lot.reserved_quantity} unités réservées doivent être libérées d&apos;abord.</>
              )}
            </p>
          </form>
        )}

        {tab === "repot" && (
          <form action={recordRepotting} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="lot_id" value={lot.id} />
            <input type="hidden" name="from_container" value={lot.container_size ?? ""} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Vers</span>
              <input
                name="to_container"
                required
                placeholder="C10"
                className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Quantité</span>
              <input
                name="quantity"
                defaultValue={String(lot.current_quantity)}
                className="w-20 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Pertes</span>
              <input
                name="losses"
                defaultValue="0"
                className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Substrat</span>
              <input
                name="substrate"
                className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Heures</span>
              <input
                name="labor_hours"
                className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-sm tabular outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              Enregistrer
            </button>
            <p className="w-full text-[11px] text-ink-faint">
              Les pertes sortent réellement du stock, par un mouvement à part. Le contenant du
              lot devient celui indiqué.
            </p>
          </form>
        )}

        {tab === "inspect" && (
          <form action={recordInspection} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="lot_id" value={lot.id} />
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Résultat</span>
              <select
                name="result"
                defaultValue="healthy"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
              >
                {INSPECTION_RESULTS.map((r) => (
                  <option key={r} value={r}>{INSPECTION_RESULT_LABELS[r]}</option>
                ))}
              </select>
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Constat</span>
              <input
                name="findings"
                placeholder="Ce qui a été observé"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <label className="flex min-w-32 flex-1 flex-col gap-1">
              <span className="text-[11px] text-ink-faint">Action</span>
              <input
                name="action_taken"
                placeholder="Ce qui a été fait"
                className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
            >
              Enregistrer
            </button>
            <p className="w-full text-[11px] text-ink-faint">
              L&apos;inspection ne change pas l&apos;état du lot : si le constat impose une
              quarantaine, enregistrez-la comme mouvement.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
