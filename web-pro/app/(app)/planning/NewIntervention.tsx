"use client";

import { useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal, SelectField, SubmitButton } from "@/components/ui";
import { createIntervention } from "@/lib/field/actions";
import {
  INTERVENTION_KINDS, INTERVENTION_KIND_LABELS, formatDayIsoLong, parisAtHour,
} from "@/lib/field/types";
import type { EquipeVue, OptionsCreation } from "./vue";

/**
 * §9 du système : « ajout rapide » est exactement l'emploi d'une modale.
 *
 * Le formulaire vivait DANS la colonne : six champs empilés en 11 px
 * dans une case de 143 px de large, illisible dès qu'il y avait des
 * cartes autour. Il n'y a pas de place pour un formulaire dans une
 * colonne de planning, et il n'y en aura jamais.
 *
 * ET ON NE QUITTE PLUS LE PLANNING : `createIntervention` redirigeait
 * vers la fiche. Préparer dix chantiers le lundi matin coûtait dix
 * allers et dix retours. Le champ `rester` le lui dit ; ailleurs, la
 * redirection reste le bon défaut.
 */
export function NewIntervention({
  dayIso, equipes, options, declencheur, declencheurClassName, declencheurTitre,
}: {
  dayIso: string;
  equipes: EquipeVue[];
  options: OptionsCreation;
  declencheur: ReactNode;
  declencheurClassName?: string;
  declencheurTitre?: string;
}) {
  return (
    <Modal
      triggerLabel={declencheur}
      triggerTitle={declencheurTitre}
      triggerClassName={declencheurClassName}
      triggerVariant="primary"
      title="Planifier une intervention"
      description={formatDayIsoLong(dayIso)}
      width="26rem"
    >
      <Formulaire dayIso={dayIso} equipes={equipes} options={options} />
    </Modal>
  );
}

function Formulaire({
  dayIso, equipes, options,
}: {
  dayIso: string;
  equipes: EquipeVue[];
  options: OptionsCreation;
}) {
  const router = useRouter();
  const formulaire = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formulaire}
      action={async (data) => {
        await createIntervention(data);
        // Fermer la modale plutôt que quitter la page : c'est tout
        // l'objet de `rester`.
        formulaire.current?.closest("dialog")?.close();
        formulaire.current?.reset();
        router.refresh();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="rester" value="1" />

      {/*
        Huit heures par défaut, de 8 h à 16 h : la journée type. Se
        trompe souvent, mais un champ vide se trompe toujours, et se
        corrige sur la fiche.

        En instants ISO et non en « JJT08:00 » : la base est en UTC et
        aurait lu 8 h du matin comme 10 h ici. Et en heure de PARIS et
        non en heure du navigateur, pour que la carte tombe dans la
        colonne qu'on vient de cliquer.
      */}
      <input type="hidden" name="scheduled_start" value={parisAtHour(dayIso, 8)} />
      <input type="hidden" name="scheduled_end" value={parisAtHour(dayIso, 16)} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[length:var(--text-secondary)] font-medium text-ink-soft">
          Intitulé<span className="text-critical"> *</span>
        </span>
        <input
          name="title"
          required
          autoFocus
          placeholder="Taille des haies, allée du Parc"
          className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[length:var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </label>

      <SelectField
        label="Nature"
        name="kind"
        defaultValue="work"
        options={INTERVENTION_KINDS.map((k) => ({ value: k, label: INTERVENTION_KIND_LABELS[k] }))}
      />

      <SelectField
        label="Équipe"
        name="team_id"
        defaultValue=""
        options={[
          { value: "", label: "Sans équipe" },
          ...equipes.map((e) => ({ value: e.id, label: e.name })),
        ]}
        hint="Se change d'un glisser, plus tard."
      />

      {options.projets.length > 0 && (
        <SelectField
          label="Chantier"
          name="project_id"
          defaultValue=""
          options={[
            { value: "", label: "Sans chantier" },
            ...options.projets.map((p) => ({ value: p.id, label: `${p.number} — ${p.name}` })),
          ]}
        />
      )}

      {options.clients.length > 0 && (
        <SelectField
          label="Client"
          name="customer_id"
          defaultValue=""
          options={[
            { value: "", label: "Sans client" },
            ...options.clients.map((c) => ({ value: c.id, label: c.display_name })),
          ]}
        />
      )}

      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => formulaire.current?.closest("dialog")?.close()}
          className="rounded-[var(--radius-control)] px-3.5 py-2 text-[length:var(--text-secondary)] font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
        >
          Annuler
        </button>
        <SubmitButton>Planifier</SubmitButton>
      </div>
    </form>
  );
}
