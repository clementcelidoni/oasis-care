"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { moveIntervention, createIntervention } from "@/lib/field/actions";
import {
  addDays, isoDay, formatDayShort, formatTime, WEEKDAY_LABELS,
  INTERVENTION_KINDS, INTERVENTION_KIND_LABELS, INTERVENTION_STATUS_LABELS,
  type Intervention, type Team,
} from "@/lib/field/types";

/**
 * §11G — « Drag & drop. »
 *
 * Glisser-déposer natif du navigateur, sans bibliothèque : une carte est
 * `draggable`, une colonne écoute `onDrop`. Une dépendance de plusieurs
 * centaines de kilo-octets pour déplacer sept cartes serait un mauvais
 * marché.
 *
 * Le déplacement CONSERVE l'heure et la durée : faire glisser une carte
 * du mardi au jeudi ne doit pas la faire commencer à minuit — ce serait
 * la première chose cassée, et la moins visible.
 */
export function WeekPlanner({
  mondayIso, interventions, teams, projects, customers,
}: {
  mondayIso: string;
  interventions: Intervention[];
  teams: Team[];
  projects: { id: string; number: string; name: string }[];
  customers: { id: string; display_name: string }[];
}) {
  const router = useRouter();
  const monday = new Date(`${mondayIso}T00:00:00Z`);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [creatingOn, setCreatingOn] = useState<string | null>(null);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const visible = teamFilter
    ? interventions.filter((i) => i.team_id === teamFilter)
    : interventions;

  async function onDrop(event: React.DragEvent, dayIso: string) {
    event.preventDefault();
    setOver(null);
    // L'état React d'abord, `dataTransfer` en secours : le premier est
    // fiable dans l'onglet, le second survit à un glisser qui aurait
    // commencé ailleurs.
    const id = dragging ?? event.dataTransfer.getData("text/plain");
    setDragging(null);
    if (!id) return;

    const data = new FormData();
    data.set("intervention_id", id);
    data.set("day", dayIso);
    await moveIntervention(data);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href={`/planning?semaine=${isoDay(addDays(monday, -7))}`}
          className="rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent"
        >
          ← Semaine précédente
        </Link>
        <Link
          href="/planning"
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-canvas"
        >
          Cette semaine
        </Link>
        <Link
          href={`/planning?semaine=${isoDay(addDays(monday, 7))}`}
          className="rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent"
        >
          Semaine suivante →
        </Link>

        {teams.length > 0 && (
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="ml-auto rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
          >
            <option value="">Toutes les équipes</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {days.map((day, index) => {
          const dayIso = isoDay(day);
          const dayInterventions = visible.filter(
            (i) => i.scheduled_start && i.scheduled_start.slice(0, 10) === dayIso,
          );
          const isToday = dayIso === isoDay(new Date());
          const isWeekend = index >= 5;

          return (
            <section
              key={dayIso}
              onDragOver={(e) => { e.preventDefault(); setOver(dayIso); }}
              onDragLeave={() => setOver((c) => (c === dayIso ? null : c))}
              onDrop={(e) => void onDrop(e, dayIso)}
              className={`flex min-h-40 flex-col rounded-lg border p-2 transition-colors ${
                over === dayIso
                  ? "border-accent bg-accent-wash"
                  : isWeekend
                    ? "border-line bg-canvas"
                    : "border-line bg-surface"
              }`}
            >
              <header className="mb-1.5 flex items-baseline justify-between">
                <span className={`text-xs font-semibold ${isToday ? "text-accent" : ""}`}>
                  {WEEKDAY_LABELS[index]}
                </span>
                <span className="text-[11px] text-ink-faint">{formatDayShort(day)}</span>
              </header>

              <div className="flex flex-1 flex-col gap-1.5">
                {dayInterventions.map((iv) => {
                  const team = iv.team_id ? teamById.get(iv.team_id) : null;
                  return (
                    <Link
                      key={iv.id}
                      href={`/projets/interventions/${iv.id}`}
                      draggable
                      onDragStart={(e) => {
                        // Firefox refuse de démarrer un glisser sans
                        // données, et un lien traîné sans cela emporte
                        // son URL au lieu de la carte.
                        e.dataTransfer.setData("text/plain", iv.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(iv.id);
                      }}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                      className={`block cursor-grab rounded-md border-l-[3px] bg-canvas px-2 py-1.5 text-[11px] transition-opacity active:cursor-grabbing ${
                        dragging === iv.id ? "opacity-40" : ""
                      }`}
                      style={{ borderLeftColor: team?.color ?? "#7c8b83" }}
                    >
                      <span className="block font-medium leading-tight">{iv.title}</span>
                      <span className="block text-ink-faint">
                        {formatTime(iv.scheduled_start)}
                        {iv.scheduled_end ? `–${formatTime(iv.scheduled_end)}` : ""}
                        {team ? ` · ${team.name}` : ""}
                      </span>
                      {iv.status !== "scheduled" && (
                        <span className="block text-ink-faint">
                          {INTERVENTION_STATUS_LABELS[iv.status]}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>

              {creatingOn === dayIso ? (
                <NewInterventionForm
                  dayIso={dayIso}
                  teams={teams}
                  projects={projects}
                  customers={customers}
                  onCancel={() => setCreatingOn(null)}
                />
              ) : (
                <button
                  onClick={() => setCreatingOn(dayIso)}
                  className="mt-1.5 rounded-md border border-dashed border-line-strong py-1 text-[11px] text-ink-faint hover:border-accent hover:text-accent"
                >
                  + Planifier
                </button>
              )}
            </section>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-ink-faint">
        Faites glisser une carte d&apos;un jour à l&apos;autre pour la replanifier.
        L&apos;heure et la durée sont conservées.
      </p>
    </div>
  );
}

function NewInterventionForm({
  dayIso, teams, projects, customers, onCancel,
}: {
  dayIso: string;
  teams: Team[];
  projects: { id: string; number: string; name: string }[];
  customers: { id: string; display_name: string }[];
  onCancel: () => void;
}) {
  return (
    <form action={createIntervention} className="mt-1.5 flex flex-col gap-1">
      {/*
        Huit heures par défaut, de 8 h à 16 h : la journée type. Se
        trompe souvent, mais un champ vide se trompe toujours, et se
        corrige sur la fiche.
      */}
      <input type="hidden" name="scheduled_start" value={`${dayIso}T08:00`} />
      <input type="hidden" name="scheduled_end" value={`${dayIso}T16:00`} />

      <input
        name="title"
        required
        autoFocus
        placeholder="Intitulé"
        className="rounded border border-line-strong bg-surface px-1.5 py-1 text-[11px] outline-none focus:border-accent"
      />
      <select
        name="kind"
        defaultValue="work"
        className="rounded border border-line-strong bg-surface px-1 py-1 text-[11px] outline-none focus:border-accent"
      >
        {INTERVENTION_KINDS.map((k) => (
          <option key={k} value={k}>{INTERVENTION_KIND_LABELS[k]}</option>
        ))}
      </select>
      {teams.length > 0 && (
        <select
          name="team_id"
          defaultValue=""
          className="rounded border border-line-strong bg-surface px-1 py-1 text-[11px] outline-none focus:border-accent"
        >
          <option value="">Sans équipe</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {projects.length > 0 && (
        <select
          name="project_id"
          defaultValue=""
          className="rounded border border-line-strong bg-surface px-1 py-1 text-[11px] outline-none focus:border-accent"
        >
          <option value="">Sans chantier</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.number} — {p.name}</option>
          ))}
        </select>
      )}
      {customers.length > 0 && (
        <select
          name="customer_id"
          defaultValue=""
          className="rounded border border-line-strong bg-surface px-1 py-1 text-[11px] outline-none focus:border-accent"
        >
          <option value="">Sans client</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.display_name}</option>
          ))}
        </select>
      )}
      <div className="flex gap-1">
        <button
          type="submit"
          className="flex-1 rounded bg-accent px-1.5 py-1 text-[11px] font-medium text-accent-ink"
        >
          Créer
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-1.5 py-1 text-[11px] text-ink-faint hover:bg-canvas"
        >
          ✕
        </button>
      </div>
    </form>
  );
}
