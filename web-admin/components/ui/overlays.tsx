"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ButtonVariant } from "./primitives";

/**
 * Modales et tiroirs, sur `<dialog>` natif.
 *
 * Ce n'est pas un détail de confort : l'élément apporte le piégeage du
 * focus, la fermeture à Échap, l'inertie du reste de la page pour les
 * lecteurs d'écran et le calque de fond. Reconstruire tout cela à la
 * main, c'est la façon habituelle d'obtenir une boîte de dialogue dont
 * on ne peut pas sortir au clavier.
 *
 * DANS CETTE APPLICATION, la modale a un rôle de plus : elle est
 * l'endroit où l'on demande un MOTIF. Le journal d'audit administratif
 * (`admin_audit_events`) rend `reason` obligatoire et non vide —
 * `record_admin_event()` refuse d'écrire sans lui. Toute action
 * administrative future passera donc par `ConfirmDialog`, qui porte le
 * champ de motif.
 */

const TRIGGER_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 py-1.5 text-[var(--text-secondary)] font-medium transition-colors";

const TRIGGER_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface-raised text-ink hover:border-ink-faint",
  ghost: "text-ink-soft hover:bg-surface-raised hover:text-ink",
  danger: "border border-critical/40 bg-critical-wash text-critical hover:border-critical",
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

  // La fermeture peut venir de l'intérieur — Échap, ou un clic sur le
  // fond. Sans cet écouteur, l'état React resterait « ouvert » et le
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
  triggerTitle,
  triggerVariant = "secondary",
  title,
  description,
  children,
  width = "30rem",
}: {
  triggerLabel: ReactNode;
  /** Le nom accessible du déclencheur, quand son contenu visible est un symbole. */
  triggerTitle?: string;
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
        aria-label={triggerTitle}
        title={triggerTitle}
        className={`${TRIGGER_BASE} ${TRIGGER_VARIANT[triggerVariant]}`}
      >
        {triggerLabel}
      </button>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => backdropClose(event, ref.current)}
        className="m-auto w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border border-line-strong bg-surface p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-black/60"
        style={{ maxWidth: width }}
      >
        <div className="rise">
          <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
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
              className="-mr-1 -mt-1 shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-ink-faint transition-colors hover:bg-surface-raised hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div className="px-4 py-3">{children}</div>
        </div>
      </dialog>
    </>
  );
}

/**
 * Le tiroir garde la liste visible derrière lui : c'est tout son
 * intérêt face à une page pleine. On y met le détail d'une ligne, pas
 * un écran de travail.
 */
export function Drawer({
  triggerLabel,
  triggerTitle,
  triggerVariant = "ghost",
  title,
  description,
  children,
  width = "28rem",
}: {
  triggerLabel: ReactNode;
  triggerTitle?: string;
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
        aria-label={triggerTitle}
        title={triggerTitle}
        className={`${TRIGGER_BASE} ${TRIGGER_VARIANT[triggerVariant]}`}
      >
        {triggerLabel}
      </button>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => backdropClose(event, ref.current)}
        className="my-0 ml-auto mr-0 h-dvh max-h-none w-[calc(100vw-3rem)] max-w-none rounded-none border-l border-line-strong bg-surface p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-black/60"
        style={{ width }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
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
              className="-mr-1 -mt-1 shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-ink-faint transition-colors hover:bg-surface-raised hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </div>
      </dialog>
    </>
  );
}

/**
 * La confirmation d'une action, avec son MOTIF.
 *
 * `requireReason` n'est pas une option de confort : `record_admin_event`
 * refuse d'écrire une ligne de journal sans motif non vide, et toute
 * action administrative importante doit être journalisée (spec p.31).
 * Le champ est donc `required` côté navigateur ET la base refuse
 * derrière — la validation du formulaire est une politesse, pas la
 * garantie.
 *
 * Le bouton de confirmation SOUMET un formulaire serveur : l'action
 * reste une Server Action ordinaire, et la modale ne fait que demander
 * « vous êtes sûr, et pourquoi ». Une confirmation qui appellerait
 * elle-même une API en JavaScript perdrait la redirection que le
 * routeur sait suivre.
 */
export function ConfirmDialog({
  triggerLabel,
  triggerTitle,
  triggerVariant = "secondary",
  title,
  message,
  confirmLabel,
  confirmVariant = "primary",
  action,
  hidden,
  requireReason = false,
  reasonLabel = "Motif (consigné au journal)",
}: {
  triggerLabel: ReactNode;
  triggerTitle?: string;
  triggerVariant?: ButtonVariant;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  action: (formData: FormData) => void | Promise<void>;
  /** Les champs à transmettre à l'action. */
  hidden?: Record<string, string>;
  /** Ajoute le champ `reason`, obligatoire. */
  requireReason?: boolean;
  reasonLabel?: string;
}) {
  const { ref, setOpen } = useDialog();
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={triggerTitle}
        title={triggerTitle}
        className={`${TRIGGER_BASE} ${TRIGGER_VARIANT[triggerVariant]}`}
      >
        {triggerLabel}
      </button>

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        onClick={(event) => backdropClose(event, ref.current)}
        className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-[var(--radius-card)] border border-line-strong bg-surface p-4 text-ink shadow-[var(--shadow-float)] backdrop:bg-black/60"
      >
        <div className="rise">
          <h2 id={titleId} className="text-[length:var(--text-card)] font-semibold">
            {title}
          </h2>
          <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">{message}</p>

          <form action={action}>
            {Object.entries(hidden ?? {}).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}

            {requireReason && (
              <label className="mt-4 flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  {reasonLabel} <span className="text-critical">*</span>
                </span>
                <textarea
                  name="reason"
                  required
                  rows={3}
                  placeholder="Pourquoi cette action, maintenant."
                  className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-2 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </label>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => ref.current?.close()}
                className={`${TRIGGER_BASE} ${TRIGGER_VARIANT.secondary}`}
              >
                Annuler
              </button>
              <button
                type="submit"
                className={`${TRIGGER_BASE} ${TRIGGER_VARIANT[confirmVariant]}`}
              >
                {confirmLabel}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
