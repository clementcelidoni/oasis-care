"use client";

import { useActionState, useState } from "react";

import { StatusBadge, SubmitButton } from "@/components/ui";
import { ETAT_VIERGE, ouvrirSessionAssistance } from "@/lib/support/actions";
import { resumeRessources } from "@/lib/support/libelles";

/**
 * ==================================================================
 * OUVRIR UNE SESSION D'ASSISTANCE — le formulaire le plus surveillé
 * ==================================================================
 *
 * TROIS CHOSES SONT AFFICHÉES AVANT LE BOUTON, et aucune n'est
 * décorative :
 *
 *   1. CE QUE LE NIVEAU OUVRE, table par table. Pas « accès
 *      diagnostic » : la liste des tables nommées, telle que
 *      `support_access_level_resources` la porte. Un niveau d'accès
 *      n'est pas un mot, c'est une liste — et celui qui l'accorde doit
 *      la lire au moment où il l'accorde.
 *   2. LA DURÉE MAXIMALE du niveau, qui est plus courte quand l'accès
 *      est plus large.
 *   3. SI LE CLIENT DOIT CONSENTIR, auquel cas la session n'ouvrira
 *      rien tant qu'il n'aura pas répondu.
 *
 * LES NIVEAUX NON ACCORDABLES NE SONT PAS DANS LA LISTE DÉROULANTE — ils
 * sont affichés dessous, éteints, avec le motif que la base donne. Les
 * faire disparaître ferait croire à un oubli d'interface ; les laisser
 * sélectionnables ferait promettre un geste que la base refuse.
 *
 * ------------------------------------------------------------------
 * CE QUI N'EST PAS DANS CE FICHIER
 * ------------------------------------------------------------------
 * Aucun bouton « se connecter en tant que ce client ». Pas de version
 * désactivée, pas de brouillon commenté. La spec p.21 l'interdit en
 * toutes lettres, et un premier jalon d'une porte dérobée est le début
 * du chemin qui y mène.
 */

const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

export type NiveauProposable = {
  cle: string;
  libelle: string;
  ouvreDonneesMetier: boolean;
  minutesMax: number;
  consentementRequis: boolean;
  ressources: string[];
  note: string | null;
};

export type NiveauRefuse = {
  cle: string;
  libelle: string;
  motif: string;
};

export function FormulaireOuvertureSession({
  niveaux,
  refuses,
  organisationParDefaut,
  compteParDefaut,
  ticketParDefaut,
}: {
  niveaux: NiveauProposable[];
  refuses: NiveauRefuse[];
  organisationParDefaut?: string;
  compteParDefaut?: string;
  ticketParDefaut?: string;
}) {
  const [etat, action, enCours] = useActionState(ouvrirSessionAssistance, ETAT_VIERGE);
  const [cle, setCle] = useState(niveaux[0]?.cle ?? "");
  const [cible, setCible] = useState<"organisation" | "compte">(
    compteParDefaut !== undefined && organisationParDefaut === undefined ? "compte" : "organisation",
  );

  const niveau = niveaux.find((candidat) => candidat.cle === cle) ?? null;

  if (niveaux.length === 0) {
    return (
      <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
        Aucun niveau d&apos;accès n&apos;est accordable. Ce n&apos;est pas une panne : la table
        `support_access_levels` ne contient que des niveaux marqués non accordables, ou aucune
        ligne du tout. Tant qu&apos;un niveau n&apos;est pas déclaré ACCORDABLE avec la liste des
        tables qu&apos;il ouvre, la base refusera toute session — et c&apos;est le comportement
        voulu.
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4 px-4 py-4">
      {ticketParDefaut !== undefined && (
        <input type="hidden" name="ticketId" value={ticketParDefaut} />
      )}

      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Niveau d&apos;accès <span className="text-critical">*</span>
          </span>
          <select
            name="niveau"
            value={cle}
            onChange={(evenement) => setCle(evenement.target.value)}
            className={CHAMP}
          >
            {niveaux.map((candidat) => (
              <option key={candidat.cle} value={candidat.cle}>
                {candidat.libelle}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Durée en minutes
          </span>
          <input
            name="minutes"
            type="number"
            min={1}
            max={niveau?.minutesMax}
            placeholder={
              niveau ? `vide = le maximum du niveau (${niveau.minutesMax} min)` : "vide = maximum"
            }
            className={CHAMP}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            La base plafonne de toute façon à {niveau?.minutesMax ?? "?"} minutes pour ce niveau,
            et à quatre heures quoi qu&apos;il arrive. Demander plus ne donne pas plus.
          </span>
        </label>
      </div>

      {/* CE QUE LE NIVEAU OUVRE — la liste, pas l'intitulé. */}
      {niveau && (
        <div className="max-w-4xl rounded-[var(--radius-card)] border border-line bg-surface-sunken px-3 py-2.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            {niveau.ouvreDonneesMetier ? (
              <StatusBadge tone="critical">Ouvre des données métier</StatusBadge>
            ) : (
              <StatusBadge tone="positive">Aucune donnée métier</StatusBadge>
            )}
            {niveau.consentementRequis && (
              <StatusBadge tone="info">Consentement du client requis</StatusBadge>
            )}
            <StatusBadge tone="neutral" dot={false}>
              {niveau.minutesMax} min au maximum
            </StatusBadge>
          </div>
          <p className="text-[var(--text-body)] leading-relaxed text-ink">
            {resumeRessources(niveau.ressources)}
          </p>
          {niveau.note !== null && (
            <p className="mt-1 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
              {niveau.note}
            </p>
          )}
          {niveau.consentementRequis && (
            <p className="mt-1 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-info">
              La session sera créée, mais n&apos;ouvrira RIEN tant que le client n&apos;aura pas
              consenti. Le consentement se donne de son côté : aucun administrateur ne peut le
              cocher à sa place.
            </p>
          )}
        </div>
      )}

      <fieldset className="flex max-w-4xl flex-col gap-2">
        <legend className="mb-1 text-[var(--text-secondary)] font-medium text-ink-soft">
          Sur qui porte la session ? <span className="text-critical">*</span>
        </legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="typeCible"
              value="organisation"
              checked={cible === "organisation"}
              onChange={() => setCible("organisation")}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-[var(--text-body)] text-ink">Une entreprise Pro</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="typeCible"
              value="compte"
              checked={cible === "compte"}
              onChange={() => setCible("compte")}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-[var(--text-body)] text-ink">Un compte particulier</span>
          </label>
        </div>

        {/* Un seul champ est rendu à la fois : l'autre n'est pas
            seulement caché, il n'est pas envoyé. Un champ caché qui
            garderait une valeur d'un choix précédent viserait deux
            personnes à la fois. */}
        {cible === "organisation" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Identifiant de l&apos;entreprise
            </span>
            <input
              key="organizationId"
              name="organizationId"
              required
              defaultValue={organisationParDefaut}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={`${CHAMP} font-mono text-[12px]`}
            />
            <span className="text-[var(--text-secondary)] text-ink-faint">
              Il se copie depuis la fiche de l&apos;entreprise, dans « Détails techniques ».
              Volontairement un identifiant et non un nom : deux entreprises peuvent porter le
              même, et on n&apos;entre pas « à peu près » chez quelqu&apos;un.
            </span>
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Identifiant du compte
            </span>
            <input
              key="customerUserId"
              name="customerUserId"
              required
              defaultValue={compteParDefaut}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={`${CHAMP} font-mono text-[12px]`}
            />
            <span className="text-[var(--text-secondary)] text-ink-faint">
              Il se copie depuis la fiche du compte, dans « Détails techniques ».
            </span>
          </label>
        )}
      </fieldset>

      <label className="flex max-w-4xl flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Motif <span className="text-critical">*</span>
        </span>
        <textarea
          name="motif"
          required
          rows={2}
          placeholder="« Le client signale que son IA s'est arrêtée le 3 au matin — vérifier ses appels et son quota. »"
          className={CHAMP}
        />
        <span className="text-[var(--text-secondary)] text-ink-faint">
          Le CLIENT lit ce motif : la politique de lecture de la base lui donne accès à ses
          propres sessions d&apos;assistance. Écrivez-le comme si vous le lui disiez, parce que
          c&apos;est le cas.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{enCours ? "Ouverture…" : "Ouvrir la session"}</SubmitButton>
        {etat.statut !== "vierge" && etat.message !== null && (
          <p
            role="status"
            className={`max-w-2xl text-[var(--text-secondary)] leading-snug ${
              etat.statut === "erreur" ? "text-critical" : "text-positive"
            }`}
          >
            {etat.message}
          </p>
        )}
      </div>

      {refuses.length > 0 && (
        <div className="max-w-4xl border-t border-line pt-3">
          <p className="eyebrow mb-2">Niveaux déclarés mais non accordables</p>
          <ul className="flex flex-col gap-2">
            {refuses.map((refuse) => (
              <li
                key={refuse.cle}
                className="unknown-rule rounded-[var(--radius-control)] px-3 py-2"
              >
                <p className="text-[var(--text-body)] font-medium text-ink-soft">
                  {refuse.libelle}
                </p>
                <p className="mt-0.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                  {refuse.motif}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Ils sont affichés plutôt que masqués : leur absence ferait croire à un oubli
            d&apos;interface, alors que c&apos;est une décision — et le refus est dans les
            données, pas dans cet écran. Les ouvrir demandera de NOMMER les tables concernées,
            une par une.
          </p>
        </div>
      )}
    </form>
  );
}
