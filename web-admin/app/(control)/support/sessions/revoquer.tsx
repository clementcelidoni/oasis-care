"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/ui";
import { ETAT_VIERGE, revoquerSessionAssistance } from "@/lib/support/actions";

/**
 * Fermer une session avant son échéance.
 *
 * COUPER DOIT ÊTRE PLUS FACILE QU'OUVRIR : le formulaire tient sur une
 * ligne, il ne demande qu'un motif, et il est présent partout où une
 * session ouverte s'affiche. C'est la traduction, à l'écran, de ce que
 * 0081 § 8.c fait dans les droits — trois personnes peuvent fermer une
 * session, dont le responsable sécurité qui ne peut pas en ouvrir.
 *
 * IL N'Y A PAS DE CONFIRMATION EN DEUX TEMPS, et c'est délibéré. Une
 * boîte de dialogue avant de FERMER un accès ajoute une seconde à un
 * geste qu'on veut immédiat, pour éviter une erreur dont la
 * conséquence — un accès fermé qu'il faudra rouvrir — est bénigne. Le
 * geste dangereux est l'ouverture, et c'est celui-là qui demande un
 * motif long, une cible et un niveau.
 */
export function FormulaireRevocation({
  sessionId,
  compact = false,
}: {
  sessionId: string;
  /** Dans une liste : le champ et le bouton sur une seule ligne. */
  compact?: boolean;
}) {
  const [etat, action, enCours] = useActionState(revoquerSessionAssistance, ETAT_VIERGE);

  const champ =
    "rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent";

  return (
    <form action={action} className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-col gap-3 px-4 py-4"}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <input
        name="motif"
        required
        placeholder="Pourquoi la fermer maintenant — le client le lira."
        className={compact ? `${champ} min-w-56 flex-1` : `${champ} w-full max-w-3xl`}
        aria-label="Motif de la révocation"
      />
      <SubmitButton variant="danger">{enCours ? "Fermeture…" : "Fermer la session"}</SubmitButton>
      {etat.statut !== "vierge" && etat.message !== null && (
        <p
          role="status"
          className={`text-[var(--text-secondary)] leading-snug ${
            etat.statut === "erreur" ? "text-critical" : "text-positive"
          }`}
        >
          {etat.message}
        </p>
      )}
    </form>
  );
}
