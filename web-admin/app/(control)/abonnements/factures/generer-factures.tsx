"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { genererFactures } from "@/lib/billing/actions";
import { ETAT_VIERGE } from "@/lib/billing/formulaire";
import { moisCivil } from "@/lib/billing/facture";

/**
 * ==================================================================
 * GÉNÉRER LES FACTURES D'UNE PÉRIODE
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * RELANCER NE DOUBLONNE PAS — ET RECALCULE. LES DEUX SE DISENT.
 * ------------------------------------------------------------------
 * Ce n'est pas la fonction qui promet de ne pas doublonner : c'est un
 * index unique partiel, `saas_invoices_one_per_period_idx`, qui INTERDIT
 * une seconde facture non annulée pour le même couple (entreprise,
 * période). Sans cette phrase à l'écran, personne n'ose relancer, et un
 * mois oublié reste oublié.
 *
 * MAIS « SANS DANGER » ÉTAIT UNE DEMI-VÉRITÉ, et c'est la moitié
 * manquante qui coûtait de l'argent. C'était vrai des DOUBLONS et faux
 * du CONTENU : un brouillon produit avant un changement d'offre gardait
 * les anciens prix et c'est lui qu'on émettait. Depuis 0081 la
 * génération REFAIT les brouillons — elle rend « refreshed » — et ne
 * touche jamais une facture émise. L'écran dit maintenant les deux.
 *
 * ------------------------------------------------------------------
 * DES BROUILLONS PAR DÉFAUT
 * ------------------------------------------------------------------
 * Un document opposable ne part pas sans qu'un humain l'ait regardé au
 * moins une fois. Émettre d'un coup reste possible ; la base n'émettra
 * alors QUE ce que rien ne bloque — un régime de TVA inconnu, un prix
 * absent, une case de matrice non décidée arrêtent l'émission et
 * laissent un brouillon avec son motif.
 *
 * ------------------------------------------------------------------
 * DEUX CYCLES, DEUX GÉNÉRATIONS
 * ------------------------------------------------------------------
 * Les abonnements annuels ne se facturent pas sur un mois civil. Le
 * cycle est donc choisi explicitement plutôt que déduit : mélanger les
 * deux dans un même passage ferait facturer douze mois à quelqu'un qui
 * en doit un.
 */
export function GenererFactures({
  mois,
  peutEcrire,
  role,
}: {
  mois: { annee: number; mois: number; libelle: string }[];
  peutEcrire: boolean;
  role: string;
}) {
  const [etat, action, enCours] = useActionState(genererFactures, ETAT_VIERGE);
  const [choisi, setChoisi] = useState(0);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");

  const periode = mois[choisi];
  const bornes = periode
    ? moisCivil(periode.annee, periode.mois)
    : { debut: "", fin: "" };

  // Un abonnement ANNUEL couvre douze mois à partir du premier jour du
  // mois choisi. La fin reste EXCLUSIVE, comme la contrainte de la base.
  const bornesAnnuelles = periode
    ? {
        debut: bornes.debut,
        fin: moisCivil(periode.annee + 1, periode.mois).debut,
      }
    : bornes;

  const effectives = cycle === "yearly" ? bornesAnnuelles : bornes;

  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none focus:border-accent disabled:opacity-60";

  return (
    <div className="px-4 py-3">
      {!peutEcrire && (
        <p className="mb-3 text-[var(--text-secondary)] text-ink-soft">
          Le rôle « {role} » ne porte pas <code className="font-mono">billing.invoices.write</code>{" "}
          : la génération lui est fermée.
        </p>
      )}

      <form action={action}>
        <input type="hidden" name="debut" value={effectives.debut} />
        <input type="hidden" name="fin" value={effectives.fin} />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Début de période
            </span>
            <select
              value={choisi}
              onChange={(evenement) => setChoisi(Number(evenement.target.value))}
              disabled={!peutEcrire}
              className={champ}
            >
              {mois.map((option, indice) => (
                <option key={`${option.annee}-${option.mois}`} value={indice}>
                  {option.libelle}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Cycle</span>
            <select
              name="cycle"
              value={cycle}
              onChange={(evenement) => setCycle(evenement.target.value as "monthly" | "yearly")}
              disabled={!peutEcrire}
              className={champ}
            >
              <option value="monthly">Mensuel</option>
              <option value="yearly">Annuel</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Émettre tout de suite
            </span>
            <select name="emettre" defaultValue="0" disabled={!peutEcrire} className={champ}>
              <option value="0">Non — produire des brouillons</option>
              <option value="1">Oui — émettre ce qui n&apos;est pas bloqué</option>
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Motif <span className="text-critical">*</span>
            </span>
            <input name="motif" required disabled={!peutEcrire} className={champ} />
          </label>
        </div>

        <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Période facturée : du <strong className="text-ink-soft">{effectives.debut}</strong>{" "}
          (inclus) au <strong className="text-ink-soft">{effectives.fin}</strong> (exclu).{" "}
          <strong className="text-ink-soft">Relancer ne crée aucun doublon</strong> — un index
          unique interdit une seconde facture pour la même entreprise et la même période — et{" "}
          <strong className="text-ink-soft">recalcule les brouillons</strong> : un brouillon suit
          l&apos;abonnement jusqu&apos;à l&apos;émission, changement d&apos;offre et modules
          compris. Une facture <strong className="text-ink-soft">déjà émise ne bouge pas</strong>.
          Les factures annulées sortent du décompte, pour qu&apos;une erreur puisse être refaite.
        </p>
        <p className="mt-1 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Seuls les abonnements « actif » et « impayé » sont facturés. Un essai ne l&apos;est pas —
          c&apos;est le sens d&apos;un essai — et un impayé l&apos;est : un retard de paiement ne
          suspend pas l&apos;abonnement, il s&apos;ajoute à ce qui est dû.
        </p>

        <div className="mt-3">
          <SubmitButton>{enCours ? "Génération…" : "Générer"}</SubmitButton>
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
