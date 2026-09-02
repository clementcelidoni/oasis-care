"use client";

import { useRef, useState, useTransition } from "react";
import { Field, Panel, SelectField, SubmitButton } from "@/components/ui";
import { uploadCompanyDocument } from "@/lib/company/actions";

/**
 * §45 DOCUMENTS SOCIÉTÉ — le dépôt d'une pièce.
 *
 * Les six types viennent de la contrainte `check` de la table
 * `organization_documents` (migration 0060) : la liste déroulante ne
 * peut proposer que ce que la base accepte, sinon l'insertion échoue
 * une fois le fichier déjà envoyé. Ils sont déclarés ICI, avec le
 * formulaire qui les propose, et la page les réutilise pour titrer ses
 * sections — un seul endroit à corriger le jour où la contrainte bouge.
 *
 * `label` nomme UNE pièce (ce qu'on choisit dans le menu), `section`
 * nomme LE RAYON où elle se range (ce qui titre le panneau).
 */
export const DOCUMENT_KINDS = [
  { value: "kbis", label: "Extrait KBIS", section: "Immatriculation" },
  { value: "rib", label: "RIB", section: "Coordonnées bancaires" },
  { value: "insurance", label: "Attestation d'assurance", section: "Assurances" },
  { value: "certification", label: "Certification", section: "Certifications et qualifications" },
  { value: "administrative", label: "Document administratif", section: "Documents administratifs" },
  { value: "other", label: "Autre document", section: "Autres documents" },
] as const;

/**
 * Un composant client, et non un simple `<form action={…}>` : l'action
 * renvoie `{ok, error}` au lieu de lever, et ce message-là doit
 * s'afficher à côté du bouton. Un fichier de vingt mégaoctets refusé en
 * silence, c'est l'utilisateur qui recommence trois fois.
 */
export function DocumentUploader() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Le bouton reste cliquable pendant la transition ; sans ce garde,
    // un double clic déposerait deux fois la même attestation.
    if (pending) return;

    const payload = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      const result = await uploadCompanyDocument(payload);
      if (result.ok) formRef.current?.reset();
      else setError(result.error ?? "L'envoi a échoué.");
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <Panel
        title="Ajouter un document"
        description="Le fichier part dans un espace privé : il n'a pas d'adresse publique, et seuls les administrateurs peuvent le rouvrir."
        footer={<SubmitButton>{pending ? "Envoi…" : "Ajouter le document"}</SubmitButton>}
      >
        <fieldset disabled={pending} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <SelectField
            label="Type de document"
            name="kind"
            options={DOCUMENT_KINDS.map((kind) => ({ value: kind.value, label: kind.label }))}
            hint="Détermine la section où le document se rangera."
          />

          <Field
            label="Nom du document"
            name="name"
            placeholder="Attestation RC Pro 2026"
            hint="Laissez vide pour reprendre le nom du fichier."
          />

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Fichier<span className="text-critical"> *</span>
            </span>
            {/* Le seul champ écrit à la main : `Field` ne porte ni
                `accept`, ni le style d'un sélecteur de fichier. */}
            <input
              name="file"
              type="file"
              required
              accept="application/pdf,image/png,image/jpeg,image/webp,.doc,.docx,.odt,.xls,.xlsx"
              className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-surface-sunken file:px-3 file:py-1 file:text-[var(--text-secondary)] file:font-medium file:text-ink focus:border-accent"
            />
            <span className="text-[var(--text-secondary)] text-ink-faint">
              PDF, image ou document bureautique. 20 Mo maximum.
            </span>
          </label>

          <Field
            label="Date d'expiration"
            name="expires_on"
            type="date"
            hint="Facultative. Renseignée, elle déclenche un avertissement deux mois avant l'échéance."
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
