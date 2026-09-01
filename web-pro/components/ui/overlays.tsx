"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ButtonVariant } from "./primitives";

/**
 * §8 DRAWERS et §9 MODALES.
 *
 * Les deux reposent sur `<dialog>` natif, et ce n'est pas un détail de
 * confort : l'élément apporte le piégeage du focus, la fermeture à
 * Échap, l'inertie du reste de la page pour les lecteurs d'écran et le
 * calque de fond. Reconstruire tout ça à la main, c'est la façon
 * habituelle d'obtenir une boîte de dialogue dont on ne peut pas
 * sortir au clavier — §47 demande précisément le contraire.
 *
 * §9 fixe la frontière : modale pour « confirmation, ajout rapide,
 * invitation, petite modification, changement de forfait » ; JAMAIS
 * pour « Digital Twin complet, gros devis, gros projet ». Ces trois-là
 * sont des pages.
 */

const TRIGGER_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3.5 py-2 text-[var(--text-secondary)] font-medium transition-colors";

const TRIGGER_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-canvas",
  ghost: "text-ink-soft hover:bg-canvas hover:text-ink",
  danger: "border border-critical/30 bg-critical-wash text-critical hover:bg-critical/10",
};

function useDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // `close` part aussi de l'intérieur — Échap, ou un clic sur le fond.
  // Sans cet écouteur, l'état React resterait « ouvert » et le
  // deuxième clic sur le déclencheur ne rouvrirait rien.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onClose = () => setOpen(false);
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  return { ref, open, setOpen };
}

/** Un clic sur le fond ferme — mais pas un clic qui a commencé dedans. */
function backdropClose(
  event: React.MouseEvent<HTMLDialogElement>,
  dialog: HTMLDialogElement | null,
) {
  if (event.target !== dialog) return;
  dialog?.close();
}

export function Modal({
  triggerLabel,
  triggerVariant = "secondary",
  title,
  description,
  children,
  width = "28rem",
}: {
  triggerLabel: ReactNode;
  triggerVariant?: ButtonVariant;
  title: string;
  description?: string;
  children: ReactNode;
  width?: string;
}) {
  const { ref, setOpen } = useDialog();
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${TRIGGER_BASE} ${TRIGGER_VARIANT[triggerVariant]}`}
      >
        {triggerLabel}
      </button>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => backdropClose(event, ref.current)}
        className="m-auto w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-ink/30 backdrop:backdrop-blur-[2px]"
        style={{ maxWidth: width }}
      >
        <div className="rise">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[length:var(--text-card)] font-semibold">
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Fermer"
              className="-mr-1 -mt-1 shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-ink-faint transition-colors hover:bg-canvas hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div className="px-5 py-4">{children}</div>
        </div>
      </dialog>
    </>
  );
}

/**
 * §8 DRAWERS — « clic tâche → panneau droit ».
 *
 * Le tiroir garde la liste visible derrière lui : c'est tout son
 * intérêt face à une page pleine. On y met des actions rapides, pas un
 * écran de travail.
 */
export function Drawer({
  triggerLabel,
  triggerVariant = "ghost",
  title,
  description,
  children,
  width = "26rem",
}: {
  triggerLabel: ReactNode;
  triggerVariant?: ButtonVariant;
  title: string;
  description?: string;
  children: ReactNode;
  width?: string;
}) {
  const { ref, setOpen } = useDialog();
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${TRIGGER_BASE} ${TRIGGER_VARIANT[triggerVariant]}`}
      >
        {triggerLabel}
      </button>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => backdropClose(event, ref.current)}
        className="ml-auto mr-0 my-0 h-dvh max-h-none w-[calc(100vw-3rem)] max-w-none rounded-none border-l border-line bg-surface p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-ink/30"
        style={{ width }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[length:var(--text-card)] font-semibold">
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Fermer"
              className="-mr-1 -mt-1 shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-ink-faint transition-colors hover:bg-canvas hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      </dialog>
    </>
  );
}

/**
 * §18 DÉCONNEXION — « Se déconnecter ? / Annuler / Se déconnecter ».
 *
 * La confirmation d'une action irréversible ou coûteuse. Le bouton de
 * confirmation SOUMET un formulaire serveur : l'action reste une Server
 * Action ordinaire, et la modale ne fait que demander « vous êtes
 * sûr ». Une confirmation qui appellerait elle-même une API en
 * JavaScript perdrait la redirection que le routeur sait suivre.
 */
export function ConfirmDialog({
  triggerLabel,
  triggerVariant = "secondary",
  title,
  message,
  confirmLabel,
  confirmVariant = "primary",
  action,
  hidden,
}: {
  triggerLabel: ReactNode;
  triggerVariant?: ButtonVariant;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  action: (formData: FormData) => void | Promise<void>;
  /** Les champs à transmettre à l'action. */
  hidden?: Record<string, string>;
}) {
  const { ref, setOpen } = useDialog();
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${TRIGGER_BASE} ${TRIGGER_VARIANT[triggerVariant]}`}
      >
        {triggerLabel}
      </button>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => backdropClose(event, ref.current)}
        className="m-auto w-[calc(100vw-2rem)] max-w-sm rounded-[var(--radius-card)] border border-line bg-surface p-5 text-ink shadow-[var(--shadow-float)] backdrop:bg-ink/30"
      >
        <div className="rise">
          <h2 id={titleId} className="text-[length:var(--text-card)] font-semibold">
            {title}
          </h2>
          <p className="mt-2 text-[var(--text-body)] text-ink-soft">{message}</p>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => ref.current?.close()}
              className={`${TRIGGER_BASE} ${TRIGGER_VARIANT.secondary}`}
            >
              Annuler
            </button>
            <form action={action}>
              {Object.entries(hidden ?? {}).map(([key, value]) => (
                <input key={key} type="hidden" name={key} value={value} />
              ))}
              <button type="submit" className={`${TRIGGER_BASE} ${TRIGGER_VARIANT[confirmVariant]}`}>
                {confirmLabel}
              </button>
            </form>
          </div>
        </div>
      </dialog>
    </>
  );
}
