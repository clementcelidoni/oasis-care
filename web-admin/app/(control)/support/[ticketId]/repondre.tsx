"use client";

import { useActionState, useId, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { ETAT_VIERGE, repondreDemande } from "@/lib/support/actions";
import { LIBELLES_STATUT } from "@/lib/support/libelles";
import { STATUTS_TICKET, type StatutTicket } from "@/lib/support/types";

/**
 * ==================================================================
 * RÉPONDRE — une seule boîte, un interrupteur, et une couleur qui change
 * ==================================================================
 *
 * LA FAUTE QU'ON VEUT RENDRE DIFFICILE est celle de tous les outils
 * d'assistance : écrire une note interne dans la réponse au client, ou
 * l'inverse. Deux zones de saisie séparées l'INVITENT — elles se
 * ressemblent, elles sont l'une sous l'autre, et on tape dans celle où
 * le curseur se trouve.
 *
 * Donc : UNE boîte, un interrupteur explicite au-dessus, et le cadre
 * qui change de couleur et de texte d'aide quand il est armé. On ne
 * peut pas se tromper sans l'avoir vu.
 *
 * ET LA PROTECTION N'EST PAS DANS LA COULEUR. La politique de lecture
 * de `support_ticket_messages` (0081 § 8.a) réserve `is_internal = true`
 * aux administrateurs : le client ne peut PAS lire une note interne,
 * même si cette interface se trompait. La couleur évite l'erreur ; la
 * base évite la fuite.
 *
 * ------------------------------------------------------------------
 * POURQUOI UN MOTIF POUR UNE SIMPLE RÉPONSE
 * ------------------------------------------------------------------
 * Parce que `admin_reply_support_ticket()` l'exige (0081 § 8.a) et que
 * la spec p.31 demande que toute action administrative importante soit
 * enregistrée. Répondre au nom d'Oasis Care en est une : c'est un
 * engagement pris auprès d'un client, et le journal doit pouvoir dire
 * qui l'a pris et pourquoi.
 */

const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

export function FormulaireReponse({
  ticketId,
  statutActuel,
  dejaAssigne,
}: {
  ticketId: string;
  statutActuel: StatutTicket;
  /** Vrai si la demande est déjà à mon nom : on ne propose pas de se l'assigner deux fois. */
  dejaAssigne: boolean;
}) {
  const [etat, action, enCours] = useActionState(repondreDemande, ETAT_VIERGE);
  const [interne, setInterne] = useState(false);
  const identifiantCorps = useId();

  return (
    <form action={action} className="flex flex-col gap-4 px-4 py-4">
      <input type="hidden" name="ticketId" value={ticketId} />

      <label className="flex w-fit items-center gap-2">
        <input
          type="checkbox"
          name="interne"
          checked={interne}
          onChange={(evenement) => setInterne(evenement.target.checked)}
          className="h-4 w-4 accent-warning"
        />
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Note interne — le client ne la verra pas
        </span>
      </label>

      <label className="flex flex-col gap-1.5" htmlFor={identifiantCorps}>
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          {interne ? "Note interne" : "Réponse au client"}{" "}
          <span className="text-critical">*</span>
        </span>
        <textarea
          id={identifiantCorps}
          name="corps"
          required
          rows={6}
          placeholder={
            interne
              ? "Ce que l'équipe doit savoir et que le client n'a pas à lire."
              : "Ce que le client va lire, signé Oasis Care."
          }
          className={`${CHAMP} ${
            interne ? "border-warning bg-warning-wash focus:border-warning" : ""
          }`}
        />
        <span className="text-[var(--text-secondary)] text-ink-faint">
          {interne
            ? "Réservée aux administrateurs par la politique de lecture de la base, pas par cet écran."
            : "Ce texte part au nom d'Oasis Care et reste dans la conversation du client."}
        </span>
      </label>

      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Statut après cette réponse
          </span>
          <select name="statut" defaultValue={statutActuel} className={CHAMP}>
            {STATUTS_TICKET.map((statut) => (
              <option key={statut} value={statut}>
                {LIBELLES_STATUT[statut]}
                {statut === statutActuel ? " (inchangé)" : ""}
              </option>
            ))}
          </select>
        </label>

        {!dejaAssigne && (
          <label className="flex items-center gap-2 self-end pb-1.5">
            <input type="checkbox" name="assigner" className="h-4 w-4 accent-accent" />
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Me l&apos;assigner
            </span>
          </label>
        )}
      </div>

      <label className="flex max-w-3xl flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Motif <span className="text-critical">*</span>
        </span>
        <input
          name="motif"
          required
          placeholder="Pourquoi cette réponse, ce statut. Le journal des actions administratives le conserve."
          className={CHAMP}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>
          {enCours ? "Envoi…" : interne ? "Enregistrer la note" : "Répondre au client"}
        </SubmitButton>
        {etat.statut !== "vierge" && etat.message !== null && (
          <p
            role="status"
            className={`max-w-2xl text-[var(--text-secondary)] leading-snug ${
              etat.statut === "erreur" ? "text-critical" : "text-positive"
            }`}
          >
            {etat.message}
          </p>
        )}
      </div>
    </form>
  );
}
