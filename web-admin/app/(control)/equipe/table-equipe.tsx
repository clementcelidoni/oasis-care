"use client";

import { Fragment, useActionState, useState } from "react";

import { Badge, StatusBadge, SubmitButton, TechnicalId } from "@/components/ui";
import {
  ETAT_VIERGE,
  changerRole,
  nommerAdministrateur,
  revoquerAdministrateur,
} from "@/lib/auth/actions";
import { PLATFORM_ROLES, roleLabel } from "@/lib/auth/roles";
import type { MembreEquipe } from "@/lib/auth/equipe";
import { formatDate, formatRelative } from "@/lib/format";

import { CHAMP, ChoixRole, Message } from "./champs";

/**
 * ==================================================================
 * L'ÉQUIPE OASIS CARE — et ses garde-fous MONTRÉS, pas subis
 * ==================================================================
 *
 * Les trois règles de 0081 § 3 sont vérifiées quatre fois : ici, dans la
 * Server Action, dans la fonction `security definer`, et dans un
 * déclencheur `after` qui attrape même l'`update` tapé à la main dans
 * l'éditeur SQL.
 *
 * Cet écran est la PREMIÈRE de ces quatre couches, et la seule qui
 * explique. Les trois autres refusent — c'est leur travail — mais un
 * refus qui arrive après le clic laisse croire à un bug. Donc :
 *
 *   • LE BOUTON « RÉVOQUER » DE SON PROPRE COMPTE N'EXISTE PAS. Pas
 *     grisé : absent. Se retirer son accès n'est pas une opération
 *     risquée qu'on confirme, c'est une opération qui n'a pas de sens.
 *   • CELUI DU DERNIER SUPER-ADMINISTRATEUR ACTIF EST DÉSACTIVÉ, avec la
 *     raison écrite à côté. Là c'est différent : le geste a du sens, il
 *     est simplement interdit tant qu'il n'y a pas de remplaçant, et
 *     l'écran doit dire quoi faire pour le débloquer.
 *   • CHANGER UN RÔLE EXPLIQUE CE QU'IL OUVRE, au moment du choix.
 *     Quelqu'un qui nomme un « Facturation » doit savoir qu'il confie
 *     les prix de tout le catalogue et l'émission de documents
 *     comptables — pas le découvrir dans le journal d'audit.
 */

function GestionMembre({
  membre,
  cestMoi,
  dernierSuperAdmin,
}: {
  membre: MembreEquipe;
  cestMoi: boolean;
  dernierSuperAdmin: boolean;
}) {
  const [etatRole, actionRole, roleEnCours] = useActionState(changerRole, ETAT_VIERGE);
  const [etatRevoc, actionRevoc, revocEnCours] = useActionState(
    revoquerAdministrateur,
    ETAT_VIERGE,
  );
  const [etatReint, actionReint, reintEnCours] = useActionState(
    nommerAdministrateur,
    ETAT_VIERGE,
  );

  // Un compte révoqué ne se « change de rôle » pas : on le réintègre, ce
  // qui est un geste distinct et une ligne de journal distincte
  // (`platformAdmin.reinstated`).
  if (!membre.isActive) {
    return (
      <form action={actionReint} className="flex max-w-2xl flex-col gap-3">
        <input type="hidden" name="userId" value={membre.userId} />
        <p className="text-[var(--text-secondary)] leading-relaxed text-ink-soft">
          Ce compte a été révoqué{membre.revokedAt ? ` le ${formatDate(membre.revokedAt)}` : ""}.
          Le réintégrer réécrit son rôle et sa date de révocation d&apos;un seul geste, et le
          journal le distingue d&apos;une première nomination.
        </p>
        <ChoixRole defaut={membre.role} />
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Motif <span className="text-critical">*</span>
          </span>
          <textarea name="motif" required rows={2} className={CHAMP} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>{reintEnCours ? "Réintégration…" : "Réintégrer"}</SubmitButton>
          <Message etat={etatReint} />
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Changer le rôle ---------------------------------------- */}
      <form action={actionRole} className="flex max-w-2xl flex-col gap-3">
        <input type="hidden" name="userId" value={membre.userId} />
        <p className="text-[var(--text-secondary)] font-semibold text-ink">Changer le rôle</p>
        <ChoixRole
          defaut={PLATFORM_ROLES.find((role) => role !== membre.role) ?? membre.role}
          exclure={membre.role}
        />
        {membre.role === "super_admin" && dernierSuperAdmin && (
          <p className="max-w-2xl rounded-[var(--radius-card)] border border-warning/35 bg-warning-wash px-3 py-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            <strong className="text-warning">Dernier super-administrateur actif.</strong> Le
            rétrograder rendrait la plateforme inadministrable — plus personne ne pourrait nommer
            d&apos;administrateur, puisque <code className="font-mono text-[11px]">platform.admins.manage</code>{" "}
            n&apos;appartient qu&apos;à ce rôle. Nommez d&apos;abord un remplaçant. La base
            refusera de toute façon.
          </p>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Motif <span className="text-critical">*</span>
          </span>
          <textarea
            name="motif"
            required
            rows={2}
            placeholder="Un changement de rôle change ce que la personne peut faire."
            className={CHAMP}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="secondary">
            {roleEnCours ? "Changement…" : "Changer le rôle"}
          </SubmitButton>
          <Message etat={etatRole} />
        </div>
      </form>

      {/* ---- Révoquer ------------------------------------------------ */}
      {cestMoi ? (
        <div className="max-w-2xl rounded-[var(--radius-card)] border border-line bg-surface-sunken px-3 py-2">
          <p className="text-[var(--text-secondary)] font-semibold text-ink">
            Il n&apos;y a pas de bouton pour se révoquer soi-même
          </p>
          <p className="mt-0.5 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            Vous vous enfermeriez dehors, et si vous êtes le dernier super-administrateur, vous
            enfermeriez toute l&apos;équipe. Demandez à un collègue — la base, la fonction et un
            déclencheur refusent tous les trois ce geste, ce n&apos;est pas seulement une absence
            de bouton.
          </p>
        </div>
      ) : (
        <form action={actionRevoc} className="flex max-w-2xl flex-col gap-3">
          <input type="hidden" name="userId" value={membre.userId} />
          <p className="text-[var(--text-secondary)] font-semibold text-ink">Révoquer l&apos;accès</p>
          {dernierSuperAdmin && membre.role === "super_admin" ? (
            <p className="max-w-2xl rounded-[var(--radius-card)] border border-warning/35 bg-warning-wash px-3 py-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              <strong className="text-warning">Révocation impossible :</strong> c&apos;est le
              dernier super-administrateur actif. Sans lui, plus personne ne peut nommer
              d&apos;administrateur et la plateforme devient inadministrable. Nommez un
              remplaçant, puis revenez.
            </p>
          ) : (
            <p className="text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              La fiche est conservée et datée — on ne supprime pas une ligne d&apos;équipe, on la
              ferme. Les sessions d&apos;assistance encore ouvertes par cette personne sont
              refermées dans la même transaction.
            </p>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Motif <span className="text-critical">*</span>
            </span>
            <textarea
              name="motif"
              required
              rows={2}
              disabled={dernierSuperAdmin && membre.role === "super_admin"}
              placeholder="Une révocation se relit un jour, et il faut qu'elle se comprenne."
              className={CHAMP}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={revocEnCours || (dernierSuperAdmin && membre.role === "super_admin")}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-critical/40 bg-critical-wash px-3 py-1.5 text-[var(--text-secondary)] font-medium text-critical transition-colors hover:border-critical disabled:cursor-not-allowed disabled:opacity-50"
            >
              {revocEnCours ? "Révocation…" : "Révoquer"}
            </button>
            <Message etat={etatRevoc} />
          </div>
        </form>
      )}
    </div>
  );
}

export function TableEquipe({
  membres,
  peutGerer,
  moi,
}: {
  membres: MembreEquipe[];
  peutGerer: boolean;
  /** L'identifiant de l'appelant : le seul dont le bouton « révoquer » n'existe pas. */
  moi: string;
}) {
  const [ouvert, setOuvert] = useState<string | null>(null);

  const superAdminsActifs = membres.filter(
    (membre) => membre.isActive && membre.role === "super_admin",
  ).length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[var(--text-body)]">
        <thead>
          <tr className="border-b border-line bg-surface-sunken">
            <th scope="col" className="eyebrow px-4 py-2 text-left">
              Personne
            </th>
            <th scope="col" className="eyebrow px-3 py-2 text-left">
              Rôle
            </th>
            <th scope="col" className="eyebrow px-3 py-2 text-left">
              Second facteur
            </th>
            <th scope="col" className="eyebrow hidden px-3 py-2 text-left xl:table-cell">
              Depuis
            </th>
            <th scope="col" className="eyebrow hidden px-3 py-2 text-left xl:table-cell">
              Dernière connexion
            </th>
            {peutGerer && <th scope="col" className="w-24 px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {membres.map((membre) => {
            const cestMoi = membre.userId === moi;
            const dernierSuperAdmin = superAdminsActifs <= 1;
            const estOuvert = ouvert === membre.userId;

            return (
              <Fragment key={membre.userId}>
                <tr className={`border-b border-line ${membre.isActive ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2.5 align-middle">
                    <p className="font-medium text-ink">
                      {membre.displayName ?? membre.email ?? "Compte sans adresse"}
                      {cestMoi && (
                        <span className="ml-2">
                          <Badge tone="accent">vous</Badge>
                        </span>
                      )}
                    </p>
                    {membre.displayName && membre.email && (
                      <p className="text-[var(--text-secondary)] text-ink-faint">{membre.email}</p>
                    )}
                    {membre.note && (
                      <p className="mt-0.5 max-w-md text-[var(--text-secondary)] leading-snug text-ink-faint">
                        {membre.note}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    <p className="text-ink-soft">{roleLabel(membre.role)}</p>
                    {!membre.isActive && (
                      <StatusBadge tone="critical" dot={false}>
                        Révoqué{membre.revokedAt ? ` le ${formatDate(membre.revokedAt)}` : ""}
                      </StatusBadge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-middle">
                    {membre.hasVerifiedMfa ? (
                      <StatusBadge tone="positive">Posé</StatusBadge>
                    ) : (
                      <StatusBadge tone="critical">Aucun</StatusBadge>
                    )}
                  </td>
                  <td className="hidden px-3 py-2.5 align-middle text-ink-soft xl:table-cell">
                    {formatDate(membre.createdAt)}
                  </td>
                  <td className="hidden px-3 py-2.5 align-middle text-ink-soft xl:table-cell">
                    {membre.lastSignInAt ? (
                      formatRelative(membre.lastSignInAt)
                    ) : (
                      <span
                        className="text-unknown"
                        title="Le serveur d'authentification n'enregistre aucune connexion pour ce compte."
                      >
                        Jamais connecté
                      </span>
                    )}
                  </td>
                  {peutGerer && (
                    <td className="px-3 py-2.5 text-right align-middle">
                      <button
                        type="button"
                        onClick={() => setOuvert(estOuvert ? null : membre.userId)}
                        aria-expanded={estOuvert}
                        className="rounded-[var(--radius-control)] px-2 py-1 text-[var(--text-secondary)] font-medium text-ink-soft transition-colors hover:bg-surface-raised hover:text-ink"
                      >
                        {estOuvert ? "Fermer" : "Gérer"}
                      </button>
                    </td>
                  )}
                </tr>
                {peutGerer && estOuvert && (
                  <tr className="border-b border-line">
                    <td colSpan={6} className="bg-surface-sunken px-4 py-4">
                      <GestionMembre
                        membre={membre}
                        cestMoi={cestMoi}
                        dernierSuperAdmin={dernierSuperAdmin}
                      />
                      <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
                        Identifiant de compte : <TechnicalId id={membre.userId} />
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
