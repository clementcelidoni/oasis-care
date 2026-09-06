"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { ETAT_VIERGE, retablirExpedition, suspendreExpedition } from "@/lib/email/actions";

/**
 * ==================================================================
 * L'INTERRUPTEUR D'EXPÉDITION D'UNE ENTREPRISE
 * ==================================================================
 *
 * IL COUPE TOUT, TRANSACTIONNEL COMPRIS. C'est le seul endroit du
 * produit où une FACTURE peut être arrêtée, et c'est assumé à trois
 * conditions que 0084 impose et que ce formulaire rend visibles : un
 * humain décide, un motif est obligatoire, et L'ENTREPRISE LIT CE
 * MOTIF dans son propre écran.
 *
 * LE MOTIF EST DONC UN MESSAGE AU CLIENT, pas une note interne. C'est
 * écrit au-dessus du champ, parce que c'est au moment d'écrire qu'il
 * faut le savoir — pas après.
 *
 * POURQUOI CE GESTE EXISTE, et pourquoi il n'est pas automatique :
 * toutes les entreprises expédient depuis le même domaine authentifié.
 * Un seul paysagiste qui écrit à des adresses achetées fait tomber la
 * délivrabilité de TOUS — y compris les factures d'abonnement d'Oasis
 * Care et les messages d'authentification. Couper une entreprise sans
 * couper les autres est ce qui empêche cela. Mais couper AUTOMATIQUEMENT
 * arrêterait les factures de quelqu'un sans que personne ne l'ait
 * décidé : ce serait le défaut catastrophique par une autre porte. La
 * vue de réputation alerte ; elle ne coupe pas.
 */

const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent";

export function Interrupteur({
  organizationId,
  nom,
  suspendue,
}: {
  organizationId: string;
  nom: string;
  suspendue: boolean;
}) {
  const [etat, action, enCours] = useActionState(
    suspendue ? retablirExpedition : suspendreExpedition,
    ETAT_VIERGE,
  );
  const [motif, setMotif] = useState("");
  const [ouvert, setOuvert] = useState(false);

  if (!ouvert) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOuvert(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 py-1.5 text-[var(--text-secondary)] font-medium transition-colors ${
            suspendue
              ? "border border-line-strong bg-surface-raised text-ink hover:border-ink-faint"
              : "border border-critical/40 bg-critical-wash text-critical hover:border-critical"
          }`}
        >
          {suspendue ? "Rétablir l'expédition" : "Suspendre l'expédition"}
        </button>
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
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      {!suspendue && (
        <div className="rounded-[var(--radius-card)] border border-critical/40 bg-critical-wash px-3 py-2.5">
          <p className="text-[var(--text-secondary)] font-semibold text-critical">
            Cela arrête aussi ses factures
          </p>
          <p className="mt-1 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            {nom} ne pourra plus rien envoyer : ni devis, ni facture, ni invitation. C&apos;est le
            seul endroit du produit où un message transactionnel peut être arrêté. À n&apos;employer
            que pour protéger la réputation du domaine, qui est commune à tout le parc.
          </p>
        </div>
      )}

      <label className="flex max-w-3xl flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Motif <span className="text-critical">*</span>
        </span>
        <textarea
          name="motif"
          rows={2}
          value={motif}
          onChange={(evenement) => setMotif(evenement.target.value)}
          placeholder={
            suspendue
              ? "« Adresses corrigées et taux de plaintes revenu à zéro depuis trois semaines. »"
              : "« Taux de plaintes à 1,4 % sur trente jours : la délivrabilité de tout le parc est en jeu. Reprise dès que la liste sera nettoyée. »"
          }
          className={CHAMP}
        />
        <span className="text-[var(--text-secondary)] text-ink-faint">
          {nom} LIT ce motif dans son propre écran — la base lui en donne le droit, et c&apos;est
          ce qui rend la coupure acceptable. Écrivez-le comme si vous le lui disiez, parce que
          c&apos;est le cas.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant={suspendue ? "primary" : "danger"}>
          {enCours
            ? "En cours…"
            : suspendue
              ? "Rétablir l'expédition"
              : `Suspendre l'expédition de ${nom}`}
        </SubmitButton>
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
