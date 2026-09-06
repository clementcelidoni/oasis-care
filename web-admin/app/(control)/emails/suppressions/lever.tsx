"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { ETAT_VIERGE, leverSuppression } from "@/lib/email/actions";
import { CONSEQUENCES_LEVEE } from "@/lib/email/libelles";

/**
 * ==================================================================
 * LEVER UNE SUPPRESSION — et ce que cela n'annule pas
 * ==================================================================
 *
 * L'ADRESSE N'EST NI SAISIE NI TRANSMISE : c'est l'IDENTIFIANT de la
 * ligne affichée qui part, en champ caché. Un champ libre permettrait
 * de lever une suppression sur une adresse qu'on n'a jamais vue — et,
 * tant qu'à faire, sur une adresse choisie ailleurs. Depuis que la
 * liste ne s'affiche que masquée, l'administrateur ne connaît de toute
 * façon plus l'adresse entière : c'est voulu.
 *
 * CE QUE LA LEVÉE NE FAIT PAS, et c'est dit avant le bouton :
 *   • elle ne débloque AUCUN message transactionnel, parce qu'une
 *     suppression n'en a jamais bloqué un seul. Un client qui signale
 *     un devis comme indésirable continue de recevoir ses factures :
 *     c'est le défaut catastrophique que 0084 existe pour empêcher ;
 *   • elle ne lève PAS la liste du transporteur, qui est la sienne. Si
 *     c'est lui qui refuse, le message repartira et sera refusé à
 *     nouveau ;
 *   • elle ne redonne PAS le consentement. Une adresse réhabilitée sans
 *     consentement reste écartée de toute publicité, et c'est correct.
 *
 * La phrase affichée dépend du type, parce que « la boîte n'existe
 * pas » et « la personne a cliqué indésirable » n'appellent pas du tout
 * la même prudence.
 */

const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent";

export function LeverSuppression({ id, type }: { id: string; type: string }) {
  const [etat, action, enCours] = useActionState(leverSuppression, ETAT_VIERGE);
  const [motif, setMotif] = useState("");
  const [ouvert, setOuvert] = useState(false);

  if (!ouvert) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-surface-raised px-3 py-1.5 text-[var(--text-secondary)] font-medium text-ink transition-colors hover:border-ink-faint"
        >
          Lever cette suppression
        </button>
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
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="suppression_id" value={id} />

      <div className="rounded-[var(--radius-card)] border border-warning/35 bg-warning-wash px-3 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
        {CONSEQUENCES_LEVEE[type] ?? "Cette adresse pourra de nouveau recevoir de la publicité."}
      </div>

      <label className="flex max-w-3xl flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Motif <span className="text-critical">*</span>
        </span>
        <textarea
          name="motif"
          rows={2}
          value={motif}
          onChange={(evenement) => setMotif(evenement.target.value)}
          placeholder="« Adresse mal saisie à l'inscription, corrigée par le client le 4 septembre : le rebond ne se reproduira pas. »"
          className={CHAMP}
        />
        <span className="text-[var(--text-secondary)] text-ink-faint">
          Il s&apos;inscrit au journal des actions administratives avec l&apos;adresse masquée.
          Réhabiliter une adresse qui s&apos;est plainte engage la réputation du domaine pour tout
          le parc.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary">{enCours ? "En cours…" : "Lever"}</SubmitButton>
        <button
          type="button"
          onClick={() => setOuvert(false)}
          className="text-[var(--text-secondary)] text-ink-soft hover:text-ink"
        >
          Annuler
        </button>
      </div>

      {etat.statut !== "vierge" && etat.message !== null && (
        <p
          role="status"
          className={`max-w-3xl text-[var(--text-secondary)] leading-relaxed ${
            etat.statut === "erreur" ? "text-critical" : "text-positive"
          }`}
        >
          {etat.message}
        </p>
      )}
    </form>
  );
}
