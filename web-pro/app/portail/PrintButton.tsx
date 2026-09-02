"use client";

/**
 * Le seul élément de la page qui ne s'imprime pas.
 *
 * Le portail réutilise le geste du professionnel : « Imprimer » du
 * navigateur produit un vrai PDF, sans qu'on embarque un moteur de
 * rendu. Le texte est écrit pour un particulier, qui cherche « comment
 * enregistrer ce devis » plutôt que « comment l'imprimer ».
 */
export function PrintButton({ label = "Imprimer ou enregistrer en PDF" }: { label?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-canvas px-4 py-2.5 print:hidden">
      <button
        onClick={() => window.print()}
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
      >
        {label}
      </button>
      <p className="text-xs text-ink-soft">
        Dans la fenêtre qui s&apos;ouvre, choisissez{" "}
        <strong>« Enregistrer au format PDF »</strong> pour garder une copie.
      </p>
    </div>
  );
}
