"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * Le lien d'invitation d'un collègue, prêt à coller dans un courriel.
 *
 * Même raisonnement que `InvitationLink` du portail client, et pour la
 * même raison : l'origine est lue DANS LE NAVIGATEUR, pas devinée côté
 * serveur. Derrière un proxy — et l'hébergement en a un — l'en-tête
 * `Host` peut porter le nom interne du service, et le lien envoyé
 * pointerait vers une adresse que le destinataire ne peut pas ouvrir.
 *
 * `useSyncExternalStore` plutôt qu'un `useState` posé dans un effet :
 * c'est la façon prévue de lire une valeur que le serveur ne connaît
 * pas. Le troisième argument est l'instantané du rendu serveur — vide —
 * et le second celui du navigateur, de sorte que l'hydratation ne
 * compare jamais deux valeurs différentes.
 *
 * Le chemin est distinct de celui du portail client (`/invitation/…`) :
 * ce sont deux tables, deux fonctions d'acceptation et deux natures
 * d'accès. Un client qui reçoit par erreur un lien d'équipe doit tomber
 * sur une page qui le lui dit, pas sur un « lien invalide » énigmatique.
 */
export function TeamInvitationLink({ token }: { token: string }) {
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const [copied, setCopied] = useState(false);

  const url = origin ? `${origin}/invitation/equipe/${token}` : "";

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
        aria-label="Lien d'invitation"
        placeholder="Lien en cours de préparation…"
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-line-strong bg-canvas px-2.5 py-1.5 font-mono text-[var(--text-secondary)] outline-none"
      />
      <button
        type="button"
        onClick={copy}
        disabled={!url}
        className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-1.5 text-[var(--text-secondary)] font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-50"
      >
        {copied ? "Copié" : "Copier"}
      </button>
    </div>
  );
}
