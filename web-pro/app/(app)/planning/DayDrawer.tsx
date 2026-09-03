"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Drawer, StatusBadge } from "@/components/ui";
import {
  INTERVENTION_KIND_LABELS, INTERVENTION_STATUS_LABELS, INTERVENTION_STATUS_TONE,
  formatDayIsoLong, formatDuree, formatTime, overlapHours,
  type PlanningCard,
} from "@/lib/field/types";
import { KindGlyph } from "./KindGlyph";
import type { EquipeVue, NoteVue, SiteVue } from "./vue";

/**
 * §8 — le détail d'une journée, dans un tiroir.
 *
 * C'EST ICI QUE VA TOUT CE QUI NE TIENT PAS SUR LA CARTE : les prénoms
 * de l'équipe, l'adresse du chantier, les consignes de départ, le
 * compte rendu. Le « QUI » et le « OÙ » sont les deux plus gros
 * manques de l'ancien écran, mais ce sont des informations qu'on veut
 * en OUVRANT une journée, pas en balayant une semaine : les mettre sur
 * la carte rendrait les sept colonnes illisibles pour servir la
 * question d'une seule.
 *
 * Le tiroir garde la semaine visible derrière lui et se ferme à Échap —
 * c'est tout son intérêt face à une page.
 */
export function DayDrawer({
  dayIso, cartes, notes, equipes, clients, sites, declencheur, declencheurClassName, declencheurTitre,
}: {
  dayIso: string;
  cartes: PlanningCard[];
  notes: NoteVue[];
  equipes: Map<string, EquipeVue>;
  clients: Map<string, string>;
  sites: Map<string, SiteVue>;
  declencheur: ReactNode;
  declencheurClassName: string;
  declencheurTitre: string;
}) {
  return (
    <Drawer
      triggerLabel={declencheur}
      triggerTitle={declencheurTitre}
      triggerClassName={declencheurClassName}
      title={formatDayIsoLong(dayIso)}
      description={
        cartes.length === 0
          ? "Aucune intervention ce jour-là."
          : `${cartes.length} intervention${cartes.length > 1 ? "s" : ""}`
      }
      width="30rem"
    >
      <div className="flex flex-col gap-6">
        {notes.length > 0 && (
          <section>
            <h3 className="mb-2 text-[length:var(--text-secondary)] font-medium text-ink-soft">
              Notes de la journée
            </h3>
            <ul className="flex flex-col gap-2.5">
              {notes.map((note) => {
                const equipe = note.team_id ? equipes.get(note.team_id) : undefined;
                return (
                  <li
                    key={note.id}
                    className="border-l-2 pl-2.5"
                    style={{ borderLeftColor: equipe?.color ?? "var(--line-strong)" }}
                  >
                    <p className="text-[length:var(--text-body)] text-ink">
                      {equipe && <span className="font-medium">{equipe.name} — </span>}
                      {note.body}
                    </p>
                    {note.auteur && (
                      <p className="mt-0.5 text-[length:var(--text-secondary)] text-ink-faint">
                        {note.auteur}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {cartes.map((carte) => {
          const iv = carte.intervention;
          const equipe = iv.team_id ? equipes.get(iv.team_id) : undefined;
          const site = iv.site_id ? sites.get(iv.site_id) : undefined;
          const client = iv.customer_id ? clients.get(iv.customer_id) : undefined;
          const heures = overlapHours(iv, dayIso);

          return (
            <section key={`${iv.id}-${carte.rang}`} className="border-t border-line pt-4 first:border-0 first:pt-0">
              <div className="flex items-start gap-2">
                <KindGlyph kind={iv.kind} className="mt-1 h-4 w-4 shrink-0 text-ink-faint" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/projets/interventions/${iv.id}`}
                    className="text-[length:var(--text-card)] font-semibold leading-snug hover:text-accent"
                  >
                    {iv.title}
                  </Link>
                  <p className="mt-0.5 text-[length:var(--text-secondary)] text-ink-faint">
                    {INTERVENTION_KIND_LABELS[iv.kind]}
                    {carte.jours > 1 && ` · jour ${carte.rang} sur ${carte.jours}`}
                  </p>
                </div>
                <StatusBadge tone={INTERVENTION_STATUS_TONE[iv.status]}>
                  {INTERVENTION_STATUS_LABELS[iv.status]}
                </StatusBadge>
              </div>

              <dl className="mt-3 flex flex-col gap-2">
                <Ligne titre="Horaire">
                  <span className="tabular">
                    {formatTime(iv.scheduled_start)}
                    {iv.scheduled_end ? ` – ${formatTime(iv.scheduled_end)}` : ""}
                    {/* Jamais « 0 h » : une fin inconnue n'est pas une
                        durée nulle. */}
                    {heures !== null && ` · ${formatDuree(heures)} ce jour-là`}
                  </span>
                  {!iv.scheduled_end && (
                    <span className="text-ink-faint"> · durée inconnue</span>
                  )}
                </Ligne>

                <Ligne titre="Qui">
                  {equipe ? (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: equipe.color }}
                        />
                        {equipe.name}
                      </span>
                      {equipe.membres.length > 0 ? (
                        <span className="text-ink-soft"> — {equipe.membres.join(", ")}</span>
                      ) : (
                        <span className="text-ink-faint"> — aucun salarié rattaché</span>
                      )}
                    </>
                  ) : (
                    <span className="text-ink-faint">Sans équipe</span>
                  )}
                </Ligne>

                <Ligne titre="Où">
                  {site ? (
                    <>
                      <span>{site.name}</span>
                      {site.adresse && <span className="text-ink-soft"> — {site.adresse}</span>}
                      {site.carteHref && (
                        <a
                          href={site.carteHref}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="ml-2 text-accent hover:underline"
                        >
                          Voir sur la carte
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-ink-faint">Aucun site renseigné</span>
                  )}
                </Ligne>

                {client && <Ligne titre="Client">{client}</Ligne>}

                {iv.instructions && (
                  <Ligne titre="Consignes">
                    <span className="whitespace-pre-line">{iv.instructions}</span>
                  </Ligne>
                )}

                {iv.notes && (
                  <Ligne titre="Compte rendu">
                    <span className="whitespace-pre-line">{iv.notes}</span>
                  </Ligne>
                )}
              </dl>

              {carte.jours > 1 && !carte.premier && (
                <p className="mt-2">
                  <Badge>Commencé un autre jour</Badge>
                </p>
              )}
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}

function Ligne({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-[length:var(--text-secondary)] text-ink-faint">{titre}</dt>
      <dd className="min-w-0 flex-1 text-[length:var(--text-body)]">{children}</dd>
    </div>
  );
}
