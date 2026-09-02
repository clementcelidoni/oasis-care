"use client";

import { useState } from "react";
import { Field, SubmitButton } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { createGarden } from "@/lib/twin/actions";

/**
 * §38 — créer un jardin ne demande qu'un nom.
 *
 * L'adresse, la surface et le plan viennent ensuite, dans l'éditeur, où
 * on les a sous les yeux. Un formulaire de création à six champs fait
 * renoncer avant d'avoir tracé la première limite.
 *
 * Le formulaire est replié par défaut : la page sert d'abord à ROUVRIR
 * un plan, pas à en créer un. Il se referme tout seul une fois le
 * jardin créé — sinon on croit que rien ne s'est passé et on clique
 * deux fois.
 */
export function NouveauJardin({
  variant = "primary",
}: {
  variant?: "primary" | "secondary";
}) {
  const [ouvert, setOuvert] = useState(false);

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3.5 py-2 text-[var(--text-secondary)] font-medium transition-colors ${
          variant === "primary"
            ? "bg-accent text-accent-ink hover:bg-accent-hover"
            : "border border-line-strong bg-surface text-ink hover:bg-canvas"
        }`}
      >
        <Icon name="plus" className="h-4 w-4" />
        Nouveau jardin
      </button>
    );
  }

  return (
    <form
      action={async (formData) => {
        await createGarden(formData);
        setOuvert(false);
      }}
      className="flex flex-wrap items-end gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3 shadow-[var(--shadow-card)]"
    >
      <div className="min-w-52">
        <Field label="Nom du jardin" name="name" required placeholder="Villa Martin" />
      </div>
      <SubmitButton>Créer</SubmitButton>
      <button
        type="button"
        onClick={() => setOuvert(false)}
        className="rounded-[var(--radius-control)] px-3 py-2 text-[var(--text-secondary)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
      >
        Annuler
      </button>
    </form>
  );
}
