"use client";

import { useRef, useState, useTransition } from "react";
import { Field, Panel, SelectField, SubmitButton } from "@/components/ui";
import { uploadDocument } from "@/lib/documents/actions";
import {
  DOCUMENT_ENTITY_KINDS,
  DOCUMENT_TYPES,
  type AttachableEntity,
} from "@/lib/documents/types";

/**
 * §21 — le dépôt d'une pièce de chantier.
 *
 * Un composant client, et non un simple `<form action={…}>` : l'action
 * renvoie `{ok, error}` au lieu de lever, et ce message-là doit
 * s'afficher à côté du bouton. Une photo de vingt-huit mégaoctets
 * refusée en silence, c'est l'utilisateur qui recommence trois fois
 * depuis un téléphone, en 4G, sur un chantier.
 */

/** La même classe que `Field` et `SelectField` — le champ fichier et le
 *  sélecteur groupé n'ont pas d'équivalent dans le système de design,
 *  et deux contrôles voisins ne peuvent pas avoir deux bordures
 *  différentes. */
const INPUT_CLASS =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent";

export function DocumentUploader({
  entities,
  truncated,
}: {
  entities: AttachableEntity[];
  /** Vrai si une famille a été plafonnée : le formulaire le dit. */
  truncated: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Le bouton reste cliquable pendant la transition ; sans ce garde,
    // un double clic déposerait deux fois la même photo.
    if (pending) return;

    const payload = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      const result = await uploadDocument(payload);
      if (result.ok) formRef.current?.reset();
      else setError(result.error ?? "L'envoi a échoué.");
    });
  }

  // Les six familles dans l'ordre de `DOCUMENT_ENTITY_KINDS`, chacune
  // dans son `optgroup`. Une liste à plat mêlerait « Villa Martin » le
  // client et « Villa Martin » le chantier sans qu'on puisse les
  // distinguer — et se tromper range la pièce au mauvais endroit.
  const groups = DOCUMENT_ENTITY_KINDS.map((kind) => ({
    kind,
    items: entities.filter((entity) => entity.kind === kind.value),
  })).filter((group) => group.items.length > 0);

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <Panel
        title="Déposer un document"
        description="Le fichier part dans un espace privé : il n'a pas d'adresse publique, et seule votre entreprise peut le rouvrir."
        footer={<SubmitButton>{pending ? "Envoi…" : "Déposer le document"}</SubmitButton>}
      >
        <fieldset disabled={pending} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Fichier<span className="text-critical"> *</span>
            </span>
            <input
              name="file"
              type="file"
              required
              accept="image/*,application/pdf,.doc,.docx,.odt,.xls,.xlsx,.dwg,.dxf"
              className={`${INPUT_CLASS} file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-surface-sunken file:px-3 file:py-1 file:text-[var(--text-secondary)] file:font-medium file:text-ink`}
            />
            <span className="text-[var(--text-secondary)] text-ink-faint">
              Photo, plan, PDF ou document bureautique. 25 Mo maximum.
            </span>
          </label>

          <Field
            label="Nom du document"
            name="name"
            placeholder="Plan du géomètre — état des lieux"
            hint="Laissez vide pour reprendre le nom du fichier. « IMG_4471.jpg » ne se retrouve pas ; « Repérage avant travaux » si."
          />

          <SelectField
            label="Type de document"
            name="doc_type"
            defaultValue="photo"
            options={DOCUMENT_TYPES.map((type) => ({
              value: type.value,
              label: type.hint ? `${type.label} — ${type.hint}` : type.label,
            }))}
            hint="Détermine le filtre sous lequel on le retrouvera."
          />

          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Rattacher à
            </span>
            <select name="attachment" defaultValue="" className={INPUT_CLASS}>
              <option value="">Aucun rattachement pour l&apos;instant</option>
              {groups.map((group) => (
                <optgroup key={group.kind.value} label={group.kind.plural}>
                  {group.items.map((entity) => (
                    <option key={entity.id} value={`${entity.kind}:${entity.id}`}>
                      {entity.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="text-[var(--text-secondary)] text-ink-faint">
              {truncated
                ? "Client, chantier, devis, facture, jardin ou intervention. Les listes les plus longues sont limitées aux plus récents."
                : "Client, chantier, devis, facture, jardin ou intervention. Vous pourrez le ranger plus tard."}
            </span>
          </label>

          <Field
            label="Tags"
            name="tags"
            placeholder="réception, avant travaux, terrasse"
            hint="Séparés par des virgules. Ce sont eux qui regroupent des pièces que rien d'autre ne relie."
          />

          <Field
            label="Date du document"
            name="document_date"
            type="date"
            hint="Celle qui figure SUR la pièce, pas celle du dépôt : un PV signé le 3 et scanné le 12 est daté du 3."
          />

          <Field
            label="Note"
            name="notes"
            placeholder="Reçu par courrier, original classé au bureau"
            hint="Facultative. Elle est cherchable."
          />

          {error && (
            <p className="rounded-[var(--radius-control)] bg-critical-wash px-3 py-2 text-[var(--text-secondary)] text-critical sm:col-span-2">
              {error}
            </p>
          )}
        </fieldset>
      </Panel>
    </form>
  );
}
