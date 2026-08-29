"use client";

/**
 * Le seul élément de cette page qui ne s'imprime pas.
 *
 * `print:hidden` le retire du document : un bouton « Imprimer » sur un
 * devis remis au client serait ridicule.
 */
export function PrintButton() {
  return (
    <div className="mb-6 flex items-center gap-3 rounded-lg border border-line bg-canvas px-4 py-2.5 print:hidden">
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
      >
        Imprimer
      </button>
      <p className="text-xs text-ink-soft">
        Dans la fenêtre d&apos;impression, choisissez <strong>« Enregistrer au format PDF »</strong>{" "}
        comme destination pour obtenir un fichier à joindre à un courriel.
      </p>
    </div>
  );
}
