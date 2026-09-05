import type { Metadata } from "next";

import {
  Badge,
  EmptyState,
  InfoCard,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  UnknownValue,
} from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth/guard";
import { lireEquipe } from "@/lib/auth/equipe";
import { roleLabel } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format";

import { OngletsParametres } from "../onglets";
import { FormulairePolitiqueMfa } from "./formulaire";

/**
 * ==================================================================
 * PARAMÈTRES → SÉCURITÉ DE L'ÉQUIPE (spec p.32, « ADMIN MFA »)
 * ==================================================================
 *
 * Deux sources décident de l'exigence, et cet écran doit dire LAQUELLE
 * s'applique — sinon quelqu'un cochera une case sans effet, ou décochera
 * la mauvaise :
 *
 *   • la BASE (`platform_security_settings`, 0081) : la source normale,
 *     réglable ici, journalisée, avec un délai de grâce facultatif ;
 *   • l'ENVIRONNEMENT (`ADMIN_MFA_POLICY`) : une surcharge
 *     d'exploitation à deux crans, `off` et `require`, qui l'emporte sur
 *     la base. `off` est la sortie de secours du jour où l'enrôlement
 *     TOTP serait désactivé au niveau du projet Supabase.
 *
 * ------------------------------------------------------------------
 * LA LECTURE EST OUVERTE À TOUS LES ADMINISTRATEURS, L'ÉCRITURE NON
 * ------------------------------------------------------------------
 * La politique s'applique à tout le monde ; quelqu'un qui vient
 * d'être renvoyé vers l'écran d'enrôlement a besoin de lire ce qui la
 * lui impose, et depuis quand. La table le permet (`select` pour tout
 * administrateur de plateforme). Seul le FORMULAIRE demande
 * `platform.security.write`, que 0081 accorde au responsable sécurité et
 * au super-administrateur — le garde-fou de la matrice refuse de
 * l'accorder à quiconque d'autre.
 *
 * ------------------------------------------------------------------
 * LE CONTRÔLE AVANT VOL
 * ------------------------------------------------------------------
 * L'écran compte, quand il en a le droit, les administrateurs actifs
 * SANS facteur vérifié. C'est la seule chose qui manquait au réglage
 * pour qu'il cesse d'être un pari : on ne bascule pas une exigence sans
 * savoir combien de personnes elle va arrêter demain matin.
 */

export const metadata: Metadata = {
  title: "Sécurité de l'équipe — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

/** `datetime-local` veut `AAAA-MM-JJTHH:MM`, sans fuseau ni secondes. */
function pourChampDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const deuxChiffres = (valeur: number) => String(valeur).padStart(2, "0");
  return (
    `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}` +
    `T${deuxChiffres(date.getHours())}:${deuxChiffres(date.getMinutes())}`
  );
}

export default async function SecuriteEquipePage() {
  const admin = await requireAdmin();
  const { mfa } = admin;
  const peutEcrire = can(admin, "platform.security.write");

  // Le contrôle avant vol. Il demande `platform.admins.read`, que tous
  // les rôles n'ont pas : son absence n'est pas une panne, et la page
  // continue sans lui plutôt que d'échouer.
  const equipe = can(admin, "platform.admins.read") ? await lireEquipe() : null;
  const actifs =
    equipe?.etat === "ok" ? equipe.valeur.filter((membre) => membre.isActive) : null;
  const nonProteges = actifs ? actifs.filter((membre) => !membre.hasVerifiedMfa) : null;

  return (
    <>
      <PageHeader
        eyebrow="Paramètres"
        title="Sécurité de l'équipe"
        subtitle="L'exigence de second facteur pour tous les administrateurs de plateforme, et qui l'a déjà satisfaite."
      />

      <OngletsParametres courant="/parametres/securite" />

      {mfa.databaseUnavailable && (
        <Notice tone="unknown" title="La base ne porte pas encore cette politique">
          {mfa.databaseUnavailable} Tant que c&apos;est le cas, seule la variable
          d&apos;environnement <code className="font-mono text-[11px]">ADMIN_MFA_POLICY</code>{" "}
          décide, et le formulaire ci-dessous n&apos;a rien à écrire.
        </Notice>
      )}

      {mfa.policy !== "encourage" && (
        <Notice
          tone={mfa.policy === "off" ? "warning" : "info"}
          title={`L'environnement surcharge la base : ADMIN_MFA_POLICY=${mfa.policy}`}
        >
          {mfa.policy === "off"
            ? "L'exigence est LEVÉE quoi que dise la base — c'est la sortie de secours, et elle n'est pas censée rester en place. Le réglage ci-dessous continue d'être enregistré et journalisé, mais il ne s'appliquera qu'une fois cette variable remise à « encourage »."
            : "L'exigence s'applique quoi que dise la base. Le réglage ci-dessous reste utile — il prendra le relais dès que la variable reviendra à « encourage » — mais il ne peut pas la desserrer."}
        </Notice>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard
          label="Exigence en vigueur"
          value={
            mfa.required ? (
              <StatusBadge tone="positive">Oui</StatusBadge>
            ) : (
              <StatusBadge tone="warning">Non</StatusBadge>
            )
          }
          hint={
            mfa.requiredBy === "environnement"
              ? "Imposée par l'environnement du déploiement."
              : mfa.requiredBy === "base"
                ? "Imposée par la politique enregistrée en base."
                : "Aucune source ne l'impose aujourd'hui."
          }
        />
        <InfoCard
          label="Enregistré en base"
          value={
            mfa.databaseRequired === null ? (
              <UnknownValue label="Non lisible" reason={mfa.databaseUnavailable ?? undefined} />
            ) : mfa.databaseRequired ? (
              "Exigé"
            ) : (
              "Non exigé"
            )
          }
          hint={
            mfa.databaseRequiredFrom
              ? `À partir du ${formatDateTime(mfa.databaseRequiredFrom)}${
                  mfa.databaseInForce ? " — déjà en vigueur" : " — pas encore en vigueur"
                }`
              : mfa.databaseRequired
                ? "Sans délai de grâce."
                : undefined
          }
        />
        <InfoCard
          label="Administrateurs actifs"
          value={
            actifs === null ? (
              <UnknownValue
                label="Non comptés"
                reason="Compter demande la permission platform.admins.read, que votre rôle ne porte pas."
              />
            ) : (
              String(actifs.length)
            )
          }
        />
        <InfoCard
          label="Sans second facteur"
          value={
            nonProteges === null ? (
              <UnknownValue
                label="Non comptés"
                reason="Compter demande la permission platform.admins.read, que votre rôle ne porte pas."
              />
            ) : nonProteges.length === 0 ? (
              <StatusBadge tone="positive">Aucun</StatusBadge>
            ) : (
              <StatusBadge tone="critical">{nonProteges.length}</StatusBadge>
            )
          }
          hint={
            nonProteges && nonProteges.length > 0
              ? "Ces comptes ne pourront plus rien écrire dès que l'exigence mordra."
              : undefined
          }
        />
      </div>

      {/* ---- Qui est prêt ------------------------------------------- */}
      {actifs !== null && (
        <div className="mt-5">
          <Panel
            title="État de l'équipe"
            description="Un facteur compté dans auth.mfa_factors, jamais dans un cookie : cette mesure ne peut pas être périmée."
            count={actifs.length}
          >
            {actifs.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState
                  title="Aucun administrateur actif"
                  description="La liste est vide, ce qui ne devrait pas être possible depuis un compte administrateur. Regardez « Équipe Oasis Care »."
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {actifs.map((membre) => (
                  <li
                    key={membre.userId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-[var(--text-body)] font-medium text-ink">
                        {membre.displayName ?? membre.email ?? "Compte sans adresse"}
                      </p>
                      <p className="text-[var(--text-secondary)] text-ink-faint">
                        {roleLabel(membre.role)}
                        {membre.displayName && membre.email ? ` · ${membre.email}` : ""}
                      </p>
                    </div>
                    {membre.hasVerifiedMfa ? (
                      <StatusBadge tone="positive">Second facteur posé</StatusBadge>
                    ) : (
                      <StatusBadge tone="critical">Aucun second facteur</StatusBadge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {/* ---- Le réglage ---------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Politique de second facteur"
          description="Enregistrée en base, journalisée, applicable immédiatement ou à une date choisie."
          action={
            peutEcrire ? undefined : <Badge tone="unknown">Lecture seule pour votre rôle</Badge>
          }
        >
          {peutEcrire ? (
            <FormulairePolitiqueMfa
              exigeInitial={mfa.databaseRequired === true}
              aPartirDeInitial={pourChampDate(mfa.databaseRequiredFrom)}
              nonProteges={nonProteges === null ? null : nonProteges.length}
            />
          ) : (
            <p className="max-w-3xl px-4 py-3 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              Régler cette politique demande la permission{" "}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
                platform.security.write
              </code>
              , que la migration 0081 accorde au responsable sécurité et au
              super-administrateur. Vous en voyez l&apos;état parce qu&apos;elle vous concerne ;
              vous ne la changez pas parce que ce n&apos;est pas votre rôle.
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <p className="eyebrow">L&apos;ordre à respecter</p>
        <ol className="mt-2 flex max-w-3xl list-decimal flex-col gap-1 pl-5 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
          <li>Chacun pose son facteur depuis Paramètres → Mon compte.</li>
          <li>
            Vérifier qu&apos;une session <span className="font-medium text-ink">aal2</span>
            s&apos;obtient réellement — c&apos;est la seule preuve que l&apos;enrôlement TOTP est
            activé sur le projet Supabase, aucune requête SQL ne le dit.
          </li>
          <li>Seulement alors, cocher l&apos;exigence ici.</li>
        </ol>
        <p className="mt-2 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Dans l&apos;autre ordre, personne n&apos;est enfermé dehors — l&apos;écran
          d&apos;enrôlement reste atteignable sans second facteur, c&apos;est sa raison
          d&apos;être — mais si l&apos;enrôlement se révélait désactivé sur le projet, la seule
          sortie serait{" "}
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
            ADMIN_MFA_POLICY=off
          </code>{" "}
          et un redéploiement.
        </p>
      </div>
    </>
  );
}
