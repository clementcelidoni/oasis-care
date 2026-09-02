"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * Le lien d'invitation, prêt à coller dans un courriel.
 *
 * L'origine est lue dans le navigateur plutôt que devinée côté serveur.
 * Derrière un proxy — et l'hébergement en a un — l'en-tête `Host` peut
 * porter le nom interne du service, et le lien envoyé au client
 * pointerait vers une adresse qu'il ne peut pas ouvrir.
 *
 * `useSyncExternalStore` plutôt qu'un `useState` posé dans un effet :
 * c'est la façon prévue de lire une valeur que le serveur ne connaît
 * pas. Le troisième argument est l'instantané du rendu serveur — vide —
 * et le second celui du navigateur, de sorte que l'hydratation ne
 * compare jamais deux valeurs différentes.
 */
export function InvitationLink({ token }: { token: string }) {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const [copied, setCopied] = useState(false);

  const url = origin ? `${origin}/invitation/${token}` : "";

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Le presse-papiers peut être refusé (page non sécurisée,
      // permission bloquée). Le lien reste sélectionnable à la main —
      // c'est pour ça qu'il est affiché en entier.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        placeholder="Lien en cours de préparation…"
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 rounded-md border border-line-strong bg-canvas px-2 py-1.5 font-mono text-xs outline-none"
      />
      <button
        type="button"
        onClick={copy}
        disabled={!url}
        className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {copied ? "Copié" : "Copier"}
      </button>
    </div>
  );
}
