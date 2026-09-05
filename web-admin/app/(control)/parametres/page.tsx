import type { Metadata } from "next";

import {
  Badge,
  ButtonLink,
  InfoCard,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  TechnicalId,
  UnknownValue,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { EnrolementTotp } from "@/lib/auth/enrolement-totp";
import {
  PERMISSION_FAMILIES,
  ROLE_SCOPE,
  isPlatformRole,
  permissionLabel,
  roleLabel,
} from "@/lib/auth/roles";
import { formatDate, formatDateTime } from "@/lib/format";

import { OngletsParametres } from "./onglets";

/**
 * ==================================================================
 * PARAMÈTRES → MON COMPTE
 * ==================================================================
 *
 * La demande de l'exploitant était « un onglet paramètre ». Ce qui y est
 * rangé n'est pas arbitraire : tout le reste du Control Center regarde
 * DEHORS — des comptes, des entreprises, de l'argent, de l'assistance.
 * Ces écrans-là regardent DEDANS.
 *
 * ------------------------------------------------------------------
 * POURQUOI CETTE PAGE N'EXIGE AUCUNE PERMISSION
 * ------------------------------------------------------------------
 * `requireAdmin()` est appelée SANS argument : être administrateur de
 * plateforme suffit. C'est le seul écran dans ce cas, et il le doit à
 * son contenu — la fiche de l'appelant et son propre second facteur. Y
 * accrocher une permission de rôle rendrait possible qu'un
 * administrateur ne puisse pas protéger son propre compte, ce qui serait
 * absurde et, sous exigence de second facteur, bloquant.
 *
 * ------------------------------------------------------------------
 * ET SURTOUT : ELLE RESTE OUVERTE SANS SECOND FACTEUR
 * ------------------------------------------------------------------
 * C'est la règle structurelle de tout le sujet. Un administrateur sans
 * facteur doit pouvoir ENTRER pour en poser un. Sous exigence, la garde
 * le renvoie d'abord vers `/second-facteur`, qui porte le même
 * composant d'enrôlement — il n'est donc jamais enfermé dehors. Et en
 * base, `platform_admin_require_mfa()` (0081 § 2.c) est appelée par
 * toutes les ÉCRITURES et par aucune lecture : il peut entrer, regarder,
 * s'enrôler, et rien de plus.
 */

export const metadata: Metadata = {
  title: "Paramètres — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function ParametresPage() {
  const admin = await requireAdmin();
  const { mfa } = admin;

  // Les permissions de l'appelant, rangées par la même clé de lecture
  // que celle du garde-fou de la matrice : le préfixe.
  const familles = PERMISSION_FAMILIES.map((famille) => ({
    ...famille,
    portees: admin.permissions.filter((permission) => permission.startsWith(famille.prefix)),
  })).filter((famille) => famille.portees.length > 0);

  const orphelines = admin.permissions.filter(
    (permission) => !PERMISSION_FAMILIES.some((f) => permission.startsWith(f.prefix)),
  );

  return (
    <>
      <PageHeader
        eyebrow="Paramètres"
        title="Mon compte"
        subtitle="Qui vous êtes pour le Control Center, ce que votre rôle ouvre, et la protection de votre session."
      />

      <OngletsParametres courant="/parametres" />

      {/* ---- Identité ------------------------------------------------ */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Adresse" value={admin.email ?? <UnknownValue label="Sans adresse" />} />
        <InfoCard
          label="Rôle de plateforme"
          value={roleLabel(admin.role)}
          hint={isPlatformRole(admin.role) ? undefined : "Rôle inconnu de cette interface — la base fait foi."}
        />
        <InfoCard
          label="Administrateur depuis"
          value={formatDate(admin.since) ?? <UnknownValue label="Date inconnue" />}
        />
        <InfoCard
          label="Second facteur"
          value={
            mfa.satisfied ? (
              <StatusBadge tone="positive">Présenté sur cette session</StatusBadge>
            ) : mfa.enrolled ? (
              <StatusBadge tone="warning">Enrôlé, non présenté</StatusBadge>
            ) : (
              <StatusBadge tone="critical">Aucun</StatusBadge>
            )
          }
          hint={
            mfa.currentLevel === null
              ? "Niveau de session inconnu."
              : `Session de niveau ${mfa.currentLevel}.`
          }
        />
      </div>

      {/* ---- Ce que le rôle ouvre ------------------------------------ */}
      <div className="mt-5">
        <Panel
          title="Ce que votre rôle ouvre"
          description="Le résumé vient de cette interface ; la liste vient de la base, et c'est elle qui fait foi."
        >
          <div className="px-4 py-3">
            {isPlatformRole(admin.role) && (
              <p className="max-w-3xl text-[var(--text-body)] leading-relaxed text-ink-soft">
                {ROLE_SCOPE[admin.role]}
              </p>
            )}

            {admin.permissions.length === 0 ? (
              <div className="mt-3 unknown-rule rounded-[var(--radius-card)] px-4 py-3">
                <p className="text-[var(--text-body)] font-medium text-ink">
                  Votre rôle ne porte AUCUNE permission.
                </p>
                <p className="mt-1 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                  Ce n&apos;est pas normal, et la cause la plus probable n&apos;est pas votre
                  rôle : c&apos;est le piège de semis de la migration 0075. Les permissions du
                  super-administrateur y ont été semées PAR JOINTURE au moment où elle
                  s&apos;exécutait — une clé ajoutée après coup n&apos;est portée par personne
                  tant qu&apos;une migration ne rejoue pas la jointure. Voyez « Rôles et
                  permissions » : si le catalogue est plein et la colonne de votre rôle vide,
                  c&apos;est exactement ce cas.
                </p>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                {familles.map((famille) => (
                  <div key={famille.prefix}>
                    <p className="eyebrow">{famille.label}</p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {famille.portees.map((permission) => (
                        <li
                          key={permission}
                          className="flex flex-wrap items-baseline gap-2 text-[var(--text-secondary)] leading-relaxed"
                        >
                          <span className="text-ink-soft">{permissionLabel(permission)}</span>
                          <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
                            {permission}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {orphelines.length > 0 && (
                  <div>
                    <p className="eyebrow">Hors des familles connues de cette interface</p>
                    <p className="mt-1 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                      La base porte des permissions dont le préfixe n&apos;est pas décrit ici.
                      C&apos;est une information, pas une erreur : l&apos;interface a un train de
                      retard sur une migration.
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {orphelines.map((permission) => (
                        <li key={permission}>
                          <Badge>{permission}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ---- Le second facteur --------------------------------------- */}
      <div className="mt-5">
        {mfa.required && !mfa.satisfied && (
          <Notice tone="warning" title="Votre session ne satisfait pas l'exigence">
            Vous pouvez lire, et rien d&apos;autre : toutes les écritures administratives sont
            refusées par la base tant que cette session n&apos;est pas de niveau aal2. C&apos;est
            exactement ce que doit faire une console qui exige un second facteur — laisser entrer
            pour s&apos;enrôler, et pas davantage.
          </Notice>
        )}

        <Panel
          title="Authentification à deux facteurs"
          description="Une application d'authentification sur votre téléphone. Le Control Center administre toute la plateforme : un mot de passe volé ne doit pas suffire."
        >
          <div className="px-4 py-4">
            <EnrolementTotp
              satisfait={mfa.satisfied}
              contexte="Le code à six chiffres change toutes les trente secondes et se calcule hors ligne : il n'y a rien à recevoir par SMS, et rien qu'un intercepteur puisse rejouer."
            />
          </div>
        </Panel>
      </div>

      {/* ---- Détails techniques -------------------------------------- */}
      <div className="mt-5">
        <details className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5">
          <summary className="cursor-pointer text-[var(--text-secondary)] font-medium text-ink-soft">
            Afficher détails techniques
          </summary>
          <dl className="mt-3 grid gap-2 text-[var(--text-secondary)] sm:grid-cols-2">
            <div>
              <dt className="eyebrow">Identifiant de compte</dt>
              <dd className="mt-1">
                <TechnicalId id={admin.userId} />
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Niveau de la session</dt>
              <dd className="mt-1 text-ink-soft">{mfa.currentLevel ?? "inconnu"}</dd>
            </div>
            <div>
              <dt className="eyebrow">Facteurs vérifiés / brouillons</dt>
              <dd className="mt-1 text-ink-soft">
                {mfa.verifiedFactors === null ? (
                  <UnknownValue
                    inline
                    label="Non comptés"
                    reason={mfa.databaseUnavailable ?? undefined}
                  />
                ) : (
                  `${mfa.verifiedFactors} / ${mfa.unverifiedFactors ?? 0}`
                )}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Exigence en vigueur</dt>
              <dd className="mt-1 text-ink-soft">
                {mfa.required
                  ? `Oui — imposée par ${mfa.requiredBy === "environnement" ? "l'environnement" : "la base"}`
                  : "Non"}
                {mfa.databaseRequiredFrom &&
                  ` · à partir du ${formatDateTime(mfa.databaseRequiredFrom)}`}
              </dd>
            </div>
          </dl>
        </details>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink href="/parametres/securite" variant="secondary">
          Politique de second facteur de l&apos;équipe
        </ButtonLink>
        <ButtonLink href="/equipe" variant="secondary">
          Équipe Oasis Care
        </ButtonLink>
      </div>
    </>
  );
}
