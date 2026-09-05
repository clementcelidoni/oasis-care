"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

import { SubmitButton } from "@/components/ui";
import {
  annulerBrouillon,
  crediterFacture,
  emettreFacture,
  enregistrerEncaissement,
} from "@/lib/billing/actions";
import { ETAT_VIERGE, type EtatFormulaire } from "@/lib/billing/formulaire";

/**
 * ==================================================================
 * LES QUATRE GESTES D'UNE FACTURE — et le cinquième qui n'existe pas
 * ==================================================================
 *
 *   ÉMETTRE      un brouillon devient un document opposable, numéroté.
 *   ENCAISSER    à la main, depuis le relevé bancaire.
 *   ANNULER      un BROUILLON seulement.
 *   AVOIR        la seule correction possible d'une facture émise.
 *
 * LE CINQUIÈME, « MODIFIER UNE FACTURE ÉMISE », N'EXISTE PAS. Ce n'est
 * pas une omission, et ce n'est pas la politesse de l'interface qui le
 * tient : un déclencheur en base refuse toute modification après
 * `issued_at`. Une facture modifiée après remise au client est un
 * document qui ne correspond plus à ce qu'il a reçu.
 *
 * L'écran affiche donc l'explication à la place du bouton. Un bouton
 * absent sans explication se cherche ; une phrase se lit une fois.
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

export function ActionsFacture({
  invoiceId,
  emise,
  annulee,
  creditee,
  bloquants,
  peutEcrire,
  role,
}: {
  invoiceId: string;
  emise: boolean;
  annulee: boolean;
  creditee: boolean;
  /** Ce qui empêche l'émission, tel que la base le dira. */
  bloquants: string[];
  peutEcrire: boolean;
  role: string;
}) {
  const [etatEmission, actionEmission, emissionEnCours] = useActionState(
    emettreFacture,
    ETAT_VIERGE,
  );
  const [etatPaiement, actionPaiement, paiementEnCours] = useActionState(
    enregistrerEncaissement,
    ETAT_VIERGE,
  );
  const [etatAnnulation, actionAnnulation, annulationEnCours] = useActionState(
    annulerBrouillon,
    ETAT_VIERGE,
  );
  const [etatAvoir, actionAvoir, avoirEnCours] = useActionState(crediterFacture, ETAT_VIERGE);

  return (
    <div>
      {!peutEcrire && (
        <p className="border-b border-line px-4 py-2.5 text-[var(--text-secondary)] text-ink-soft">
          Le rôle « {role} » ne porte pas <code className="font-mono">billing.invoices.write</code>{" "}
          : cette facture est en lecture seule.
        </p>
      )}

      {/* ---- ÉMETTRE ------------------------------------------------ */}
      {!emise && !annulee && (
        <Bloc
          titre="Émettre"
          description="Attribue le numéro suivant de la séquence, fige les identités des deux parties sur le document, et calcule l'échéance. Le numéro n'est consommé que si tout le reste réussit : aucun trou possible."
        >
          {bloquants.length > 0 && (
            <div className="mb-3 rounded-[var(--radius-card)] border border-critical/40 bg-critical-wash px-3 py-2 text-[var(--text-secondary)] leading-relaxed text-critical">
              <p className="font-semibold">La base refusera l&apos;émission :</p>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                {bloquants.map((motif) => (
                  <li key={motif}>{motif}</li>
                ))}
              </ul>
            </div>
          )}
          <form action={actionEmission}>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input
                name="motif"
                required
                disabled={!peutEcrire}
                placeholder="Émettre une facture, c'est produire un document opposable"
                className={CHAMP}
              />
            </label>
            <div className="mt-3">
              <SubmitButton>{emissionEnCours ? "Émission…" : "Émettre la facture"}</SubmitButton>
            </div>
          </form>
          <Retour etat={etatEmission} />
        </Bloc>
      )}

      {/* ---- ENCAISSER ---------------------------------------------- */}
      {emise && !annulee && (
        <Bloc
          titre="Enregistrer un encaissement"
          description="À LA MAIN : aucune importation bancaire, aucun rapprochement automatique dans ce jalon. Un administrateur lit son relevé et saisit. Plusieurs encaissements sont possibles — un acompte puis un solde, un virement en deux fois."
        >
          <form action={actionPaiement}>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Montant reçu (€)
                </span>
                <input
                  name="montant"
                  required
                  disabled={!peutEcrire}
                  inputMode="decimal"
                  className={CHAMP}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Reçu le
                </span>
                <input name="recuLe" type="date" disabled={!peutEcrire} className={CHAMP} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Moyen
                </span>
                <select name="moyen" defaultValue="transfer" disabled={!peutEcrire} className={CHAMP}>
                  <option value="transfer">Virement SEPA</option>
                  <option value="provider">Prestataire de paiement</option>
                  <option value="other">Autre</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Référence externe
                </span>
                <input
                  name="reference"
                  disabled={!peutEcrire}
                  placeholder="identifiant du virement"
                  className={CHAMP}
                />
              </label>
            </div>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Note</span>
              <input name="note" disabled={!peutEcrire} className={CHAMP} />
            </label>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input
                name="motif"
                required
                disabled={!peutEcrire}
                placeholder="Un encaissement saisi à la main se relit"
                className={CHAMP}
              />
            </label>
            <div className="mt-3">
              <SubmitButton>
                {paiementEnCours ? "Enregistrement…" : "Enregistrer l'encaissement"}
              </SubmitButton>
            </div>
          </form>
          <Retour etat={etatPaiement} />
        </Bloc>
      )}

      {/* ---- ANNULER LE BROUILLON ----------------------------------- */}
      {!emise && !annulee && (
        <Bloc
          titre="Annuler le brouillon"
          description="Aucun numéro n'a été attribué : rien n'est consommé, la séquence reste sans trou, et la période peut être régénérée."
        >
          <form action={actionAnnulation}>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input name="motif" required disabled={!peutEcrire} className={CHAMP} />
            </label>
            <div className="mt-3">
              <SubmitButton variant="danger">
                {annulationEnCours ? "Annulation…" : "Annuler le brouillon"}
              </SubmitButton>
            </div>
          </form>
          <Retour etat={etatAnnulation} />
        </Bloc>
      )}

      {/* ---- AVOIR --------------------------------------------------- */}
      {emise && !creditee && (
        <Bloc
          titre="Corriger par un avoir"
          description="La facture GARDE son numéro et reste au dossier ; l'avoir la neutralise, avec sa propre séquence. C'est la seule correction possible après émission — et c'est pour cela qu'aucun bouton « modifier » n'existe."
        >
          <form action={actionAvoir}>
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Motif <span className="text-critical">*</span>
              </span>
              <input
                name="motif"
                required
                disabled={!peutEcrire}
                placeholder="Un avoir dit ce qu'on corrige, et c'est ce que lira le comptable"
                className={CHAMP}
              />
            </label>
            <div className="mt-3">
              <SubmitButton variant="danger">
                {avoirEnCours ? "Émission de l'avoir…" : "Émettre un avoir"}
              </SubmitButton>
            </div>
          </form>
          <Retour etat={etatAvoir} />
        </Bloc>
      )}

      {emise && (
        <p className="px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          <strong className="text-ink-soft">Il n&apos;y a pas de bouton « modifier ».</strong> Une
          facture émise est figée par un déclencheur en base, y compris les identités recopiées :
          c&apos;est précisément ce que le client a reçu. Seuls le statut, les notes internes et la
          référence externe de paiement peuvent encore bouger.
        </p>
      )}

      {annulee && (
        <p className="px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Cette facture est annulée. Elle sort de l&apos;index d&apos;unicité, ce qui permet de
          régénérer la période.
        </p>
      )}
    </div>
  );
}
