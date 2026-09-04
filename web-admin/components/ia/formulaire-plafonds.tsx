"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/ui";
import { ETAT_VIERGE, enregistrerPlafonds, retirerPlafonds } from "@/lib/ia/actions";

/**
 * ==================================================================
 * LES TROIS PLAFONDS, ET LES DEUX FAÇONS DE NE PLUS RIEN BORNER
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * VIDE, ZÉRO, ET POURQUOI ILS NE SE RESSEMBLENT PAS
 * ------------------------------------------------------------------
 *   champ VIDE  → la colonne vaut NULL, c'est-à-dire AUCUNE LIMITE.
 *                 La dépense n'est plus bornée.
 *   champ à 0   → un plafond à zéro, c'est-à-dire l'IA COUPÉE pour
 *                 cette entreprise. Aucun appel ne passera.
 *
 * Les deux sont des réglages légitimes, et ils sont opposés. C'est
 * pourquoi une saisie illisible — « 12,5O » avec la lettre O, un espace
 * insécable collé depuis un tableur — est REFUSÉE côté serveur plutôt
 * que ramenée à zéro : une frappe malheureuse ne doit jamais pouvoir
 * éteindre l'IA d'une entreprise en silence. Personne ne relierait la
 * panne du lendemain matin à la saisie de la veille.
 *
 * ------------------------------------------------------------------
 * DEUX BOUTONS, ET DEUX TRACES DIFFÉRENTES
 * ------------------------------------------------------------------
 * « Enregistrer » avec trois champs vides et « Retirer les plafonds »
 * produisent le même EFFET — plus aucune borne — mais pas la même
 * histoire : `aiCostLimit.set` avec trois nuls dit « quelqu'un a
 * délibérément enregistré aucune limite », `aiCostLimit.cleared` dit
 * « la ligne a disparu ». Le journal doit pouvoir les raconter
 * séparément, donc l'écran garde les deux gestes distincts.
 *
 * Le second est le plus dangereux du lot ; il est donc en second, en
 * ton d'alerte, et avec son propre motif.
 */

export function FormulairePlafonds({
  organizationId,
  jour,
  mois,
  parAgent,
  ligneExistante,
  peutEcrire,
}: {
  organizationId: string;
  /** Déjà formatés en euros, ou chaîne vide pour « aucun plafond ». */
  jour: string;
  mois: string;
  parAgent: string;
  /** Vrai s'il existe une ligne dans `ai_cost_limits` — donc quelque chose à retirer. */
  ligneExistante: boolean;
  peutEcrire: boolean;
}) {
  const [etat, action, enCours] = useActionState(enregistrerPlafonds, ETAT_VIERGE);
  const [etatRetrait, actionRetrait, retraitEnCours] = useActionState(
    retirerPlafonds,
    ETAT_VIERGE,
  );

  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

  return (
    <div>
      <form action={action} className="px-4 py-3">
        <input type="hidden" name="organizationId" value={organizationId} />

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Par jour, toute l&apos;entreprise
            </span>
            <input
              name="jour"
              defaultValue={jour}
              disabled={!peutEcrire}
              inputMode="decimal"
              placeholder="vide = aucun plafond"
              className={champ}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Par mois, toute l&apos;entreprise
            </span>
            <input
              name="mois"
              defaultValue={mois}
              disabled={!peutEcrire}
              inputMode="decimal"
              placeholder="vide = aucun plafond"
              className={champ}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Par agent et par mois
            </span>
            <input
              name="parAgent"
              defaultValue={parAgent}
              disabled={!peutEcrire}
              inputMode="decimal"
              placeholder="vide = aucun plafond"
              className={champ}
            />
          </label>
        </div>

        <p className="mt-2 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Montants en euros. <strong className="text-ink-soft">Un champ vide retire le
          plafond</strong> : la dépense n&apos;est alors plus limitée.{" "}
          <strong className="text-ink-soft">Zéro coupe l&apos;IA</strong> : aucun appel ne
          passera. Les deux sont des réglages valides, et ce ne sont pas les mêmes — une saisie
          qui ne se lit pas est refusée plutôt que ramenée à zéro.
        </p>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Motif <span className="text-critical">*</span>
          </span>
          <textarea
            name="motif"
            required
            rows={2}
            disabled={!peutEcrire}
            placeholder="Pourquoi ce plafond, ou pourquoi ce retrait."
            className={champ}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Obligatoire, et refusé vide par la base : un plafond posé ou levé sans raison est un
            plafond que personne n&apos;ose plus toucher.
          </span>
        </label>

        {peutEcrire && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SubmitButton>{enCours ? "Enregistrement…" : "Enregistrer les trois plafonds"}</SubmitButton>
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
          </div>
        )}
      </form>

      {peutEcrire && ligneExistante && (
        <form action={actionRetrait} className="border-t border-line px-4 py-3">
          <input type="hidden" name="organizationId" value={organizationId} />

          <p className="text-[var(--text-secondary)] font-medium text-ink">
            Retirer entièrement la ligne de plafonds
          </p>
          <p className="mt-0.5 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            Après ce geste, cette entreprise dépense sans borne. Il reste possible — il faut
            pouvoir défaire — mais il est nominatif, motivé et daté. Il se distingue de « trois
            champs vides » dans le journal, et c&apos;est voulu.
          </p>

          <label className="mt-2 flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Motif du retrait <span className="text-critical">*</span>
            </span>
            <textarea
              name="motif"
              required
              rows={2}
              placeholder="Retirer tout plafond, c'est accepter une dépense sans borne — la raison doit être écrite."
              className={champ}
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SubmitButton variant="danger">
              {retraitEnCours ? "Retrait…" : "Retirer les plafonds"}
            </SubmitButton>
            {etatRetrait.statut !== "vierge" && etatRetrait.message !== null && (
              <p
                role="status"
                className={`text-[var(--text-secondary)] leading-snug ${
                  etatRetrait.statut === "erreur" ? "text-critical" : "text-positive"
                }`}
              >
                {etatRetrait.message}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
