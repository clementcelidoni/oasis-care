"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { inviteMember, type InviteResult } from "@/lib/company/teamActions";

/**
 * §14 « Inviter un membre ».
 *
 * Deux champs et rien d'autre : une adresse et un rôle. Tout le reste —
 * nom, poste, téléphone — appartient à la personne invitée, qui le
 * renseignera elle-même ; le demander ici reviendrait à saisir la fiche
 * de quelqu'un à sa place, puis à la voir diverger.
 *
 * Le bouton dit « Créer le lien d'invitation », pas « Envoyer ». C'est
 * exactement ce qui se passe : Oasis n'envoie aucun courriel, le lien
 * apparaît dans la liste juste en dessous et c'est vous qui le
 * transmettez. Un intitulé « Envoyer » ferait attendre un message qui
 * n'arriverait jamais.
 */
const ASSIGNABLE_ROLES = ROLES.filter((role): role is Role => role !== "custom");

const INPUT_CLASS =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent";

export function InviteMemberForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const [state, action] = useActionState<InviteResult, FormData>(inviteMember, {
    status: "idle",
  });

  return (
    <form action={action} className="flex flex-col gap-4 px-5 py-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Adresse e-mail<span className="text-critical"> *</span>
          </span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="prenom.nom@exemple.fr"
            className={INPUT_CLASS}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            L&apos;invitation est nominative : elle ne s&apos;ouvrira qu&apos;avec
            un compte Oasis portant cette adresse.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Rôle</span>
          <select name="role" defaultValue="fieldWorker" className={INPUT_CLASS}>
            {ASSIGNABLE_ROLES.filter((role) => canInviteOwner || role !== "owner").map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Modifiable à tout moment ensuite.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <InviteButton />
        {state.status === "error" && (
          <p className="text-[var(--text-secondary)] text-critical">{state.message}</p>
        )}
        {state.status === "done" && (
          <p className="text-[var(--text-secondary)] text-positive">
            Invitation créée pour {state.email}. Son lien est dans la liste
            ci-dessous — à vous de le transmettre.
          </p>
        )}
      </div>
    </form>
  );
}

function InviteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Création…" : "Créer le lien d'invitation"}
    </button>
  );
}
