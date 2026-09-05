"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/ui";
import { enregistrerTarif } from "@/lib/billing/actions";
import { ETAT_VIERGE } from "@/lib/billing/formulaire";
import type { LigneOffre } from "@/lib/billing/types";

/**
 * ==================================================================
 * MODIFIER LES PRIX D'UNE OFFRE
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * LA SÉMANTIQUE DU CHAMP VIDE, ET ELLE N'EST PAS LA MÊME PARTOUT
 * ------------------------------------------------------------------
 * Sur CET écran :
 *   PRIX MENSUEL / PRIX ANNUEL vide → le prix est EFFACÉ (NULL). Une
 *     offre sans prix ne peut plus être facturée, et le MRR du tableau
 *     de bord redevient inconnu. C'est un geste, pas un oubli.
 *   SIÈGES, SIÈGE SUPPLÉMENTAIRE, QUOTA IA, STOCKAGE vide → ON NE
 *     TOUCHE PAS. La fonction SQL fait `coalesce(p_x, x)` : omettre,
 *     c'est laisser tel quel.
 *
 * Les deux sémantiques cohabitent parce que la base les distingue, et
 * l'écran doit l'épouser exactement plutôt que de choisir une règle
 * uniforme qui mentirait sur la moitié des champs. Chaque champ porte
 * donc son propre texte d'aide.
 *
 * C'EST L'INVERSE DE L'ÉCRAN DES PLAFONDS IA, où un champ vide RETIRE
 * le plafond. La comparaison vaut d'être connue avant de « rendre les
 * deux écrans cohérents ».
 *
 * ------------------------------------------------------------------
 * UN SEUL ÉTAT DE FORMULAIRE POUR TOUTES LES OFFRES
 * ------------------------------------------------------------------
 * Les cinq formulaires partagent un `useActionState`. C'est délibéré :
 * un état par offre multiplierait par cinq le code sans rien apporter,
 * et le message de la base nomme déjà l'offre concernée. On n'enregistre
 * d'ailleurs qu'une offre à la fois — le geste réel est « je change le
 * prix de Pro », pas « je refais la grille ».
 */
export function EditeurGrille({
  offres,
  peutEcrire,
  role,
}: {
  offres: LigneOffre[];
  peutEcrire: boolean;
  role: string;
}) {
  const [etat, action, enCours] = useActionState(enregistrerTarif, ETAT_VIERGE);

  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

  return (
    <div className="flex flex-col gap-2">
      {!peutEcrire && (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface-sunken px-4 py-2.5 text-[var(--text-secondary)] text-ink-soft">
          Le rôle « {role} » ne porte pas <code className="font-mono">billing.plans.write</code> :
          la grille est en lecture seule. Les champs ci-dessous sont désactivés, et la base
          refuserait de toute façon l&apos;écriture.
        </p>
      )}

      {offres.map((offre) => (
        <details
          key={offre.key}
          className="rounded-[var(--radius-card)] border border-line bg-surface"
        >
          <summary className="cursor-pointer list-none px-4 py-2.5 text-[var(--text-body)] font-medium text-ink-soft hover:text-ink">
            Modifier « {offre.name} »
            {offre.is_quote_only && (
              <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-faint">
                — sur devis : pas de prix public
              </span>
            )}
          </summary>

          <form action={action} className="border-t border-line px-4 py-3">
            <input type="hidden" name="planKey" value={offre.key} />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Prix mensuel (€)
                </span>
                <input
                  name="prixMensuel"
                  defaultValue={euros(offre.monthly_price_cents)}
                  disabled={!peutEcrire || offre.is_quote_only}
                  inputMode="decimal"
                  placeholder="vide = aucun prix"
                  className={champ}
                />
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  Vide <strong className="text-ink-soft">efface</strong> le prix.
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Prix annuel (€)
                </span>
                <input
                  name="prixAnnuel"
                  defaultValue={euros(offre.yearly_price_cents)}
                  disabled={!peutEcrire || offre.is_quote_only}
                  inputMode="decimal"
                  placeholder="vide = aucun prix"
                  className={champ}
                />
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  Vide <strong className="text-ink-soft">efface</strong> le prix.
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Siège supplémentaire (€ / mois)
                </span>
                <input
                  name="prixSiege"
                  defaultValue={euros(offre.extra_seat_monthly_price_cents)}
                  disabled={!peutEcrire}
                  inputMode="decimal"
                  className={champ}
                />
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  Vide = <strong className="text-ink-soft">ne change pas</strong>.
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Sièges compris
                </span>
                <input
                  name="siegesInclus"
                  defaultValue={offre.included_seats ?? ""}
                  disabled={!peutEcrire}
                  inputMode="numeric"
                  placeholder="non décidé"
                  className={champ}
                />
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  Vide = <strong className="text-ink-soft">ne change pas</strong>. Nul en base veut
                  dire NON DÉCIDÉ, pas « illimité ».
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Quota IA mensuel
                </span>
                <input
                  name="quotaIa"
                  defaultValue={offre.ai_monthly_quota ?? ""}
                  disabled={!peutEcrire}
                  inputMode="numeric"
                  placeholder="non décidé"
                  className={champ}
                />
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  Vide = <strong className="text-ink-soft">ne change pas</strong>.
                </span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Stockage compris (Go)
                </span>
                <input
                  name="stockageGo"
                  defaultValue={offre.storage_gb ?? ""}
                  disabled={!peutEcrire}
                  inputMode="numeric"
                  placeholder="non décidé"
                  className={champ}
                />
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  Vide = <strong className="text-ink-soft">ne change pas</strong>.
                </span>
              </label>
            </div>

            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input
                name="motif"
                disabled={!peutEcrire}
                required
                placeholder="Pourquoi ce prix change — le journal le conservera"
                className={champ}
              />
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <SubmitButton>{enCours ? "Enregistrement…" : "Enregistrer le tarif"}</SubmitButton>
              <span className="text-[var(--text-secondary)] text-ink-faint">
                Journalisé : administrateur, ancien prix, nouveau prix, motif.
              </span>
            </div>
          </form>
        </details>
      ))}

      {etat.statut !== "vierge" && etat.message !== null && (
        <p
          role="status"
          className={`rounded-[var(--radius-card)] border px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed ${
            etat.statut === "ok"
              ? "border-positive/35 bg-positive-wash text-positive"
              : "border-critical/40 bg-critical-wash text-critical"
          }`}
        >
          {etat.message}
        </p>
      )}
    </div>
  );
}

/**
 * Des centimes vers un champ en euros.
 *
 * `null` devient la chaîne VIDE, jamais « 0 » : rouvrir le formulaire
 * d'une offre sans prix et y trouver des zéros ferait enregistrer
 * « offre gratuite » au premier clic.
 */
function euros(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
