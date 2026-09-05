import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  TechnicalId,
  UnknownValue,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { formatDateTime, formatRelative, shortId } from "@/lib/format";
import { EcranAssistanceFerme } from "@/lib/support/ecran-ferme";
import {
  etatSession,
  LIBELLES_ETAT_SESSION,
  phraseTempsRestant,
  resumeRessources,
  secondesRestantes,
  tonDe,
  TONS_ETAT_SESSION,
} from "@/lib/support/libelles";
import { diagnostiquerSocleAssistance } from "@/lib/support/socle";
import {
  lireCatalogueNiveaux,
  lireJournalAcces,
  lireSession,
  resoudreAdresse,
  resoudreEntreprise,
  type CatalogueNiveaux,
} from "@/lib/support/source";
import type { AccesJournalise, SessionAssistance } from "@/lib/support/types";

import { FormulaireRevocation } from "../revoquer";

/**
 * ==================================================================
 * LE DOSSIER D'UNE SESSION D'ASSISTANCE
 * ==================================================================
 *
 * Spec p.20 : une SupportSession porte adminUser, customer,
 * organization, reason, accessLevel, start, expiration, consent, audit.
 * Les neuf sont ici, et le neuvième — l'audit — est la moitié la plus
 * utile.
 *
 * ------------------------------------------------------------------
 * DEUX JOURNAUX, ET ILS NE DISENT PAS LA MÊME CHOSE
 * ------------------------------------------------------------------
 *   • `admin_audit_events` dit que la session a été OUVERTE, par qui,
 *     pourquoi, et qu'elle a été fermée. C'est le geste.
 *   • `support_access_log` dit ce qui a été REGARDÉ : une ligne par
 *     usage, avec la table et l'identifiant visé. C'est l'usage.
 *
 * « Il a ouvert une session » ne dit pas ce qu'il a regardé, et c'est
 * précisément la question du client. Cette page montre le second, et
 * renvoie au premier.
 *
 * ------------------------------------------------------------------
 * LE CLIENT LIT CETTE PAGE, EN SUBSTANCE
 * ------------------------------------------------------------------
 * Pas cette URL — elle est dans le Control Center — mais les mêmes
 * lignes : les politiques de 0081 § 8.b donnent au client concerné
 * l'accès à sa session et à son journal d'accès. Tout ce qui est écrit
 * ici doit donc pouvoir être lu par lui sans embarras.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/support/sessions/[sessionId]">): Promise<Metadata> {
  const { sessionId } = await params;
  return { title: `Session ${sessionId.slice(0, 8)}… — Oasis Care Control Center` };
}

function Fait({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-0">
      <p className="eyebrow mb-1">{label}</p>
      <div className="text-[var(--text-body)] text-ink">{children}</div>
    </div>
  );
}

function JournalAcces({ acces }: { acces: AccesJournalise[] }) {
  if (acces.length === 0) {
    return (
      <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
        <p>
          <strong className="text-ink">Aucune donnée n&apos;a été consultée</strong> sous couvert
          de cette session.
        </p>
        <p className="mt-2">
          Ce zéro est exact, et il le sera durablement : à ce jour, aucun écran du Control Center
          n&apos;appelle{" "}
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
            support_session_record_access()
          </code>
          , qui est le seul chemin d&apos;accès. La session encadre donc une porte que personne
          n&apos;a encore construite — et c&apos;est l&apos;ordre voulu : la serrure avant la
          porte, jamais l&apos;inverse.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {acces.map((ligne) => (
        <li key={ligne.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
          <span
            className="tabular text-[var(--text-secondary)] text-ink-faint"
            title={formatDateTime(ligne.occurred_at) ?? undefined}
          >
            {formatRelative(ligne.occurred_at)}
          </span>
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink">
            {ligne.resource}
          </code>
          {ligne.target_id !== null && (
            <span className="font-mono text-[11px] text-ink-soft">{shortId(ligne.target_id)}</span>
          )}
          {ligne.detail !== null && ligne.detail !== undefined && (
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-faint">
              {JSON.stringify(ligne.detail)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function FicheSessionPage({
  params,
}: PageProps<"/support/sessions/[sessionId]">) {
  const admin = await requireAdmin();
  const socle = await diagnostiquerSocleAssistance(admin.permissions, "support.sessions.read");

  if (socle.etat !== "ok") {
    return (
      <EcranAssistanceFerme
        etat={socle.etat}
        requise="support.sessions.read"
        titre="Session d'assistance"
      />
    );
  }

  const { sessionId } = await params;
  if (!UUID.test(sessionId)) notFound();

  // Le `notFound()` est HORS du `try` : il lève une erreur que Next
  // intercepte, et un `catch` la transformerait en « la lecture a
  // échoué » — un message faux pour une session qui n'existe pas.
  let lue: SessionAssistance | null = null;
  let acces: AccesJournalise[] = [];
  let catalogue: CatalogueNiveaux = { niveaux: [], ressources: new Map() };
  try {
    lue = await lireSession(sessionId);
    if (lue !== null) {
      [acces, catalogue] = await Promise.all([
        lireJournalAcces(sessionId),
        lireCatalogueNiveaux(),
      ]);
    }
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Assistance" title="Session d'assistance" />
        <ReadFailure error={error} />
      </>
    );
  }

  if (lue === null) notFound();
  const session = lue;

  const [adresse, nomEntreprise] = await Promise.all([
    session.customer_user_id !== null
      ? resoudreAdresse(session.customer_user_id)
      : Promise.resolve(null),
    session.organization_id !== null
      ? resoudreEntreprise(session.organization_id)
      : Promise.resolve(null),
  ]);

  const etat = etatSession(session);
  const ouverte = etat === "active" || etat === "consentement-attendu";
  const niveau = catalogue.niveaux.find((candidat) => candidat.key === session.access_level);
  const ressources = (catalogue.ressources.get(session.access_level) ?? []).map(
    (r) => r.resource,
  );

  return (
    <>
      <PageHeader
        eyebrow="Assistance"
        breadcrumb={{ label: "Sessions d'assistance", href: "/support/sessions" }}
        title={niveau?.label ?? session.access_level}
        subtitle={`Ouverte ${formatRelative(session.started_at) ?? "à une date inconnue"} par ${
          shortId(session.admin_user_id) ?? "un administrateur"
        } (${session.admin_role}).`}
        action={
          <StatusBadge tone={tonDe(TONS_ETAT_SESSION, etat)}>
            {LIBELLES_ETAT_SESSION[etat]}
            {etat === "active"
              ? ` — ${phraseTempsRestant(secondesRestantes(session.expires_at))}`
              : ""}
          </StatusBadge>
        }
      />

      {etat === "consentement-attendu" && (
        <Notice tone="info" title="Cette session n'ouvre rien pour l'instant">
          Le niveau « {niveau?.label ?? session.access_level} » exige le consentement du client, et
          il ne l&apos;a pas encore donné. La base refusera tout accès tant que ce ne sera pas
          fait —{" "}
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
            grant_support_session_consent()
          </code>{" "}
          n&apos;est appelable QUE par le client concerné, jamais par un administrateur. Un
          consentement qu&apos;on pourrait cocher à la place de quelqu&apos;un n&apos;est pas un
          consentement.
        </Notice>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel
            title="Ce que cette session ouvre"
            description="La liste des tables nommées par le niveau. Rien d'autre ne passe."
          >
            <div className="px-4 py-3">
              <p className="text-[var(--text-body)] leading-relaxed text-ink">
                {resumeRessources(ressources)}
              </p>
              {niveau?.opens_business_data && (
                <p className="mt-2 text-[var(--text-secondary)] font-semibold leading-relaxed text-critical">
                  Ce niveau ouvre des données métier du client.
                </p>
              )}
              {niveau === undefined && (
                <p className="mt-2">
                  <UnknownValue
                    inline
                    label="Niveau inconnu du catalogue"
                    reason="La session porte un niveau qui n'existe plus dans support_access_levels. La clé étrangère l'interdit normalement : si vous lisez ceci, la table a été modifiée à la main."
                  />
                </p>
              )}
            </div>
          </Panel>

          <Panel
            title="Journal d'accès"
            count={acces.length}
            description="Une ligne par LECTURE — pas une par session. « Il a ouvert une session » ne dit pas ce qu'il a regardé."
          >
            <JournalAcces acces={acces} />
          </Panel>

          {ouverte && (
            <Panel
              title="Fermer cette session"
              description="Avant l'échéance. Le motif est lisible par le client."
            >
              <FormulaireRevocation sessionId={session.id} />
            </Panel>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Qui, chez qui, pourquoi">
            <Fait label="Administrateur">
              <span className="font-mono text-[12px] text-ink-soft">
                {shortId(session.admin_user_id)}
              </span>
              <span className="ml-2 text-[var(--text-secondary)] text-ink-faint">
                rôle au moment de l&apos;ouverture : {session.admin_role}
              </span>
            </Fait>

            <Fait label="Cible">
              {session.organization_id !== null ? (
                <Link
                  href={`/organisations/${session.organization_id}`}
                  className="font-medium text-accent hover:underline"
                >
                  {nomEntreprise ?? shortId(session.organization_id)}
                </Link>
              ) : session.customer_user_id !== null ? (
                <Link
                  href={`/utilisateurs/${session.customer_user_id}`}
                  className="font-medium text-accent hover:underline"
                >
                  {adresse ?? shortId(session.customer_user_id)}
                </Link>
              ) : (
                <UnknownValue
                  inline
                  label="Cible disparue"
                  reason="Les deux colonnes sont nulles, ce que la contrainte support_sessions_has_a_target interdit à l'insertion. Le compte ou l'entreprise a donc été supprimé depuis (on delete cascade sur la session elle-même : si vous lisez ceci, la ligne a survécu autrement)."
                />
              )}
            </Fait>

            <Fait label="Motif">
              <span className="leading-relaxed">« {session.reason} »</span>
            </Fait>

            <Fait label="Demande rattachée">
              {session.ticket_id === null ? (
                <span className="text-ink-soft">Aucune — session ouverte hors demande.</span>
              ) : (
                <Link
                  href={`/support/${session.ticket_id}`}
                  className="font-medium text-accent hover:underline"
                >
                  Voir la demande {shortId(session.ticket_id)}
                </Link>
              )}
            </Fait>
          </Panel>

          <Panel title="Le temps">
            <Fait label="Ouverte le">{formatDateTime(session.started_at) ?? "—"}</Fait>
            <Fait label="Échéance">
              <span>{formatDateTime(session.expires_at) ?? "—"}</span>
              <p className="mt-1 max-w-2xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                Vérifiée EN BASE à chaque accès, pas seulement affichée. Une page laissée ouverte
                n&apos;ouvre rien de plus une fois l&apos;heure passée.
              </p>
            </Fait>
            <Fait label="Fermée">
              {session.revoked_at === null ? (
                <span className="text-ink-soft">
                  {etat === "expiree"
                    ? "Non fermée à la main : elle est arrivée à échéance."
                    : "Toujours ouverte."}
                </span>
              ) : (
                <>
                  <span>{formatDateTime(session.revoked_at)}</span>
                  <p className="mt-1 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                    par <span className="font-mono">{shortId(session.revoked_by)}</span>
                    {session.revoked_reason !== null ? ` — « ${session.revoked_reason} »` : ""}
                  </p>
                </>
              )}
            </Fait>
          </Panel>

          <Panel title="Le consentement">
            <Fait label="Requis par le niveau">
              {session.consent_required ? "Oui" : "Non — ce niveau n'ouvre aucune donnée métier."}
            </Fait>
            <Fait label="Donné">
              {!session.consent_required ? (
                <span className="text-ink-soft">Sans objet.</span>
              ) : session.consent_given_at === null ? (
                <UnknownValue
                  inline
                  label="Pas encore"
                  reason="Le client n'a pas répondu. La session existe, elle court, et elle n'ouvre rien."
                />
              ) : (
                <>
                  <span>{formatDateTime(session.consent_given_at)}</span>
                  <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
                    par <span className="font-mono">{shortId(session.consent_given_by)}</span>
                  </p>
                </>
              )}
            </Fait>
          </Panel>

          <Panel title="Détails techniques">
            <Fait label="Identifiant de la session">
              <TechnicalId id={session.id} />
            </Fait>
            <Fait label="Ligne d'audit de l'ouverture">
              {session.audit_event_id === null ? (
                <UnknownValue
                  inline
                  label="Non reliée"
                  reason="La session n'a pas d'identifiant d'événement d'audit. admin_start_support_session() en pose un systématiquement : une session sans lien a donc été créée autrement."
                />
              ) : (
                <>
                  <TechnicalId id={session.audit_event_id} />
                  <p className="mt-1">
                    <Link
                      href="/securite/journal?famille=assistance"
                      className="text-[var(--text-secondary)] font-medium text-accent hover:underline"
                    >
                      Voir le journal des actions administratives
                    </Link>
                  </p>
                </>
              )}
            </Fait>
          </Panel>
        </div>
      </div>
    </>
  );
}
