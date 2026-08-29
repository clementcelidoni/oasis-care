"use client";

import { updateIntervention } from "@/lib/field/actions";
import {
  INTERVENTION_KINDS, INTERVENTION_KIND_LABELS,
  INTERVENTION_STATUSES, INTERVENTION_STATUS_LABELS,
  type Intervention, type Team,
} from "@/lib/field/types";

/** Ce qui se règle avant de partir : quand, avec qui, pour quoi faire. */
export function InterventionHeader({
  intervention, teams,
}: {
  intervention: Intervention;
  teams: Team[];
}) {
  // `datetime-local` veut « AAAA-MM-JJTHH:MM » en heure locale, pas
  // l'ISO UTC que renvoie Postgres. Sans cette conversion le champ
  // reste vide, et l'utilisateur croit l'horaire perdu.
  const toLocalInput = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <form
      action={updateIntervention}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface px-4 py-3"
    >
      <input type="hidden" name="intervention_id" value={intervention.id} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">État</span>
        <select
          name="status"
          defaultValue={intervention.status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {INTERVENTION_STATUSES.map((s) => (
            <option key={s} value={s}>{INTERVENTION_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Type</span>
        <select
          name="kind"
          defaultValue={intervention.kind}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          {INTERVENTION_KINDS.map((k) => (
            <option key={k} value={k}>{INTERVENTION_KIND_LABELS[k]}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Équipe</span>
        <select
          name="team_id"
          defaultValue={intervention.team_id ?? ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        >
          <option value="">Sans équipe</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Début</span>
        <input
          type="datetime-local"
          name="scheduled_start"
          defaultValue={toLocalInput(intervention.scheduled_start)}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Fin</span>
        <input
          type="datetime-local"
          name="scheduled_end"
          defaultValue={toLocalInput(intervention.scheduled_end)}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>

      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Compte rendu</span>
        <input
          name="notes"
          defaultValue={intervention.notes ?? ""}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          placeholder="Ce qui s'est passé, ce qui reste à faire…"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>
    </form>
  );
}
