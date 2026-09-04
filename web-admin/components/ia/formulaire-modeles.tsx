"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/ui";
import { ETAT_VIERGE, enregistrerModeles } from "@/lib/ia/actions";
import { CHOIX_PRODUIT } from "@/lib/ia/carte";
import { LIBELLES_NIVEAU, NIVEAUX, type Niveau } from "@/lib/ia/modeles";

/**
 * ==================================================================
 * LE FORMULAIRE DES QUATRE AGENTS SURCHARGEABLES
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * QUATRE OPTIONS PAR AGENT, ET LA PREMIÈRE N'EST PAS UN NIVEAU
 * ------------------------------------------------------------------
 * « Suivre le produit » n'est pas la même chose que « le niveau que le
 * produit donne aujourd'hui » : la première suit les évolutions, la
 * seconde FIGE un identifiant littéral. Un sélecteur à trois entrées
 * obligerait à choisir une valeur figée pour dire « je ne veux rien
 * changer » — c'est-à-dire à créer, par la seule forme du formulaire,
 * la surcharge décrochée que tout cet écran surveille.
 *
 * ------------------------------------------------------------------
 * UN SEUL MOTIF POUR LES QUATRE, ET PLUSIEURS LIGNES DE JOURNAL
 * ------------------------------------------------------------------
 * Le geste réel est « on descend cette entreprise d'un cran pendant
 * l'incident », pas quatre décisions indépendantes. Demander quatre
 * fois la même phrase produirait quatre motifs recopiés à la va-vite,
 * c'est-à-dire quatre motifs inutiles. La granularité de la TRACE, elle,
 * reste celle de la base : un acte par agent, avec son avant et son
 * après.
 *
 * ------------------------------------------------------------------
 * CE COMPOSANT NE DÉCIDE DE RIEN
 * ------------------------------------------------------------------
 * Il n'envoie pas d'« ancienne valeur » : la Server Action relit l'état
 * en base et compare elle-même. Un onglet resté ouvert une heure
 * écraserait sinon le travail d'un collègue avec un état périmé — et
 * une valeur précédente reçue du navigateur est une valeur que le
 * navigateur peut choisir.
 */

export type LigneFormulaireModele = {
  /** La graphie de la base : `finance`, `quote_pricing`… */
  cleSql: string;
  libelle: string;
  mission: string;
  /** Le niveau que le produit livre pour cet agent. */
  niveauProduit: Niveau;
  /** L'identifiant qui s'appliquerait sans surcharge. */
  modeleProduit: string;
  /** `produit`, un niveau, ou `null` pour une surcharge décrochée. */
  choixCourant: string | null;
  /** L'identifiant réellement en vigueur aujourd'hui. */
  modeleEffectif: string;
  decrochee: boolean;
};

export function FormulaireModeles({
  organizationId,
  lignes,
  peutEcrire,
  modelesParNiveau,
}: {
  organizationId: string;
  lignes: LigneFormulaireModele[];
  peutEcrire: boolean;
  modelesParNiveau: Record<Niveau, string>;
}) {
  const [etat, action, enCours] = useActionState(enregistrerModeles, ETAT_VIERGE);

  return (
    <form action={action}>
      <input type="hidden" name="organizationId" value={organizationId} />

      <ul className="divide-y divide-line">
        {lignes.map((ligne) => (
          <li key={ligne.cleSql} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-ink">{ligne.libelle}</p>
                <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                  {ligne.mission}
                </p>
                <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
                  Aujourd&apos;hui :{" "}
                  <code className="font-mono text-[11px]">{ligne.modeleEffectif}</code>
                  {ligne.decrochee && (
                    <span className="ml-2 text-critical">
                      — cet identifiant ne correspond à aucun des trois niveaux en vigueur.
                      Choisir un niveau le remplacera.
                    </span>
                  )}
                </p>
              </div>

              <label className="flex shrink-0 flex-col gap-1.5">
                <span className="sr-only">Niveau de {ligne.libelle}</span>
                <select
                  name={`agent.${ligne.cleSql}`}
                  defaultValue={ligne.choixCourant ?? CHOIX_PRODUIT}
                  disabled={!peutEcrire}
                  className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none focus:border-accent disabled:opacity-60"
                >
                  <option value={CHOIX_PRODUIT}>
                    Suivre le produit ({LIBELLES_NIVEAU[ligne.niveauProduit]} —{" "}
                    {ligne.modeleProduit})
                  </option>
                  {NIVEAUX.map((niveau) => (
                    <option key={niveau} value={niveau}>
                      Imposer {LIBELLES_NIVEAU[niveau]} ({modelesParNiveau[niveau]})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-4 py-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Motif <span className="text-critical">*</span>
          </span>
          <textarea
            name="motif"
            required
            rows={2}
            disabled={!peutEcrire}
            placeholder="Pourquoi cette entreprise déroge — la phrase part dans le journal ET dans la colonne reason."
            className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60"
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Obligatoire, et refusé vide par la base : changer de modèle change la facture de
            l&apos;éditeur. Le même texte alimente le journal administratif et la colonne{" "}
            <code className="font-mono text-[11px]">reason</code> — deux champs distincts
            produiraient deux vérités qui divergent au premier copier-coller.
          </span>
        </label>

        {peutEcrire && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SubmitButton>{enCours ? "Enregistrement…" : "Enregistrer et journaliser"}</SubmitButton>
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
      </div>
    </form>
  );
}
