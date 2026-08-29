"use client";

import Link from "next/link";
import { createProjectFromQuote } from "@/lib/projects/actions";

/**
 * §DEVIS ACCEPTÉ — « Transformer en projet ».
 *
 * Une fois le chantier créé, le bouton laisse la place à un lien vers
 * lui. Sans cela, on cliquerait deux fois en croyant que rien ne s'est
 * passé — la fonction en base est idempotente et rendrait le même
 * chantier, mais l'utilisateur, lui, n'en saurait rien.
 */
export function ToProjectBar({
  quoteId, existingProject,
}: {
  quoteId: string;
  existingProject: { id: string; number: string } | null;
}) {
  if (existingProject) {
    return (
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm">
        <span className="text-ink-soft">Ce devis a donné le chantier</span>
        <Link
          href={`/projets/${existingProject.id}`}
          className="tabular font-medium text-accent hover:underline"
        >
          {existingProject.number}
        </Link>
      </div>
    );
  }

  return (
    <form
      action={createProjectFromQuote}
      className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent-wash px-3 py-2.5"
    >
      <input type="hidden" name="quote_id" value={quoteId} />
      <button
        type="submit"
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
      >
        Transformer en chantier
      </button>
      <p className="text-xs text-ink-soft">
        Chaque poste devient une phase, chaque ligne une ressource prévue —{" "}
        <strong>à son coût d&apos;achat</strong>, pas à son prix de vente : c&apos;est ce
        qu&apos;on avait prévu de dépenser qu&apos;on va suivre.
      </p>
    </form>
  );
}
