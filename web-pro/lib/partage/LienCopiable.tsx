"use client";

import { useState } from "react";

/**
 * Le seul code client de tout le partage : un bouton « Copier ».
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI L'ADRESSE SE FABRIQUE ICI, DANS LE NAVIGATEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * `window.location.origin` est l'adresse par laquelle le paysagiste est
 * RÉELLEMENT entré. Une variable d'environnement mal réglée — un
 * domaine de recette laissé en production, un `https` oublié — donnerait
 * un lien qui ne s'ouvre pas, et personne ne s'en apercevrait avant que
 * le client ne réponde « votre lien ne marche pas ». L'origine du
 * navigateur, elle, ne peut pas être fausse : c'est celle de la page
 * qu'on est en train de regarder.
 *
 * LE JETON EST AFFICHÉ TRONQUÉ. Il tient dans le presse-papiers, pas à
 * l'écran : un devis se relit souvent à deux devant un ordinateur, et
 * un partage d'écran ou une capture ferait sortir la clé de la porte.
 * Le bouton copie l'adresse ENTIÈRE.
 */
export function LienCopiable({ jeton }: { jeton: string }) {
  const [copie, setCopie] = useState(false);

  const apercu = `…/d/${jeton.slice(0, 6)}…${jeton.slice(-4)}`;

  async function copier() {
    const adresse = `${window.location.origin}/d/${jeton}`;
    try {
      await navigator.clipboard.writeText(adresse);
      setCopie(true);
      window.setTimeout(() => setCopie(false), 2500);
    } catch {
      // LE PRESSE-PAPIERS PEUT ÊTRE REFUSÉ — navigateur ancien, page
      // servie sans HTTPS, réglage d'entreprise. On ne laisse pas le
      // paysagiste sans recours : on lui montre l'adresse pour qu'il la
      // recopie. Un bouton qui ne fait rien et ne dit rien est pire
      // qu'un bouton absent.
      window.prompt("Copiez cette adresse et envoyez-la à votre client :", adresse);
    }
  }

  return (
    <span className="flex items-center gap-1.5">
      <code className="rounded bg-canvas px-1.5 py-1 font-mono text-[11px] text-ink-soft">
        {apercu}
      </code>
      <button
        type="button"
        onClick={copier}
        className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
      >
        {copie ? "Copié" : "Copier le lien"}
      </button>
    </span>
  );
}
