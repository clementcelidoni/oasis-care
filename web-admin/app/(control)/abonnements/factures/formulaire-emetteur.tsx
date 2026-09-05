"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/ui";
import { enregistrerEmetteur } from "@/lib/billing/actions";
import { ETAT_VIERGE } from "@/lib/billing/formulaire";
import type { LigneEmetteur } from "@/lib/billing/types";

/**
 * ==================================================================
 * L'IDENTITÉ LÉGALE DE L'ÉMETTEUR — Oasis Care lui-même
 * ==================================================================
 *
 * ELLE N'EXISTE NULLE PART AILLEURS DANS LA BASE.
 * `business_organizations` décrit les CLIENTS ; l'émetteur, c'est nous,
 * et personne ne l'avait jamais écrit. Tant que ces champs manquent,
 * AUCUNE facture ne part — et c'est la base qui le refuse, pas cet
 * écran : `saas_issue_invoice` consulte
 * `saas_billing_issuer_missing_fields()` avant d'attribuer un numéro.
 *
 * ------------------------------------------------------------------
 * POURQUOI UN CHAMP VIDE NE VIDE RIEN
 * ------------------------------------------------------------------
 * La fonction SQL fait `coalesce(p_fields ->> 'x', x)` : seuls les
 * champs PRÉSENTS sont écrits. Un formulaire à moitié rempli complète
 * donc l'identité au lieu de l'effacer. C'est ce qu'on veut d'un
 * formulaire qu'on rouvre pour corriger une ligne.
 *
 * Conséquence à connaître : on ne peut pas EFFACER un champ depuis cet
 * écran. C'est délibéré — un SIRET effacé par un champ laissé vide est
 * exactement l'accident qu'on ne veut pas sur un document opposable.
 *
 * ------------------------------------------------------------------
 * CE QUE CE FORMULAIRE NE PROPOSE PAS
 * ------------------------------------------------------------------
 * Aucun moyen de paiement en ligne, aucune clé de prestataire. Le
 * virement SEPA contre facture est le seul moyen branché, et il tient
 * en trois lignes sur le document : IBAN, BIC, banque. Le prestataire
 * arrive au chantier suivant, et la colonne qui recevra sa référence
 * existe déjà, vide.
 */
export function FormulaireEmetteur({
  emetteur,
  manquants,
  libelles,
  peutEcrire,
  role,
}: {
  emetteur: LigneEmetteur | null;
  manquants: string[];
  libelles: Record<string, string>;
  peutEcrire: boolean;
  role: string;
}) {
  const [etat, action, enCours] = useActionState(enregistrerEmetteur, ETAT_VIERGE);

  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

  const manque = new Set(manquants);

  const texte = (
    nom: keyof LigneEmetteur,
    libelle: string,
    aide?: string,
  ) => (
    <label className="flex flex-col gap-1.5" key={nom}>
      <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
        {libelle}
        {manque.has(nom) && <span className="ml-1.5 text-critical">manquant</span>}
      </span>
      <input
        name={nom}
        defaultValue={valeurTexte(emetteur?.[nom])}
        disabled={!peutEcrire}
        className={champ}
      />
      {aide && <span className="text-[var(--text-secondary)] text-ink-faint">{aide}</span>}
    </label>
  );

  return (
    <div className="px-4 py-3">
      {manquants.length > 0 && (
        <p className="mb-3 rounded-[var(--radius-card)] border border-critical/40 bg-critical-wash px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-critical">
          <strong>Aucune facture ne peut être émise.</strong> Il manque{" "}
          {manquants.map((nom) => libelles[nom] ?? nom).join(", ")}. La liste vient de la base —
          c&apos;est exactement ce que la fonction d&apos;émission vérifiera, pas ce qu&apos;un
          écran croit qu&apos;elle vérifie.
        </p>
      )}

      {!peutEcrire && (
        <p className="mb-3 text-[var(--text-secondary)] text-ink-soft">
          Le rôle « {role} » ne porte pas <code className="font-mono">billing.issuer.write</code>.
          Cette permission n&apos;appartient qu&apos;au super-administrateur : un SIRET ou un IBAN
          changé par erreur ne se rattrape pas sur une facture déjà partie.
        </p>
      )}

      <form action={action}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {texte("legal_name", "Raison sociale")}
          {texte("legal_form", "Forme juridique", "SAS, SARL, EI…")}
          {texte("siret", "SIRET")}
          {texte("siren", "SIREN")}
          {texte("vat_number", "Numéro de TVA intracommunautaire")}
          {texte("rcs_city", "Ville du RCS")}
          {texte("address_line1", "Adresse")}
          {texte("address_line2", "Complément d'adresse")}
          {texte("postal_code", "Code postal")}
          {texte("city", "Ville")}
          {texte("country", "Pays", "Code à deux lettres, FR par défaut.")}
          {texte("email", "Courriel de facturation")}
          {texte("phone", "Téléphone")}
          {texte("website", "Site")}
          {texte("iban", "IBAN", "Le virement SEPA est le seul moyen branché.")}
          {texte("bic", "BIC")}
          {texte("bank_name", "Banque")}

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Capital social (€)
            </span>
            <input
              name="share_capital"
              defaultValue={euros(emetteur?.share_capital_cents ?? null)}
              disabled={!peutEcrire}
              inputMode="decimal"
              className={champ}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Délai de paiement (jours)
            </span>
            <input
              name="payment_terms_days"
              defaultValue={emetteur?.payment_terms_days ?? ""}
              disabled={!peutEcrire}
              inputMode="numeric"
              className={champ}
            />
            <span className="text-[var(--text-secondary)] text-ink-faint">
              L&apos;échéance de chaque facture en découle.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Indemnité de recouvrement (€)
            </span>
            <input
              name="recovery_indemnity"
              defaultValue={euros(emetteur?.recovery_indemnity_cents ?? null)}
              disabled={!peutEcrire}
              inputMode="decimal"
              className={champ}
            />
            <span className="text-[var(--text-secondary)] text-ink-faint">
              Mention obligatoire entre professionnels. Réglée ici, pas codée en dur : elle a déjà
              changé.
            </span>
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Clause de pénalités de retard
            {manque.has("late_penalty_terms") && (
              <span className="ml-1.5 text-critical">manquante</span>
            )}
          </span>
          <textarea
            name="late_penalty_terms"
            defaultValue={emetteur?.late_penalty_terms ?? ""}
            disabled={!peutEcrire}
            rows={2}
            className={champ}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Obligatoire sur toute facture entre professionnels ; son absence est sanctionnée.
          </span>
        </label>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Pied de facture
          </span>
          <textarea
            name="invoice_footer"
            defaultValue={emetteur?.invoice_footer ?? ""}
            disabled={!peutEcrire}
            rows={2}
            className={champ}
          />
        </label>

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Motif <span className="text-critical">*</span>
          </span>
          <input
            name="motif"
            required
            disabled={!peutEcrire}
            placeholder="Ces mentions sont ce qui rend une facture opposable"
            className={champ}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton>{enCours ? "Enregistrement…" : "Enregistrer l'émetteur"}</SubmitButton>
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Un champ laissé vide ne l&apos;efface pas : il n&apos;est simplement pas écrit.
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

function valeurTexte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur : "";
}

function euros(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
