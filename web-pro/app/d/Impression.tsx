"use client";

/**
 * LE SEUL ÉLÉMENT DE LA PAGE PUBLIQUE QUI NE S'IMPRIME PAS.
 *
 * « Imprimer » du navigateur produit un vrai PDF sans qu'on embarque un
 * moteur de rendu. Le texte s'adresse à un particulier qui cherche
 * « comment garder ce devis », pas à quelqu'un qui cherche une
 * imprimante — et ici plus qu'ailleurs, puisque cette personne n'a pas
 * de compte : la page est le SEUL endroit où elle possède ce document,
 * et le lien finira par expirer.
 *
 * C'EST LE SEUL CODE CLIENT DE TOUTE LA PORTE ANONYME. Une page de
 * document n'a besoin de rien d'autre, et chaque script chargé sur une
 * page publique est une surface de plus.
 */
export function Impression() {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink"
      >
        Imprimer ou enregistrer ce devis
      </button>
      <p className="text-xs text-ink-soft">
        Dans la fenêtre qui s&apos;ouvre, choisissez{" "}
        <strong>« Enregistrer au format PDF »</strong> pour en garder une copie : ce lien
        finira par expirer.
      </p>
    </div>
  );
}
