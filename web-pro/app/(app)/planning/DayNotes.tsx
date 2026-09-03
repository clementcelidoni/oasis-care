"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { initialsOf } from "@/components/ui";
import { saveDayNote } from "@/lib/field/actions";
import { NOTE_LONGUEUR_MAX, formatDayIsoLong } from "@/lib/field/types";
import type { EquipeVue, NoteVue } from "./vue";

/** Au-delà, la case appartiendrait aux notes et non plus au travail. */
const NOTES_AFFICHEES = 2;

/**
 * Les notes de la journée — « livraison paillage 14 h », « dépôt
 * fermé », « équipe B en formation ».
 *
 * ELLES SONT EN HAUT DE LA CASE, au-dessus des interventions. Une note
 * est une CONDITION de la journée : la lire après les interventions
 * qu'elle conditionne, c'est la lire trop tard.
 *
 * ELLES N'ONT PAS DE CARTE. Un filet à gauche, du texte, rien d'autre :
 * ni fond, ni ombre, ni bordure. Elle doit se lire comme une
 * annotation, pas comme une tâche de plus à faire.
 *
 * LE BOUTON D'AJOUT EST ICI, ET NON DANS L'EN-TÊTE DE LA CASE. C'était
 * un glyphe « ✎ » de 24 px coincé entre le nom du jour et le compteur
 * de charge, que le nom du jour recouvrait sur les colonnes de
 * week-end : le geste que l'utilisateur a explicitement demandé était
 * masqué le dimanche. Descendu au ras des notes, il désigne mieux ce
 * qu'il fait, il porte un mot plutôt qu'un signe, et l'en-tête
 * respire.
 */
export function DayNotes({
  dayIso, notes, equipes, peutModifier, edition, surEdition, equipeParDefaut, debordement,
}: {
  dayIso: string;
  notes: NoteVue[];
  equipes: Map<string, EquipeVue>;
  peutModifier: boolean;
  /** L'identifiant de la note en cours de saisie, ou « nouvelle ». */
  edition: string | null;
  surEdition: (quoi: string | null) => void;
  /** L'équipe filtrée, s'il y en a une : la note qu'on écrit la concerne. */
  equipeParDefaut: string;
  /** Le « +2 notes » qui ouvre le tiroir du jour. */
  debordement: (restantes: number) => React.ReactNode;
}) {
  const visibles = notes.slice(0, NOTES_AFFICHEES);
  const restantes = notes.length - visibles.length;

  if (notes.length === 0 && !peutModifier) return null;

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {edition === "nouvelle" && (
        <ChampDeNote
          dayIso={dayIso}
          equipeParDefaut={equipeParDefaut}
          surSortie={() => surEdition(null)}
        />
      )}

      {visibles.map((note) => {
        const equipe = note.team_id ? equipes.get(note.team_id) : undefined;

        if (edition === note.id) {
          return (
            <ChampDeNote
              key={note.id}
              dayIso={dayIso}
              note={note}
              equipeParDefaut={note.team_id ?? ""}
              surSortie={() => surEdition(null)}
            />
          );
        }

        const corps = (
          <>
            {/* Le nom de l'équipe est ÉCRIT. Le filet coloré le double,
                il ne le remplace pas : une couleur choisie par
                l'utilisateur n'est ni lisible ni forcément distinguable. */}
            {equipe && <span className="font-medium text-ink">{equipe.name} — </span>}
            {note.body}
          </>
        );

        return (
          <div
            key={note.id}
            className="flex items-start gap-1.5 border-l-2 pl-2"
            style={{ borderLeftColor: equipe?.color ?? "var(--line-strong)" }}
          >
            {peutModifier ? (
              <button
                type="button"
                onClick={() => surEdition(note.id)}
                title="Modifier cette note"
                className="min-w-0 flex-1 text-left text-[length:var(--text-secondary)] text-ink-soft transition-colors hover:text-ink"
              >
                <span className="line-clamp-2">{corps}</span>
              </button>
            ) : (
              <p className="line-clamp-2 min-w-0 flex-1 text-[length:var(--text-secondary)] text-ink-soft">
                {corps}
              </p>
            )}

            {/* Une consigne anonyme ne se conteste pas et ne se corrige
                pas. Les initiales suffisent à savoir à qui demander ;
                le nom entier doublerait la longueur d'une note de deux
                mots. */}
            {note.auteur && (
              <span
                title={note.auteur}
                className="mt-px shrink-0 text-[11px] text-ink-faint"
              >
                {initialsOf(note.auteur)}
              </span>
            )}
          </div>
        );
      })}

      {restantes > 0 && debordement(restantes)}

      {/* Toujours visible, jamais au survol : la note est la moitié de
          ce qui a été demandé de cet écran, et une affordance qu'il
          faut découvrir n'en est pas une. */}
      {peutModifier && edition !== "nouvelle" && (
        <button
          type="button"
          onClick={() => surEdition("nouvelle")}
          title={`Ajouter une note — ${formatDayIsoLong(dayIso)}`}
          className="self-start rounded-[var(--radius-control)] px-1 py-0.5 text-[length:var(--text-secondary)] text-ink-faint transition-colors hover:bg-surface-sunken hover:text-accent"
        >
          <span aria-hidden>✎ </span>Note
        </button>
      )}
    </div>
  );
}

/**
 * Le champ de saisie : deux lignes, déjà focalisé, Entrée enregistre,
 * Échap annule.
 *
 * VIDER ET VALIDER SUPPRIME. C'est le geste naturel pour retirer une
 * annotation, et il est traité dans la Server Action plutôt que laissé
 * à la contrainte `body <> ''` de la migration — sans quoi
 * l'utilisateur recevrait le nom d'une contrainte SQL en pleine figure.
 */
function ChampDeNote({
  dayIso, note, equipeParDefaut, surSortie,
}: {
  dayIso: string;
  note?: NoteVue;
  equipeParDefaut: string;
  surSortie: () => void;
}) {
  const router = useRouter();
  const formulaire = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formulaire}
      action={async (data) => {
        await saveDayNote(data);
        surSortie();
        router.refresh();
      }}
      className="flex flex-col gap-1"
    >
      <input type="hidden" name="day" value={dayIso} />
      <input type="hidden" name="note_id" value={note?.id ?? ""} />
      {/* Une note écrite alors qu'une équipe est filtrée concerne cette
          équipe-là ; sinon elle concerne toute l'entreprise. C'est le
          seul moyen de désigner une équipe sans ajouter un sélecteur
          dans un champ d'une ligne. */}
      <input type="hidden" name="team_id" value={note ? (note.team_id ?? "") : equipeParDefaut} />

      <textarea
        name="body"
        rows={2}
        autoFocus
        maxLength={NOTE_LONGUEUR_MAX}
        defaultValue={note?.body ?? ""}
        placeholder="Livraison paillage 14 h…"
        aria-label={note ? "Modifier la note" : "Nouvelle note de journée"}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            surSortie();
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            formulaire.current?.requestSubmit();
          }
        }}
        className="w-full resize-none rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 py-1.5 text-[length:var(--text-secondary)] outline-none placeholder:text-ink-faint focus:border-accent"
      />

      <p className="text-[11px] text-ink-faint">
        Entrée pour enregistrer{note ? ", vide pour supprimer" : ""}, Échap pour annuler.
      </p>
    </form>
  );
}
