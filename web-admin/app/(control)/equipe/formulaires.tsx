"use client";

import { useActionState, useState } from "react";

import { StatusBadge, SubmitButton } from "@/components/ui";
import {
  ETAT_VIERGE,
  inviterAdministrateur,
  nommerAdministrateur,
  retirerInvitation,
} from "@/lib/auth/actions";
import type { EtatInvitation, Invitation } from "@/lib/auth/equipe";
import { roleLabel } from "@/lib/auth/roles";
import { formatDate } from "@/lib/format";

import { CHAMP, ChoixRole, Message } from "./champs";

/**
 * ==================================================================
 * AJOUTER QUELQU'UN À L'ÉQUIPE — deux chemins, et il faut les deux
 * ==================================================================
 *
 * LE COLLÈGUE A DÉJÀ UN COMPTE OASIS CARE. On le nomme directement à
 * partir de son identifiant. C'est le cas de quelqu'un qui utilise déjà
 * l'application iPhone ou Oasis Care Pro — fréquent dans une petite
 * équipe.
 *
 * LE COLLÈGUE N'A PAS ENCORE DE COMPTE. Aucune ligne de SQL ne peut
 * créer un utilisateur `auth` : la base enregistre l'INTENTION, et le
 * compte est créé par `service_role` côté serveur, qui envoie
 * l'invitation. Cette seconde moitié n'est pas un confort : la page de
 * connexion de ce Control Center appelle `signInWithOtp` avec
 * `shouldCreateUser: false`, donc personne ne peut se créer un compte
 * tout seul en demandant un lien magique. Sans l'envoi, l'invitation
 * resterait une intention que personne ne pourrait jamais réclamer.
 *
 * ------------------------------------------------------------------
 * POURQUOI UNE INVITATION EXPIRE
 * ------------------------------------------------------------------
 * Une invitation sans fin est une porte laissée entrouverte : un
 * collègue qui ne rejoint jamais l'équipe garderait indéfiniment le
 * droit de devenir administrateur en créant un compte avec cette
 * adresse. La base l'impose (`expires_at` est `not null`) ; l'écran
 * propose quatorze jours par défaut, ce qui couvre des vacances sans
 * couvrir un oubli.
 */

export function FormulaireNomination() {
  const [etat, action, enCours] = useActionState(nommerAdministrateur, ETAT_VIERGE);

  return (
    <form action={action} className="flex flex-col gap-4 px-4 py-4">
      <p className="max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
        Pour quelqu&apos;un qui a <strong className="text-ink">déjà un compte Oasis Care</strong>.
        Son identifiant se trouve sur sa fiche, dans « Afficher détails techniques » — c&apos;est
        volontairement un identifiant et non une adresse : deux comptes peuvent avoir été créés
        sur des adresses voisines, et on ne nomme pas un administrateur « à peu près ».
      </p>

      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Identifiant du compte <span className="text-critical">*</span>
          </span>
          <input
            name="userId"
            required
            placeholder="00000000-0000-0000-0000-000000000000"
            className={`${CHAMP} font-mono text-[12px]`}
          />
        </label>
        <ChoixRole defaut="support" />
      </div>

      <label className="flex max-w-3xl flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Motif <span className="text-critical">*</span>
        </span>
        <textarea
          name="motif"
          required
          rows={2}
          placeholder="Donner à quelqu'un le droit de voir toutes les entreprises se justifie au moment où on le fait."
          className={CHAMP}
        />
      </label>

      <label className="flex max-w-3xl flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Note interne (facultative)
        </span>
        <input name="note" placeholder="Poste, équipe, durée de la mission…" className={CHAMP} />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{enCours ? "Nomination…" : "Nommer administrateur"}</SubmitButton>
        <Message etat={etat} />
      </div>
    </form>
  );
}

export function FormulaireInvitation() {
  const [etat, action, enCours] = useActionState(inviterAdministrateur, ETAT_VIERGE);

  return (
    <form action={action} className="flex flex-col gap-4 px-4 py-4">
      <p className="max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
        Pour un nouveau salarié <strong className="text-ink">sans compte Oasis Care</strong>. La
        base enregistre l&apos;intention, un compte est créé et une invitation part par courriel.
        À sa première connexion, son rôle lui sera attribué automatiquement — et la ligne du
        journal portera VOTRE nom, pas le sien : c&apos;est vous qui avez décidé.
      </p>

      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Adresse e-mail <span className="text-critical">*</span>
          </span>
          <input
            name="email"
            type="email"
            required
            placeholder="prenom@oasiscare.com"
            className={CHAMP}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Mise en minuscules avant d&apos;être écrite : deux casses feraient deux invitations
            pour une seule personne.
          </span>
        </label>
        <ChoixRole defaut="support" />
      </div>

      <label className="flex max-w-3xl flex-col gap-1.5">
        <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
          Motif <span className="text-critical">*</span>
        </span>
        <textarea
          name="motif"
          required
          rows={2}
          placeholder="On n'invite pas quelqu'un dans l'administration sans dire pourquoi."
          className={CHAMP}
        />
      </label>

      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Valable (jours)
          </span>
          <input
            name="jours"
            type="number"
            min={1}
            max={90}
            defaultValue={14}
            className={CHAMP}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Entre 1 et 90. Une invitation qui n&apos;expire pas est une porte entrouverte.
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Note interne (facultative)
          </span>
          <input name="note" placeholder="Poste, équipe…" className={CHAMP} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{enCours ? "Envoi…" : "Inviter"}</SubmitButton>
        <Message etat={etat} />
      </div>
    </form>
  );
}

const TON_INVITATION: Record<
  EtatInvitation,
  { libelle: string; ton: "warning" | "positive" | "neutral" | "critical" }
> = {
  enAttente: { libelle: "En attente", ton: "warning" },
  acceptee: { libelle: "Acceptée", ton: "positive" },
  expiree: { libelle: "Expirée", ton: "neutral" },
  retiree: { libelle: "Retirée", ton: "critical" },
};

function LigneInvitation({
  invitation,
  peutGerer,
}: {
  invitation: Invitation;
  peutGerer: boolean;
}) {
  const [etat, action, enCours] = useActionState(retirerInvitation, ETAT_VIERGE);
  const [ouvert, setOuvert] = useState(false);
  const ton = TON_INVITATION[invitation.etat];

  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[var(--text-body)] font-medium text-ink">{invitation.email}</p>
          <p className="text-[var(--text-secondary)] text-ink-faint">
            {roleLabel(invitation.role)} · invitée le {formatDate(invitation.createdAt)} ·{" "}
            {invitation.etat === "acceptee"
              ? `acceptée le ${formatDate(invitation.acceptedAt)}`
              : `expire le ${formatDate(invitation.expiresAt)}`}
          </p>
          <p className="mt-0.5 max-w-2xl text-[var(--text-secondary)] leading-snug text-ink-faint">
            {invitation.reason}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge tone={ton.ton}>{ton.libelle}</StatusBadge>
          {peutGerer && invitation.etat === "enAttente" && (
            <button
              type="button"
              onClick={() => setOuvert((valeur) => !valeur)}
              className="rounded-[var(--radius-control)] px-2 py-1 text-[var(--text-secondary)] font-medium text-ink-soft transition-colors hover:bg-surface-raised hover:text-ink"
            >
              {ouvert ? "Annuler" : "Retirer"}
            </button>
          )}
        </div>
      </div>

      {ouvert && (
        <form action={action} className="mt-3 flex max-w-2xl flex-col gap-2">
          <input type="hidden" name="email" value={invitation.email} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Motif du retrait <span className="text-critical">*</span>
            </span>
            <textarea name="motif" required rows={2} className={CHAMP} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton variant="danger">
              {enCours ? "Retrait…" : "Retirer l'invitation"}
            </SubmitButton>
            <Message etat={etat} />
          </div>
          <p className="text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Si un compte a déjà été créé pour cette adresse, il existe toujours — il n&apos;est
            simplement plus administrateur en devenir. Le retirer entièrement se fait depuis le
            tableau de bord Supabase.
          </p>
        </form>
      )}
    </li>
  );
}

export function ListeInvitations({
  invitations,
  peutGerer,
}: {
  invitations: Invitation[];
  peutGerer: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {invitations.map((invitation) => (
        <LigneInvitation
          key={invitation.email}
          invitation={invitation}
          peutGerer={peutGerer}
        />
      ))}
    </ul>
  );
}
