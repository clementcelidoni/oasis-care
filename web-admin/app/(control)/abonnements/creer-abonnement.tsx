"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { creerAbonnement } from "@/lib/billing/actions";
import { ETAT_VIERGE } from "@/lib/billing/formulaire";
import type { Entreprise, LigneOffre } from "@/lib/billing/types";

/**
 * ==================================================================
 * CRÉER UN ABONNEMENT — à la main, et l'écran le dit
 * ==================================================================
 *
 * RIEN DANS LE PRODUIT NE CRÉE D'ABONNEMENT. `startCheckout` de
 * `web-pro` rend délibérément « unavailable » : aucun encaissement
 * n'est branché. L'administrateur EST donc la source, et ce formulaire
 * est le seul chemin.
 *
 * `provider` vaudra 'manual' en base. C'est la vérité, et elle sera
 * lisible sur la fiche : écrire 'web' laisserait croire à un paiement
 * en ligne qui n'existe pas, et le jour où le prestataire arrivera on
 * ne saurait plus distinguer les lignes saisies des lignes encaissées.
 *
 * ------------------------------------------------------------------
 * LE PRIX NÉGOCIÉ N'APPARAÎT QUE POUR UNE OFFRE SUR DEVIS
 * ------------------------------------------------------------------
 * Et c'est la base qui l'impose, dans les deux sens : une offre sur
 * devis SANS prix négocié est refusée (« elle ne se souscrit pas sans
 * prix »), une offre à prix public AVEC prix négocié l'est aussi (« deux
 * vérités concurrentes sur la même facture »). L'écran suit, plutôt que
 * d'envoyer un champ que le déclencheur rejettera.
 */
export function CreerAbonnement({
  entreprises,
  offres,
  peutEcrire,
  role,
}: {
  entreprises: Entreprise[];
  offres: LigneOffre[];
  peutEcrire: boolean;
  role: string;
}) {
  const [etat, action, enCours] = useActionState(creerAbonnement, ETAT_VIERGE);
  const [offreChoisie, setOffreChoisie] = useState(offres[0]?.key ?? "");

  const offre = offres.find((candidate) => candidate.key === offreChoisie);
  const surDevis = offre?.is_quote_only === true;

  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

  if (entreprises.length === 0) {
    return (
      <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
        Aucune entreprise sans abonnement : il n&apos;y a rien à créer.
      </p>
    );
  }

  return (
    <div className="px-4 py-3">
      {!peutEcrire && (
        <p className="mb-3 text-[var(--text-secondary)] text-ink-soft">
          Le rôle « {role} » ne porte pas{" "}
          <code className="font-mono">billing.subscriptions.write</code> : la création
          d&apos;abonnement lui est fermée.
        </p>
      )}

      <form action={action}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Entreprise
            </span>
            <select name="organizationId" disabled={!peutEcrire} className={champ}>
              {entreprises.map((entreprise) => (
                <option key={entreprise.id} value={entreprise.id}>
                  {entreprise.nom}
                  {entreprise.archiveeLe ? " (archivée)" : ""}
                </option>
              ))}
            </select>
            <span className="text-[var(--text-secondary)] text-ink-faint">
              Seules les entreprises sans abonnement sont listées : la table n&apos;en porte
              qu&apos;un par entreprise.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Offre</span>
            <select
              name="plan"
              value={offreChoisie}
              onChange={(evenement) => setOffreChoisie(evenement.target.value)}
              disabled={!peutEcrire}
              className={champ}
            >
              {offres.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.name}
                  {candidate.is_quote_only ? " (sur devis)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Cycle</span>
            <select name="cycle" disabled={!peutEcrire} className={champ}>
              <option value="monthly">Mensuel</option>
              <option value="yearly">Annuel</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Statut</span>
            <select name="statut" defaultValue="trialing" disabled={!peutEcrire} className={champ}>
              <option value="trialing">En essai</option>
              <option value="active">Actif</option>
              <option value="pastDue">Impayé</option>
            </select>
            <span className="text-[var(--text-secondary)] text-ink-faint">
              Un essai n&apos;est pas facturé — c&apos;est le sens d&apos;un essai.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Jours d&apos;essai
            </span>
            <input
              name="joursEssai"
              disabled={!peutEcrire}
              inputMode="numeric"
              placeholder="aucun"
              className={champ}
            />
          </label>

          {surDevis && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Prix mensuel négocié (€)
                </span>
                <input
                  name="negocieMensuel"
                  disabled={!peutEcrire}
                  inputMode="decimal"
                  className={champ}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Prix annuel négocié (€)
                </span>
                <input
                  name="negocieAnnuel"
                  disabled={!peutEcrire}
                  inputMode="decimal"
                  className={champ}
                />
              </label>
            </>
          )}
        </div>

        {surDevis && (
          <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            « {offre?.name} » est une offre sur devis :{" "}
            {offre?.price_floor_cents === null
              ? "elle n'a pas de plancher enregistré"
              : `son plancher commercial est de ${((offre?.price_floor_cents ?? 0) / 100).toFixed(2).replace(".", ",")} €`}
            , ce qui n&apos;est <strong className="text-ink">pas</strong> un prix. Le montant
            négocié saisi ici est celui que la facture reprendra.
          </p>
        )}

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Motif <span className="text-critical">*</span>
          </span>
          <input
            name="motif"
            disabled={!peutEcrire}
            required
            placeholder="Un abonnement créé à la main engage une facturation"
            className={champ}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton>{enCours ? "Création…" : "Créer l'abonnement"}</SubmitButton>
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Deux traces dans la même transaction : le journal administratif, et l&apos;historique de
            cet abonnement.
          </span>
        </div>
      </form>

      {etat.statut !== "vierge" && etat.message !== null && (
        <p
          role="status"
          className={`mt-3 rounded-[var(--radius-card)] border px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed ${
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
