"use client";

import { useActionState, useState } from "react";
import type { ReactNode } from "react";

import { SubmitButton } from "@/components/ui";
import {
  accorderCredit,
  annulerALEcheance,
  appliquerRemiseAuClient,
  basculerModule,
  changerOffre,
  enregistrerRegimeClient,
  fixerSiegesFactures,
  prolongerEssai,
  reactiverAbonnement,
} from "@/lib/billing/actions";
import { ETAT_VIERGE, type EtatFormulaire } from "@/lib/billing/formulaire";
import { LIBELLES_REGIME_TVA } from "@/lib/billing/facture";
import { LIBELLES_DISPONIBILITE, cleDeCase, indexerMatrice } from "@/lib/billing/grille";
import type {
  Disponibilite,
  LigneAbonnement,
  LigneCase,
  LigneModule,
  LigneModuleSouscrit,
  LigneOffre,
  LigneOffreDeRemise,
  RegimeTvaClient,
} from "@/lib/billing/types";

/**
 * ==================================================================
 * LES GESTES D'ADMINISTRATION D'UN ABONNEMENT — spec p.13
 * ==================================================================
 *
 * Changer d'offre · prolonger l'essai · fixer les sièges facturés en
 * plus · accorder un crédit · activer un module · retirer un module ·
 * annuler à l'échéance · réactiver · appliquer une remise. Plus le
 * régime de TVA du client, qui n'est pas un geste d'abonnement mais
 * sans lequel aucune facture ne partira.
 *
 * « Sièges facturés en plus » ne figure pas dans les sept de la spec.
 * Il est là parce que le prix du siège supplémentaire est semé sur les
 * quatre offres et PUBLIÉ sur la grille : sans ce geste, on affichait
 * un prix que personne ne pouvait appliquer à qui que ce soit.
 *
 * ------------------------------------------------------------------
 * CHAQUE GESTE A SON PROPRE MOTIF, ET C'EST VOULU
 * ------------------------------------------------------------------
 * Un motif commun à huit gestes deviendrait « RAS » au troisième. La
 * base l'exige geste par geste ; l'écran ne cherche pas à contourner
 * cette exigence en la mutualisant.
 *
 * ------------------------------------------------------------------
 * AUCUN BOUTON N'EST UNE SÉCURITÉ
 * ------------------------------------------------------------------
 * Ce qui est grisé ici est refusé en base de toute façon : permission,
 * second facteur, motif, et les règles métier — un module non livré ne
 * se souscrit pas, une case non décidée bloque, une offre sur devis
 * exige un prix négocié. On ne fait que ne pas promettre ce qui sera
 * refusé, et afficher le refus quand il tombe.
 */

const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

function Retour({ etat }: { etat: EtatFormulaire }) {
  if (etat.statut === "vierge" || etat.message === null) return null;
  return (
    <p
      role="status"
      className={`mt-3 rounded-[var(--radius-card)] border px-3 py-2 text-[var(--text-secondary)] leading-relaxed ${
        etat.statut === "ok"
          ? "border-positive/35 bg-positive-wash text-positive"
          : "border-critical/40 bg-critical-wash text-critical"
      }`}
    >
      {etat.message}
    </p>
  );
}

function Bloc({
  titre,
  description,
  children,
}: {
  titre: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details className="border-b border-line last:border-0">
      <summary className="cursor-pointer list-none px-4 py-2.5 hover:bg-surface-raised">
        <span className="text-[var(--text-body)] font-medium text-ink">{titre}</span>
        <span className="mt-0.5 block text-[var(--text-secondary)] leading-relaxed text-ink-soft">
          {description}
        </span>
      </summary>
      <div className="px-4 pb-3">{children}</div>
    </details>
  );
}

export function ActionsAbonnement({
  abonnement,
  offres,
  modules,
  matrice,
  modulesSouscrits,
  offresDeRemise,
  regime,
  peutEcrireAbonnement,
  peutEcrirePrix,
  peutEcrireFacture,
  role,
}: {
  abonnement: LigneAbonnement;
  offres: LigneOffre[];
  modules: LigneModule[];
  matrice: LigneCase[];
  modulesSouscrits: LigneModuleSouscrit[];
  offresDeRemise: LigneOffreDeRemise[];
  regime: RegimeTvaClient | null;
  peutEcrireAbonnement: boolean;
  peutEcrirePrix: boolean;
  peutEcrireFacture: boolean;
  role: string;
}) {
  const organizationId = abonnement.organization_id;

  const [etatOffre, actionOffre, offreEnCours] = useActionState(changerOffre, ETAT_VIERGE);
  const [etatEssai, actionEssai, essaiEnCours] = useActionState(prolongerEssai, ETAT_VIERGE);
  const [etatSieges, actionSieges, siegesEnCours] = useActionState(
    fixerSiegesFactures,
    ETAT_VIERGE,
  );
  const [etatCredit, actionCredit, creditEnCours] = useActionState(accorderCredit, ETAT_VIERGE);
  const [etatModule, actionModule, moduleEnCours] = useActionState(basculerModule, ETAT_VIERGE);
  const [etatFin, actionFin, finEnCours] = useActionState(annulerALEcheance, ETAT_VIERGE);
  const [etatReprise, actionReprise, repriseEnCours] = useActionState(
    reactiverAbonnement,
    ETAT_VIERGE,
  );
  const [etatRemise, actionRemise, remiseEnCours] = useActionState(
    appliquerRemiseAuClient,
    ETAT_VIERGE,
  );
  const [etatTva, actionTva, tvaEnCours] = useActionState(enregistrerRegimeClient, ETAT_VIERGE);

  const [offreVisee, setOffreVisee] = useState(abonnement.plan);
  const offreCible = offres.find((offre) => offre.key === offreVisee);
  const surDevis = offreCible?.is_quote_only === true;

  const offreActuelle = offres.find((offre) => offre.key === abonnement.plan);
  const siegesCompris = offreActuelle?.included_seats ?? null;
  const prixSiege = offreActuelle?.extra_seat_monthly_price_cents ?? null;

  const index = indexerMatrice(matrice);
  const actifs = new Set(
    modulesSouscrits.filter((m) => m.cancelled_at === null).map((m) => m.module_key),
  );

  return (
    <div>
      {!peutEcrireAbonnement && (
        <p className="border-b border-line px-4 py-2.5 text-[var(--text-secondary)] text-ink-soft">
          Le rôle « {role} » ne porte pas{" "}
          <code className="font-mono">billing.subscriptions.write</code> : les gestes
          d&apos;administration lui sont fermés. La lecture reste ouverte.
        </p>
      )}

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Changer d'offre ou de cycle"
        description="Les modules souscrits sont réévalués : si la nouvelle offre ne sait pas les accueillir, la base refuse le changement plutôt que de laisser un module qu'on ne saurait ni facturer ni retirer."
      >
        <form action={actionOffre}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Offre</span>
              <select
                name="plan"
                value={offreVisee}
                onChange={(evenement) => setOffreVisee(evenement.target.value)}
                disabled={!peutEcrireAbonnement}
                className={CHAMP}
              >
                {offres.map((offre) => (
                  <option key={offre.key} value={offre.key}>
                    {offre.name}
                    {offre.is_active ? "" : " (retirée)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Cycle</span>
              <select
                name="cycle"
                defaultValue={abonnement.billing_cycle}
                disabled={!peutEcrireAbonnement}
                className={CHAMP}
              >
                <option value="monthly">Mensuel</option>
                <option value="yearly">Annuel</option>
              </select>
            </label>
            {surDevis && (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                    Prix mensuel négocié (€)
                  </span>
                  <input
                    name="negocieMensuel"
                    defaultValue={euros(abonnement.negotiated_monthly_price_cents)}
                    disabled={!peutEcrireAbonnement}
                    inputMode="decimal"
                    className={CHAMP}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                    Prix annuel négocié (€)
                  </span>
                  <input
                    name="negocieAnnuel"
                    defaultValue={euros(abonnement.negotiated_yearly_price_cents)}
                    disabled={!peutEcrireAbonnement}
                    inputMode="decimal"
                    className={CHAMP}
                  />
                </label>
              </>
            )}
          </div>
          <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            {surDevis
              ? "Offre sur devis : un prix négocié est obligatoire, et il remplace la grille."
              : "Offre à prix public : un prix négocié serait refusé — deux vérités concurrentes sur la même facture."}
          </p>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Motif <span className="text-critical">*</span>
            </span>
            <input name="motif" required disabled={!peutEcrireAbonnement} className={CHAMP} />
          </label>
          <div className="mt-3">
            <SubmitButton>{offreEnCours ? "Changement…" : "Changer d'offre"}</SubmitButton>
          </div>
        </form>
        <Retour etat={etatOffre} />
      </Bloc>

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Prolonger l'essai"
        description="La prolongation part de la fin d'essai existante quand elle est encore devant : deux prolongations le même jour ne s'écrasent pas."
      >
        <form action={actionEssai}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Jours (1 à 365)
              </span>
              <input
                name="jours"
                required
                disabled={!peutEcrireAbonnement}
                inputMode="numeric"
                className={CHAMP}
              />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input
                name="motif"
                required
                disabled={!peutEcrireAbonnement}
                placeholder="Offrir des jours d'essai, c'est offrir du chiffre d'affaires"
                className={CHAMP}
              />
            </label>
          </div>
          <div className="mt-3">
            <SubmitButton>{essaiEnCours ? "Prolongation…" : "Prolonger l'essai"}</SubmitButton>
          </div>
        </form>
        <Retour etat={etatEssai} />
      </Bloc>

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Sièges facturés en plus"
        description="Le nombre saisi est l'EXCÉDENT au-delà des sièges compris dans l'offre. Il n'est pas déduit du nombre de membres : tant que les sièges compris ne sont pas décidés offre par offre, un comptage automatique facturerait faux dans un sens ou dans l'autre."
      >
        <p className="mb-3 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          {siegesCompris === null ? (
            <>
              L&apos;offre « {offreActuelle?.name ?? abonnement.plan} » ne dit pas combien de sièges
              elle comprend — c&apos;est une décision qui revient au dirigeant, et elle est listée
              sur l&apos;écran des plans. En attendant, le calcul de l&apos;excédent se fait de
              tête.
            </>
          ) : (
            <>
              L&apos;offre « {offreActuelle?.name ?? abonnement.plan} » comprend {siegesCompris}{" "}
              siège(s). Saisissez ce qui vient <strong className="text-ink-soft">en plus</strong>,
              pas le total.
            </>
          )}{" "}
          {prixSiege === null ? (
            <>Cette offre n&apos;a pas de prix de siège supplémentaire : la facture le refusera.</>
          ) : (
            <>Chaque siège en plus est facturé {(prixSiege / 100).toFixed(2).replace(".", ",")} €.</>
          )}{" "}
          Le cycle annuel ne sait pas encore facturer un siège : son équivalent annuel n&apos;a pas
          été décidé.
        </p>
        <form action={actionSieges}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Sièges en plus
              </span>
              <input
                name="sieges"
                required
                defaultValue={abonnement.billable_extra_seats}
                disabled={!peutEcrireAbonnement}
                inputMode="numeric"
                className={CHAMP}
              />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input
                name="motif"
                required
                disabled={!peutEcrireAbonnement}
                placeholder="Un siège facturé en plus est une ligne de facture"
                className={CHAMP}
              />
            </label>
          </div>
          <div className="mt-3">
            <SubmitButton>{siegesEnCours ? "Enregistrement…" : "Enregistrer les sièges"}</SubmitButton>
          </div>
        </form>
        <Retour etat={etatSieges} />
      </Bloc>

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Accorder un crédit"
        description="Un crédit n'est ni un remboursement ni une remise : c'est un avoir commercial, consommé automatiquement et une seule fois sur la prochaine facture générée."
      >
        {/* HORS TAXES, ET IL FAUT LE DIRE — sinon on rend 60 € en
            croyant en rendre 50.

            Le crédit devient une ligne de facture NÉGATIVE portant le
            taux de TVA du client. Sur un client français à 20 %, un
            crédit de 50,00 € fait donc baisser le total TTC de 60,00 €.
            Sur un client en autoliquidation ou hors Union (taux 0), la
            baisse est de 50,00 € tout rond. Le même montant saisi n'a
            pas le même effet d'un client à l'autre, et un intitulé
            « Montant (€) » sous une description qui parle d'« argent
            rendu » laissait deviner l'inverse. */}
        <p className="mb-3 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Le montant est <strong className="text-ink-soft">hors taxes</strong>. Il devient une ligne
          négative sur la prochaine facture, au taux de TVA du client :{" "}
          {regime === null || regime.rate === null ? (
            <>
              le taux de ce client n&apos;est pas connu, donc l&apos;effet sur le total TTC ne
              l&apos;est pas non plus.
            </>
          ) : regime.rate === 0 ? (
            <>
              ce client est à 0 % (
              {LIBELLES_REGIME_TVA[regime.regime] ?? regime.regime}), la baisse du total TTC égalera
              donc le montant saisi.
            </>
          ) : (
            <>
              ce client est à {regime.rate} %, donc 50,00 € saisis feront baisser le total TTC de{" "}
              {(50 * (1 + Number(regime.rate) / 100)).toFixed(2).replace(".", ",")} €.
            </>
          )}
        </p>
        <form action={actionCredit}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Montant HT (€)
              </span>
              <input
                name="montant"
                required
                disabled={!peutEcrireAbonnement}
                inputMode="decimal"
                className={CHAMP}
              />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input
                name="motif"
                required
                disabled={!peutEcrireAbonnement}
                placeholder="Un crédit est de l'argent rendu, et il se justifie"
                className={CHAMP}
              />
            </label>
          </div>
          <div className="mt-3">
            <SubmitButton>{creditEnCours ? "Enregistrement…" : "Accorder le crédit"}</SubmitButton>
          </div>
        </form>
        <Retour etat={etatCredit} />
      </Bloc>

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Activer ou retirer un module"
        description="Le prix vient de la case de l'offre en cours, jamais de la ligne d'abonnement. Un module compris dans l'offre ne coûte rien, et cesse de coûter dès que l'offre change."
      >
        <form action={actionModule}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Module</span>
              <select name="moduleKey" disabled={!peutEcrireAbonnement} className={CHAMP}>
                {modules.map((module) => {
                  const disponibilite: Disponibilite =
                    index.get(cleDeCase(abonnement.plan, module.key))?.availability ?? "undecided";
                  return (
                    <option key={module.key} value={module.key}>
                      {module.name} — {LIBELLES_DISPONIBILITE[disponibilite].toLowerCase()}
                      {actifs.has(module.key) ? " · actif" : ""}
                      {module.is_delivered ? "" : " · non livré"}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Geste</span>
              <select name="actif" defaultValue="1" disabled={!peutEcrireAbonnement} className={CHAMP}>
                <option value="1">Activer</option>
                <option value="0">Retirer</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input name="motif" required disabled={!peutEcrireAbonnement} className={CHAMP} />
            </label>
          </div>
          <div className="mt-3">
            <SubmitButton>{moduleEnCours ? "Enregistrement…" : "Enregistrer"}</SubmitButton>
          </div>
        </form>
        <Retour etat={etatModule} />
      </Bloc>

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Appliquer une remise"
        description="La date de fin est CALCULÉE depuis la durée de l'offre, pas saisie. Une remise sans fin est inenregistrable : la colonne est obligatoire en base."
      >
        {!peutEcrirePrix && (
          <p className="mb-2 text-[var(--text-secondary)] text-ink-soft">
            Ce geste demande <code className="font-mono">billing.plans.write</code>, que le rôle
            « {role} » ne porte pas.
          </p>
        )}
        <form action={actionRemise}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Offre de remise</span>
              <select name="code" disabled={!peutEcrirePrix} className={CHAMP}>
                {offresDeRemise
                  .filter((offre) => offre.is_active)
                  .map((offre) => (
                    <option key={offre.code} value={offre.code}>
                      {offre.label} ({offre.duration_months} mois)
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Début (vide = aujourd&apos;hui)
              </span>
              <input name="debut" type="date" disabled={!peutEcrirePrix} className={CHAMP} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input
                name="motif"
                required
                disabled={!peutEcrirePrix}
                placeholder="Une remise est un revenu auquel on renonce"
                className={CHAMP}
              />
            </label>
          </div>
          <div className="mt-3">
            <SubmitButton>{remiseEnCours ? "Application…" : "Appliquer la remise"}</SubmitButton>
          </div>
        </form>
        <Retour etat={etatRemise} />
      </Bloc>

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Régime de TVA du client"
        description="Sans régime tranché, aucune facture ne part. Déclarer un numéro intracommunautaire VALIDÉ fait passer la facture en autoliquidation, donc à 0 % : si le numéro n'était pas valide, Oasis Care reste redevable de la TVA."
      >
        {!peutEcrireFacture && (
          <p className="mb-2 text-[var(--text-secondary)] text-ink-soft">
            Ce geste demande <code className="font-mono">billing.invoices.write</code>, que le rôle
            « {role} » ne porte pas.
          </p>
        )}
        <form action={actionTva}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Entreprise assujettie ?
              </span>
              <select name="assujettie" defaultValue="" disabled={!peutEcrireFacture} className={CHAMP}>
                <option value="">On ne sait pas</option>
                <option value="oui">Oui</option>
                <option value="non">Non</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Numéro de TVA vérifié ?
              </span>
              <select name="valide" defaultValue="0" disabled={!peutEcrireFacture} className={CHAMP}>
                <option value="0">Non vérifié</option>
                <option value="1">Vérifié</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Comment</span>
              <select name="source" defaultValue="vies" disabled={!peutEcrireFacture} className={CHAMP}>
                <option value="vies">Service européen VIES</option>
                <option value="manual">Contrôle manuel</option>
                <option value="document">Document fourni</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input name="motif" required disabled={!peutEcrireFacture} className={CHAMP} />
            </label>
          </div>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Note</span>
            <input name="note" disabled={!peutEcrireFacture} className={CHAMP} />
          </label>
          <div className="mt-3">
            <SubmitButton>{tvaEnCours ? "Enregistrement…" : "Enregistrer le régime"}</SubmitButton>
          </div>
        </form>
        <Retour etat={etatTva} />
      </Bloc>

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Annuler à l'échéance"
        description="Le statut RESTE « actif » : le client a payé sa période et en garde l'usage jusqu'au bout. Annuler à l'échéance et annuler ne sont pas le même geste, et les confondre fait rembourser ou facturer à tort."
      >
        <form action={actionFin}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Motif <span className="text-critical">*</span>
            </span>
            <input
              name="motif"
              required
              disabled={!peutEcrireAbonnement}
              placeholder="Savoir POURQUOI un client part est la donnée la plus utile de cette table"
              className={CHAMP}
            />
          </label>
          <div className="mt-3">
            <SubmitButton variant="danger">
              {finEnCours ? "Enregistrement…" : "Annuler à l'échéance"}
            </SubmitButton>
          </div>
        </form>
        <Retour etat={etatFin} />
      </Bloc>

      {/* ---------------------------------------------------------- */}
      <Bloc
        titre="Réactiver"
        description="Annule l'annulation et remet l'abonnement en « actif ». Refusé si l'abonnement n'est ni annulé ni en cours d'annulation : il n'y aurait rien à réactiver."
      >
        <form action={actionReprise}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Motif <span className="text-critical">*</span>
            </span>
            <input name="motif" required disabled={!peutEcrireAbonnement} className={CHAMP} />
          </label>
          <div className="mt-3">
            <SubmitButton variant="secondary">
              {repriseEnCours ? "Réactivation…" : "Réactiver"}
            </SubmitButton>
          </div>
        </form>
        <Retour etat={etatReprise} />
      </Bloc>
    </div>
  );
}

function euros(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
