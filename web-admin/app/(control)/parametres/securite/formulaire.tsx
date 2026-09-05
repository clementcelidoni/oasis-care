"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { ETAT_VIERGE, reglerPolitiqueMfa } from "@/lib/auth/actions";

/**
 * ==================================================================
 * LE SEUL INTERRUPTEUR DANGEREUX DE CE LOT
 * ==================================================================
 *
 * Il ne l'est pas pour la raison qu'on croit. Depuis que
 * `/second-facteur` porte l'écran d'enrôlement, l'exiger n'enferme plus
 * personne dehors : chacun peut poser son facteur et revenir.
 *
 * IL RESTE UN CAS, ET IL EST RÉEL. Si l'enrôlement TOTP est désactivé au
 * niveau du projet Supabase, plus personne ne peut poser de facteur — et
 * la seule sortie devient `ADMIN_MFA_POLICY=off` dans l'environnement,
 * suivie d'un redéploiement. Cet écran le dit AVANT le bouton, pas dans
 * une note de bas de page.
 *
 * D'où la mécanique : `exige` est une case, et la date de mise en
 * application n'apparaît que si elle est cochée — parce qu'un délai de
 * grâce sans exigence n'existe pas, et que la base le refuse
 * (`platform_security_settings_grace_coherent`). Une saisie que la base
 * refusera ne doit pas être offerte à l'écran.
 */
export function FormulairePolitiqueMfa({
  exigeInitial,
  aPartirDeInitial,
  /** Nombre d'administrateurs actifs SANS facteur vérifié, ou `null` si on n'a pas pu compter. */
  nonProteges,
}: {
  exigeInitial: boolean;
  /** Format `datetime-local`, ou chaîne vide. */
  aPartirDeInitial: string;
  nonProteges: number | null;
}) {
  const [etat, action, enCours] = useActionState(reglerPolitiqueMfa, ETAT_VIERGE);
  const [exige, setExige] = useState(exigeInitial);

  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

  return (
    <form action={action} className="px-4 py-3">
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          name="exige"
          value="oui"
          checked={exige}
          onChange={(evenement) => setExige(evenement.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="min-w-0">
          <span className="block text-[var(--text-body)] font-medium text-ink">
            Exiger un second facteur de tous les administrateurs
          </span>
          <span className="mt-0.5 block max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            Une session sans second facteur pourra encore LIRE — c&apos;est ce qui permet à
            quelqu&apos;un de s&apos;enrôler — mais aucune écriture administrative ne passera. La
            base le vérifie elle-même à chaque appel ; ce n&apos;est pas un réglage d&apos;écran.
          </span>
        </span>
      </label>

      {exige && (
        <label className="mt-4 flex max-w-sm flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            À partir du (facultatif)
          </span>
          <input
            type="datetime-local"
            name="aPartirDe"
            defaultValue={aPartirDeInitial}
            className={champ}
          />
          <span className="text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Un délai de grâce : on annonce l&apos;exigence avant de la faire mordre, ce qui laisse
            à l&apos;équipe le temps de s&apos;enrôler. Vide = tout de suite.
          </span>
        </label>
      )}

      {exige && !exigeInitial && nonProteges !== null && nonProteges > 0 && (
        <p className="mt-4 max-w-3xl rounded-[var(--radius-card)] border border-warning/35 bg-warning-wash px-3 py-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
          <strong className="text-warning">
            {nonProteges} administrateur{nonProteges > 1 ? "s actifs n'ont" : " actif n'a"} pas
            encore de second facteur.
          </strong>{" "}
          {nonProteges > 1 ? "Ils seront renvoyés" : "Il sera renvoyé"} vers l&apos;écran
          d&apos;enrôlement à la prochaine visite et ne pourr{nonProteges > 1 ? "ont" : "a"} plus
          rien écrire d&apos;ici là. Posez une date de mise en application, ou prévenez avant de
          cocher.
        </p>
      )}

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Motif <span className="text-critical">*</span>
        </span>
        <textarea
          name="motif"
          required
          rows={2}
          placeholder="Pourquoi on durcit — ou pourquoi on relâche."
          className={champ}
        />
        <span className="text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Obligatoire, et refusé vide par la base : exiger ou lever le second facteur change qui
          peut agir sur toute la plateforme.
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton variant={exige && !exigeInitial ? "danger" : "primary"}>
          {enCours ? "Enregistrement…" : "Enregistrer la politique"}
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
