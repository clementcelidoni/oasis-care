"use client";

import { useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@/components/shell/Icon";

/**
 * §38 DIGITAL TWIN UX — « Ajouter : Plein écran ».
 *
 * Le cadre du plan, et rien d'autre. Il enveloppe l'éditeur sans le
 * connaître : `TwinEditor` continue de croire qu'il occupe la hauteur
 * de son parent, et c'est ce parent-là qui passe en plein écran. Cette
 * séparation compte — l'éditeur est mille lignes de canevas, de
 * raccourcis clavier et de détection de conflit, et le plein écran n'a
 * aucune raison d'y toucher.
 *
 * L'API native plutôt qu'un faux plein écran en `position: fixed` : elle
 * seule masque la barre d'onglets et la barre des tâches, ce qui est
 * précisément ce qu'on vient chercher quand on trace une limite de
 * terrain au mètre près. Échap en sort, sans qu'on ait à le câbler.
 */

/**
 * Le plein écran est un état du DOCUMENT, pas de React : on s'y abonne
 * plutôt que de le recopier dans un `useState`. Une copie se
 * désynchronise dès que le navigateur sort du plein écran tout seul —
 * Échap, un changement d'onglet, la touche F11.
 */
function ecouterPleinEcran(surChangement: () => void) {
  document.addEventListener("fullscreenchange", surChangement);
  return () => document.removeEventListener("fullscreenchange", surChangement);
}

/** La capacité du navigateur, elle, ne change pas en cours de session. */
const NE_CHANGE_JAMAIS = () => () => undefined;

/**
 * Au rendu serveur, on ne sait rien du navigateur : pas de bouton, pas
 * de plein écran. Le bouton apparaît à l'hydratation, quand on sait
 * qu'il fera quelque chose — un bouton qui ne répond pas est pire que
 * pas de bouton.
 */
const PAS_AU_SERVEUR = () => false;

export function PleinEcran({ children }: { children: ReactNode }) {
  const cadreRef = useRef<HTMLDivElement>(null);

  const disponible = useSyncExternalStore(
    NE_CHANGE_JAMAIS,
    () => document.fullscreenEnabled === true,
    PAS_AU_SERVEUR,
  );

  // Ce cadre est le seul élément de la page qui puisse passer en plein
  // écran : savoir que QUELQUE CHOSE l'est suffit à savoir que c'est lui.
  const plein = useSyncExternalStore(
    ecouterPleinEcran,
    () => document.fullscreenElement !== null,
    PAS_AU_SERVEUR,
  );

  const basculer = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    // La promesse est rejetée quand le navigateur ne reconnaît pas le
    // geste comme une intention de l'utilisateur. Rien à signaler : la
    // page reste telle quelle, et le bouton avec elle.
    void cadreRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  return (
    <div ref={cadreRef} className="relative h-full bg-canvas">
      {children}

      {disponible && (
        <button
          type="button"
          onClick={basculer}
          aria-pressed={plein}
          title={plein ? "Quitter le plein écran (Échap)" : "Afficher le plan en plein écran"}
          className="absolute bottom-3 right-3 z-30 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-line-strong bg-surface/95 px-3 py-1.5 text-[var(--text-secondary)] font-medium text-ink-soft shadow-[var(--shadow-raised)] backdrop-blur transition-colors hover:text-ink"
        >
          <Icon name={plein ? "collapse" : "expand"} className="h-4 w-4" />
          {plein ? "Quitter le plein écran" : "Plein écran"}
        </button>
      )}
    </div>
  );
}
