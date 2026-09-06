"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { envoyerAnnonce, ETAT_VIERGE } from "@/lib/email/actions";

/**
 * ==================================================================
 * LE SEUL GESTE IRRÉVERSIBLE DU LOT
 * ==================================================================
 *
 * Une fois partie, une annonce ne se rejoue pas — la base le refuse
 * — et surtout : un message envoyé ne se rappelle pas. L'écran le dit
 * en toutes lettres avant le bouton, et il demande DEUX choses qu'on ne
 * peut pas faire par réflexe : recopier le nombre exact de
 * destinataires, et écrire un motif.
 *
 * ------------------------------------------------------------------
 * LE NOMBRE RECOPIÉ N'EST PAS UN RITUEL
 * ------------------------------------------------------------------
 * Il est comparé, CÔTÉ SERVEUR, à une audience RECALCULÉE au moment du
 * clic — pas à un champ caché, qu'il suffirait de modifier, et pas au
 * nombre que cette page affichait, qui peut avoir vieilli. S'ils
 * diffèrent, rien ne part et l'écran dit pourquoi.
 *
 * L'EMPREINTE VOYAGE À CÔTÉ, en champ caché, et elle ne sert qu'à un
 * cas que le nombre seul laisserait passer : deux entreprises qui se
 * croisent — l'une se désabonne, l'autre consent. Le total ne bouge
 * pas, la liste si. La modifier ne donne aucun pouvoir : elle est
 * comparée à la liste recalculée, donc la truquer ne fait qu'ajouter un
 * refus.
 *
 * ------------------------------------------------------------------
 * CE QUI MANQUE ENCORE, ET QUI EST DIT PLUTÔT QUE CACHÉ
 * ------------------------------------------------------------------
 * L'ENVOI D'ESSAI À SOI-MÊME. C'est le garde-fou le moins cher qui
 * soit, et il n'est pas possible aujourd'hui : `email_enqueue()` est
 * réservée à `service_role` (0084 § 15.c) et résout le destinataire en
 * base — elle ne sait pas écrire à l'administrateur qui la déclenche.
 * Le simuler avec un rendu local aurait donné un faux essai : on aurait
 * vérifié notre propre aperçu, pas le message que le transporteur
 * expédie. Le panneau au-dessus dit ce qui manque ; en attendant,
 * l'aperçu est rendu sur un vrai destinataire, et un texte contenant
 * encore une variable est refusé à la création.
 */
const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent";

export function ConfirmerEnvoi({
  campagneId,
  destinataires,
  empreinte,
  secondFacteurActif,
}: {
  campagneId: string;
  destinataires: number;
  empreinte: string;
  /**
   * `false` quand la session n'est pas de niveau aal2. La base refusera
   * de toute façon (`platform_admin_require_mfa`), mais le dire avant
   * évite de composer, de confirmer, puis de perdre le geste.
   */
  secondFacteurActif: boolean;
}) {
  const [etat, action, enCours] = useActionState(envoyerAnnonce, ETAT_VIERGE);
  const [saisi, setSaisi] = useState("");
  const [motif, setMotif] = useState("");

  const nombreOk = saisi.trim() === String(destinataires);
  const pret = nombreOk && motif.trim() !== "" && destinataires > 0;

  return (
    <form action={action} className="flex flex-col gap-4 px-4 py-4">
      <input type="hidden" name="campagneId" value={campagneId} />
      <input type="hidden" name="empreinte" value={empreinte} />

      <div className="rounded-[var(--radius-card)] border border-critical/40 bg-critical-wash px-3 py-2.5">
        <p className="text-[var(--text-body)] font-semibold text-critical">
          Ce geste est irréversible
        </p>
        <p className="mt-1 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
          {destinataires} entreprise{destinataires > 1 ? "s" : ""} recevront ce message. Un
          courriel parti ne se rappelle pas, et cette annonce ne pourra pas être rejouée : la base
          refuse d&apos;envoyer deux fois la même. Si le texte est à corriger, corrigez-le
          maintenant en composant une nouvelle annonce.
        </p>
      </div>

      {!secondFacteurActif && (
        <div className="rounded-[var(--radius-card)] border border-warning/35 bg-warning-wash px-3 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
          Votre session n&apos;est pas de niveau renforcé. La base exige un second facteur pour
          écrire à tout le parc : le geste sera refusé. Réglez votre second facteur dans
          Paramètres avant de continuer.
        </div>
      )}

      <label className="flex max-w-md flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Recopiez le nombre de destinataires <span className="text-critical">*</span>
        </span>
        <input
          name="nombre"
          inputMode="numeric"
          value={saisi}
          onChange={(evenement) => setSaisi(evenement.target.value)}
          placeholder={String(destinataires)}
          className={`${CHAMP} tabular`}
        />
        <span className="text-[var(--text-secondary)] text-ink-faint">
          {saisi.trim() === ""
            ? "Le nombre est vérifié à nouveau côté serveur, contre une audience recalculée au moment du clic."
            : nombreOk
              ? "Le nombre correspond à ce que cet écran affiche. Il sera revérifié contre un recalcul."
              : `Ce n'est pas le nombre affiché (${destinataires}).`}
        </span>
      </label>

      <label className="flex max-w-3xl flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Motif de l&apos;envoi <span className="text-critical">*</span>
        </span>
        <textarea
          name="motif"
          rows={2}
          value={motif}
          onChange={(evenement) => setMotif(evenement.target.value)}
          placeholder="« Annonce validée en comité produit du 2 septembre ; envoi groupé prévu ce jour. »"
          className={CHAMP}
        />
        <span className="text-[var(--text-secondary)] text-ink-faint">
          Il s&apos;inscrit dans le journal des actions administratives, à côté du nombre
          d&apos;entreprises touchées. C&apos;est ce que relira quelqu&apos;un qui n&apos;était
          pas là.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        {/* Le bouton reste CLIQUABLE quand il manque quelque chose, et
            c'est délibéré : un bouton grisé ne dit pas ce qui manque.
            La Server Action refuse et explique. On se contente de ne
            pas l'habiller en « prêt ». */}
        <SubmitButton variant={pret ? "danger" : "secondary"}>
          {enCours ? "Envoi…" : `Envoyer à ${destinataires} entreprise${destinataires > 1 ? "s" : ""}`}
        </SubmitButton>
        {!pret && (
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Recopiez le nombre et écrivez un motif.
          </span>
        )}
      </div>

      {etat.statut !== "vierge" && etat.message !== null && (
        <p
          role="status"
          className={`max-w-3xl text-[var(--text-body)] leading-relaxed ${
            etat.statut === "erreur" ? "text-critical" : "text-positive"
          }`}
        >
          {etat.message}
        </p>
      )}
    </form>
  );
}
