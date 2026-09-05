import type { Metadata } from "next";
import Link from "next/link";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  ButtonLink,
  Notice,
  PageHeader,
  Panel,
  SectionHeader,
  StatStrip,
  StatusBadge,
  UnknownValue,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { roleLabel } from "@/lib/auth/roles";
import { formatCount, formatDateTime, formatRelative, shortId } from "@/lib/format";
import { borneBasse, LIBELLES_FENETRE } from "@/lib/security/filtres";
import { INDICATEURS_ABSENTS, NOTE_COUVERTURE_MFA } from "@/lib/security/inconnus";
import { libelleAction, tonAction } from "@/lib/security/journal";
import { PERMISSION_SURVEILLANCE_SESSIONS, phraseDeRefus } from "@/lib/security/permissions";
import {
  chargerAdressesAdmins,
  compterEvenements,
  couvertureMfa,
  derniersEvenements,
  lireAdministrateurs,
} from "@/lib/security/source";
import type { EvenementAudit, FicheAdministrateur } from "@/lib/security/types";
import { etatSession, LIBELLES_ETAT_SESSION, tonDe, TONS_ETAT_SESSION } from "@/lib/support/libelles";
import { listerSessions } from "@/lib/support/source";
import type { SessionAssistance } from "@/lib/support/types";

/**
 * ==================================================================
 * LE CENTRE DE SÉCURITÉ — spec p.29
 * ==================================================================
 *
 * Six choses demandées :
 *
 *     failed logins        ← AUCUNE SOURCE
 *     suspicious sessions  ← AUCUNE SOURCE
 *     permission changes   ← admin_audit_events
 *     admin actions        ← admin_audit_events
 *     support sessions     ← support_sessions
 *     API anomalies        ← AUCUNE SOURCE
 *
 * TROIS SUR SIX. Les trois autres sont NOMMÉES, avec leur cause et ce
 * qu'il faudrait construire — jamais affichées en zéro. « 0 connexion
 * échouée » se lit « personne n'a essayé » ; la vérité est « rien ne les
 * compte », et les deux appellent des décisions opposées.
 *
 * ------------------------------------------------------------------
 * UN SEPTIÈME INDICATEUR, QUI N'EST PAS DANS LA SPEC
 * ------------------------------------------------------------------
 * La couverture du second facteur. Elle est ajoutée parce qu'elle est
 * le chiffre le plus actionnable de la page : c'est la seule protection
 * de cette console contre un cookie volé, et c'est aussi le chiffre
 * qu'il faut regarder AVANT de basculer `ADMIN_MFA_POLICY` sur
 * « exigé » — sans quoi on enferme dehors ceux qui n'ont pas de
 * facteur.
 *
 * ------------------------------------------------------------------
 * CETTE PAGE N'ÉCRIT RIEN
 * ------------------------------------------------------------------
 * Sauf un geste, et il est le bon : fermer une session d'assistance, ce
 * qui se fait depuis `/support/sessions`. Le responsable sécurité
 * SURVEILLE — il n'ouvre aucune session, ne nomme personne, ne touche
 * à aucun prix. La page renvoie vers les écrans qui agissent plutôt
 * que de dupliquer leurs formulaires.
 */

export const metadata: Metadata = {
  title: "Centre de sécurité — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

/** La fenêtre des compteurs de cette page. Fixe, et DITE à l'écran. */
const FENETRE = "30j" as const;

function LigneActe({
  evenement,
  adresses,
}: {
  evenement: EvenementAudit;
  adresses: Map<string, string>;
}) {
  const auteur =
    evenement.admin_user_id !== null
      ? (adresses.get(evenement.admin_user_id) ?? shortId(evenement.admin_user_id))
      : null;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tonAction(evenement.action)}>{libelleAction(evenement.action)}</Badge>
        {evenement.target_label !== null && (
          <span className="font-medium text-ink">{evenement.target_label}</span>
        )}
        <span className="ml-auto text-[var(--text-secondary)] text-ink-faint" title={formatDateTime(evenement.occurred_at) ?? undefined}>
          {formatRelative(evenement.occurred_at)}
        </span>
      </div>
      <p className="mt-1 max-w-4xl text-[var(--text-body)] leading-relaxed text-ink-soft">
        « {evenement.reason} »
      </p>
      <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
        {auteur ?? "auteur supprimé depuis"} — {roleLabel(evenement.admin_role)}
      </p>
    </li>
  );
}

export default async function CentreSecuritePage() {
  // `platform.audit.read` : trois des six indicateurs viennent
  // d'`admin_audit_events`, dont la politique de 0075 l'exige. Ouvrir
  // cet écran plus largement l'aurait vidé de sa moitié sans le dire.
  const admin = await requireAdmin("platform.audit.read");

  const depuis = borneBasse(FENETRE);
  const surveilleLesSessions = admin.permissions.includes(PERMISSION_SURVEILLANCE_SESSIONS);

  let actesDroits: number | null;
  let actesTotal: number | null;
  let derniers: EvenementAudit[];
  let adresses: Map<string, string>;
  let fiches: FicheAdministrateur[] | null;
  let sessions: SessionAssistance[] = [];
  try {
    [actesDroits, actesTotal, derniers, adresses, fiches] = await Promise.all([
      compterEvenements("droits", depuis),
      compterEvenements(null, depuis),
      derniersEvenements(14),
      chargerAdressesAdmins(),
      lireAdministrateurs(),
    ]);
    if (surveilleLesSessions) {
      // Une lecture qui peut échouer parce que 0081 n'est pas encore
      // appliquée : elle ne doit pas emporter la page entière, dont les
      // trois quarts reposent sur 0075.
      try {
        sessions = await listerSessions({ limite: 50 });
      } catch {
        sessions = [];
      }
    }
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Sécurité" title="Centre de sécurité" />
        <ReadFailure error={error} />
      </>
    );
  }

  const couverture = couvertureMfa(fiches);
  const ouvertes = sessions.filter((session) => {
    const etat = etatSession(session);
    return etat === "active" || etat === "consentement-attendu";
  });

  return (
    <>
      <PageHeader
        eyebrow="Sécurité"
        title="Centre de sécurité"
        subtitle={`Ce que l'équipe Oasis Care a fait de ses droits, et qui est entré chez qui. Fenêtre : ${LIBELLES_FENETRE[FENETRE].toLowerCase()}.`}
        action={
          <ButtonLink href="/securite/journal" variant="secondary">
            Journal complet
          </ButtonLink>
        }
      />


      <section className="mb-8">
        <SectionHeader
          title="Les quatre chiffres mesurables"
          description="Chacun vient d'une table réelle. Ce que la spec p.29 demande en plus est nommé plus bas, avec sa cause."
        />
        <StatStrip
          items={[
            {
              label: "Changements de droits",
              value: formatCount(actesDroits),
              unknownReason:
                actesDroits === null
                  ? "Le compte n'a pas pu être lu. Ce n'est pas zéro : un échec de lecture ne permet pas d'affirmer que personne n'a touché aux permissions."
                  : null,
              note: "Nominations, changements de rôle, révocations, invitations acceptées, politique de second facteur. Une invitation RETIRÉE n'y figure pas : elle n'accorde rien.",
            },
            {
              label: "Actions administratives",
              value: formatCount(actesTotal),
              unknownReason:
                actesTotal === null ? "Le compte n'a pas pu être lu." : null,
              note: "Tout ce qui est passé par une fonction d'administration. Ce qui a été fait à la main dans l'éditeur SQL n'y est pas — et n'y sera jamais.",
            },
            {
              label: "Sessions d'assistance ouvertes",
              value: surveilleLesSessions ? formatCount(ouvertes.length) : null,
              unknownReason: surveilleLesSessions
                ? null
                : phraseDeRefus(
                    admin.role,
                    PERMISSION_SURVEILLANCE_SESSIONS,
                    "la surveillance des accès aux dossiers clients",
                  ),
              note: surveilleLesSessions
                ? "Instantané. Une session expirée n'est plus ouverte, même si personne ne l'a fermée."
                : undefined,
            },
            {
              label: "Administrateurs sans second facteur",
              value: formatCount(
                couverture.actifs === null || couverture.protegesParUnFacteur === null
                  ? null
                  : couverture.actifs - couverture.protegesParUnFacteur,
              ),
              unknownReason:
                couverture.actifs === null
                  ? "La liste des administrateurs est fermée à votre rôle, ou la migration 0081 n'est pas appliquée. Ce n'est pas « aucun » : c'est « on ne sait pas »."
                  : null,
              note: "Comptés parmi les administrateurs ACTIFS. Un compte révoqué n'a pas besoin de second facteur : il n'entre plus.",
            },
          ]}
        />
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Couverture du second facteur"
          description="La seule protection de cette console contre un cookie volé — et le chiffre à regarder avant d'exiger le second facteur pour tout le monde."
        />
        <Panel>
          {fiches === null ? (
            <div className="px-4 py-4">
              <UnknownValue
                label="Liste des administrateurs fermée"
                reason={phraseDeRefus(
                  admin.role,
                  "platform.admins.read",
                  "la liste des administrateurs et leur second facteur",
                )}
              />
            </div>
          ) : (
            <>
              <div className="border-b border-line px-4 py-3">
                {/* Les deux nombres sont recomptés ICI, depuis `fiches`,
                    plutôt que déballés d'un `number | null` avec un
                    `?? 0`. Ce n'est pas de la coquetterie : dans cette
                    application, un zéro écrit à la place d'un inconnu
                    est le défaut qu'on a corrigé quatre fois, et
                    « 0 administrateur protégé » est exactement le genre
                    d'alarme fausse qu'on ne veut pas fabriquer par
                    commodité de typage. */}
                <p className="text-[var(--text-body)] text-ink">
                  <span className="tabular font-semibold">
                    {fiches.filter((fiche) => fiche.is_active && fiche.has_verified_mfa).length} sur{" "}
                    {fiches.filter((fiche) => fiche.is_active).length}
                  </span>{" "}
                  administrateur{fiches.filter((fiche) => fiche.is_active).length > 1 ? "s" : ""}{" "}
                  actif{fiches.filter((fiche) => fiche.is_active).length > 1 ? "s" : ""} ont un
                  facteur vérifié.
                </p>
                {/* CE QUE LA POLITIQUE EXIGE AUJOURD'HUI, et QUI
                    l'impose. `admin.mfa` est déjà résolu par la garde :
                    aucune lecture de plus. La distinction
                    environnement / base compte au moment de basculer —
                    la variable d'environnement est la sortie de secours
                    documentée, la base ne l'est pas. */}
                <p className="mt-1 text-[var(--text-body)] text-ink-soft">
                  {admin.mfa.required ? (
                    <>
                      Le second facteur est{" "}
                      <strong className="text-ink">exigé</strong> pour les administrateurs
                      {admin.mfa.requiredBy === "environnement"
                        ? " par la variable d'environnement ADMIN_MFA_POLICY."
                        : admin.mfa.requiredBy === "base"
                          ? " par la politique enregistrée en base."
                          : "."}
                    </>
                  ) : (
                    <>
                      Le second facteur n&apos;est{" "}
                      <strong className="text-ink">pas encore exigé</strong> : chacun entre sans.
                      Les ÉCRITURES administratives, elles, le demandent déjà — 0081 § 2 fait
                      passer chaque fonction d&apos;écriture par{" "}
                      <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
                        platform_admin_require_mfa()
                      </code>
                      , et aucune lecture. Un administrateur sans facteur entre, regarde,
                      s&apos;enrôle, et rien de plus.
                    </>
                  )}{" "}
                  <Link
                    href="/parametres/securite"
                    className="font-medium text-accent hover:underline"
                  >
                    Régler la politique
                  </Link>
                </p>
                <p className="mt-1 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                  {NOTE_COUVERTURE_MFA}
                </p>
              </div>

              {couverture.sansFacteur.length === 0 ? (
                <div className="px-4 py-3 text-[var(--text-body)] text-positive">
                  Tout le monde est protégé. La politique peut être basculée sur « exigé » sans
                  enfermer personne dehors.
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {couverture.sansFacteur.map((fiche) => (
                    <li
                      key={fiche.user_id}
                      className="flex flex-wrap items-center gap-2 px-4 py-2.5"
                    >
                      <StatusBadge tone="warning">Sans second facteur</StatusBadge>
                      <span className="font-medium text-ink">
                        {fiche.email ?? fiche.display_name ?? shortId(fiche.user_id)}
                      </span>
                      <span className="text-[var(--text-secondary)] text-ink-soft">
                        {roleLabel(fiche.role)}
                      </span>
                      <span className="ml-auto text-[var(--text-secondary)] text-ink-faint">
                        {fiche.last_sign_in_at === null
                          ? "jamais connecté"
                          : `vu ${formatRelative(fiche.last_sign_in_at)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Panel>
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Accès aux dossiers clients"
          count={surveilleLesSessions ? sessions.length : undefined}
          description="Qui est entré chez qui, pourquoi, et jusqu'à quand. Fermer une session est le seul geste que la sécurité puisse poser ici."
          action={
            surveilleLesSessions ? (
              <ButtonLink href="/support/sessions" variant="secondary">
                Ouvrir la surveillance
              </ButtonLink>
            ) : undefined
          }
        />
        <Panel>
          {!surveilleLesSessions ? (
            <div className="px-4 py-4">
              <UnknownValue
                label="Fermé à votre rôle"
                reason={phraseDeRefus(
                  admin.role,
                  PERMISSION_SURVEILLANCE_SESSIONS,
                  "la liste des sessions d'assistance",
                )}
              />
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Aucune session d&apos;assistance n&apos;a jamais été ouverte — ou la migration 0081
              n&apos;est pas appliquée et la table n&apos;existe pas encore. Les deux se lisent
              pareil ici ; la page{" "}
              <Link href="/support/sessions" className="font-medium text-accent hover:underline">
                Sessions d&apos;assistance
              </Link>{" "}
              les distingue.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {sessions.slice(0, 12).map((session) => {
                const etat = etatSession(session);
                return (
                  <li key={session.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                    <StatusBadge tone={tonDe(TONS_ETAT_SESSION, etat)}>
                      {LIBELLES_ETAT_SESSION[etat]}
                    </StatusBadge>
                    <span className="font-medium text-ink">{session.access_level}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)] text-ink-soft">
                      « {session.reason} »
                    </span>
                    <span className="text-[var(--text-secondary)] text-ink-faint">
                      {formatRelative(session.started_at)}
                    </span>
                    <Link
                      href={`/support/sessions/${session.id}`}
                      className="text-[var(--text-secondary)] font-medium text-accent hover:underline"
                    >
                      Détail
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Les derniers actes administratifs"
          description="Toutes familles confondues, les plus récents d'abord."
          action={
            <ButtonLink href="/securite/journal?famille=droits" variant="ghost">
              Filtrer sur les droits
            </ButtonLink>
          }
        />
        <Panel>
          {derniers.length === 0 ? (
            <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
              <p>
                <strong className="text-ink">Le journal est vide.</strong> Ce zéro-là est vrai :
                la table existe depuis 0075 et n&apos;a reçu aucune ligne.
              </p>
              <p className="mt-2">
                Attention à ce qu&apos;il ne dit pas. Le journal ne contient que ce qui est passé
                par une FONCTION d&apos;administration. Un réglage changé à la main dans
                l&apos;éditeur SQL n&apos;y figure pas, et n&apos;y figurera jamais — c&apos;est la
                limite de ce dispositif, et elle vaut d&apos;être connue de celui qui le relit.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {derniers.map((evenement) => (
                <LigneActe key={evenement.id} evenement={evenement} adresses={adresses} />
              ))}
            </ul>
          )}
        </Panel>
      </section>

      {/* ------------------------------------------------------------
          LES TROIS INDICATEURS DE LA SPEC p.29 QUI N'ONT AUCUNE SOURCE.
          Affichés plutôt que masqués : un centre de sécurité qui
          montrerait trois cases sur six sans un mot laisserait croire
          qu'on surveille les connexions échouées.
         ------------------------------------------------------------ */}
      <section className="mb-8">
        <SectionHeader
          title="Ce que cet écran ne surveille pas, et pourquoi"
          description="Trois des six indicateurs de la spec p.29 n'ont aucune source dans cette base. Ils sont nommés ici plutôt qu'affichés en zéro."
        />
        <div className="grid gap-3 lg:grid-cols-3">
          {INDICATEURS_ABSENTS.map((indicateur) => (
            <div
              key={indicateur.libelle}
              className="unknown-rule rounded-[var(--radius-card)] p-4"
            >
              <p className="text-[length:var(--text-card)] font-semibold text-ink">
                {indicateur.libelle}
              </p>
              <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                {indicateur.raison}
              </p>
              {indicateur.approche && (
                <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-warning">
                  {indicateur.approche}
                </p>
              )}
              <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                <span className="font-medium">Ce qu&apos;il faudrait :</span> {indicateur.remede}
              </p>
            </div>
          ))}
        </div>
      </section>

      <Notice tone="info" title="Une limite structurelle, à connaître avant de conclure quoi que ce soit">
        Ce journal enregistre ce qui est passé par une fonction d&apos;administration
        <strong> de cette application</strong>. Une modification faite directement dans
        l&apos;éditeur SQL de Supabase, avec la clé de service, n&apos;y laisse aucune trace. La
        parade n&apos;est pas dans cet écran : elle est dans le fait que{" "}
        <Link href="/parametres/roles" className="font-medium text-accent hover:underline">
          les tables administratives n&apos;ont aucune politique d&apos;écriture
        </Link>{" "}
        — le chemin normal passe donc forcément par une fonction, qui journalise ou refuse.
      </Notice>
    </>
  );
}
