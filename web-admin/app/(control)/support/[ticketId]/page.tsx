import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  EmptyState,
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
import { peut } from "@/lib/support/guard";
import {
  etatSession,
  libelle,
  LIBELLES_CANAL,
  LIBELLES_ETAT_SESSION,
  LIBELLES_PRIORITE,
  LIBELLES_PRODUIT,
  LIBELLES_STATUT,
  tonDe,
  TONS_ETAT_SESSION,
  TONS_PRIORITE,
  TONS_STATUT,
} from "@/lib/support/libelles";
import { phraseDeRefus } from "@/lib/support/permissions";
import { diagnostiquerSocleAssistance } from "@/lib/support/socle";
import {
  listerSessions,
  lireDemande,
  lireMessages,
  resoudreAdresse,
  resoudreEntreprise,
} from "@/lib/support/source";
import type { MessageTicket, SessionAssistance, Ticket } from "@/lib/support/types";

import { FormulaireReponse } from "./repondre";

/**
 * ==================================================================
 * FICHE D'UNE DEMANDE — spec p.19
 * ==================================================================
 *
 * Sept éléments demandés :
 *
 *     conversation                ← porté par support_ticket_messages
 *     captures                    ← AUCUNE SOURCE, dit ci-dessous
 *     version application         ← porté par support_tickets
 *     plateforme                  ← porté par support_tickets
 *     erreurs techniques associées ← AUCUNE SOURCE
 *     logs autorisés              ← AUCUNE SOURCE
 *     organisation                ← porté par support_tickets
 *
 * QUATRE SUR SEPT EXISTENT. Les trois autres sont NOMMÉS à l'écran avec
 * leur cause, plutôt que passés sous silence : « aucune table
 * d'erreurs » n'est pas la même information que « ce ticket n'a pas
 * d'erreur associée », et un support qui croit la seconde cherche une
 * panne là où il n'y a qu'une absence d'outillage.
 *
 * ------------------------------------------------------------------
 * CE QUE CETTE FICHE NE MONTRE PAS, ET NE MONTRERA PAS ICI
 * ------------------------------------------------------------------
 * Aucune donnée métier du client : ni ses plantes, ni ses devis, ni ses
 * photos, ni ses clients à lui. La spec p.20 le dit par défaut — NO
 * BUSINESS DATA ACCESS — et p.9 le répétait déjà pour la fiche d'un
 * compte. Ouvrir un dossier passe par une session d'assistance, et
 * cette page ne fait que la PROPOSER, motif à l'appui.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/support/[ticketId]">): Promise<Metadata> {
  const { ticketId } = await params;
  // L'objet d'une demande n'entre PAS dans le titre d'onglet : il
  // finirait dans l'historique du navigateur, et une demande
  // d'assistance parle souvent d'un problème que le client n'a pas
  // envie de voir affiché.
  return { title: `Demande ${ticketId.slice(0, 8)}… — Oasis Care Control Center` };
}

/** Un fait de la fiche : un intitulé, une valeur, et parfois une réserve. */
function Fait({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-0">
      <p className="eyebrow mb-1">{label}</p>
      <div className="text-[var(--text-body)] text-ink">{children}</div>
      {note && (
        <p className="mt-1 max-w-2xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          {note}
        </p>
      )}
    </div>
  );
}

function Conversation({
  messages,
  adresseAuteur,
}: {
  messages: MessageTicket[];
  adresseAuteur: string | null;
}) {
  if (messages.length === 0) {
    return (
      <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
        Aucun message. C&apos;est anormal : `open_support_ticket()` écrit toujours le premier
        message du client dans la même transaction que la demande. Une demande sans message a
        donc été créée autrement — ou ses messages ont été supprimés.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {messages.map((message) => (
        <li
          key={message.id}
          className={`px-4 py-3 ${message.is_internal ? "border-l-2 border-warning bg-warning-wash" : ""}`}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {message.author_kind === "admin" ? (
              <Badge tone="accent">Oasis Care</Badge>
            ) : message.author_kind === "system" ? (
              <Badge tone="neutral">Système</Badge>
            ) : (
              <Badge tone="info">Client</Badge>
            )}
            {message.is_internal && <Badge tone="warning">Note interne</Badge>}
            <span className="text-[var(--text-secondary)] text-ink-faint">
              {message.author_kind === "customer" && adresseAuteur !== null
                ? adresseAuteur
                : (shortId(message.author_user_id) ?? "auteur inconnu")}
            </span>
            <span
              className="text-[var(--text-secondary)] text-ink-faint"
              title={formatDateTime(message.created_at) ?? undefined}
            >
              {formatRelative(message.created_at)}
            </span>
          </div>
          {/* Le texte du client, tel qu'il l'a écrit. `whitespace-pre-wrap`
              garde ses retours à la ligne : un message d'assistance
              contient souvent une liste d'étapes, et l'aplatir le rend
              illisible. */}
          <p className="max-w-4xl whitespace-pre-wrap text-[var(--text-body)] leading-relaxed text-ink">
            {message.body}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default async function FicheDemandePage({ params }: PageProps<"/support/[ticketId]">) {
  const admin = await requireAdmin();
  const socle = await diagnostiquerSocleAssistance(admin.permissions, "support.tickets.read");

  if (socle.etat !== "ok") {
    return (
      <EcranAssistanceFerme
        etat={socle.etat}
        requise="support.tickets.read"
        titre="Demande d'assistance"
      />
    );
  }

  const { ticketId } = await params;
  if (!UUID.test(ticketId)) notFound();

  // LE `notFound()` EST HORS DU `try`, ET CE N'EST PAS UN DÉTAIL DE
  // STYLE : il lève une erreur que Next intercepte pour rendre la page
  // 404. Placé dans le bloc surveillé, il serait attrapé par le `catch`
  // ci-dessous et transformé en « la lecture a échoué » — un message
  // faux, pour une demande qui n'existe simplement pas.
  let lue: Ticket | null = null;
  let messages: MessageTicket[] = [];
  let sessions: SessionAssistance[] = [];
  try {
    lue = await lireDemande(ticketId);
    if (lue !== null) {
      [messages, sessions] = await Promise.all([
        lireMessages(ticketId),
        listerSessions({ ticketId, limite: 20 }),
      ]);
    }
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Assistance" title="Demande d'assistance" />
        <ReadFailure error={error} />
      </>
    );
  }

  if (lue === null) notFound();
  const ticket = lue;

  // Deux résolutions, deux allers-retours, sur une FICHE — jamais dans
  // une liste, où le coût serait multiplié par la taille de la page.
  const [adresse, nomEntreprise] = await Promise.all([
    ticket.user_id !== null ? resoudreAdresse(ticket.user_id) : Promise.resolve(null),
    ticket.organization_id !== null
      ? resoudreEntreprise(ticket.organization_id)
      : Promise.resolve(null),
  ]);

  const peutEcrire = peut(admin, "support.tickets.write");
  const peutOuvrirSession = peut(admin, "support.sessions.manage");
  const cible = ticket.organization_id ?? ticket.user_id;

  return (
    <>
      <PageHeader
        eyebrow="Assistance"
        breadcrumb={{ label: "Demandes d'assistance", href: "/support" }}
        title={ticket.subject}
        subtitle={`Ouverte ${formatRelative(ticket.created_at) ?? "à une date inconnue"} — ${
          formatDateTime(ticket.created_at) ?? "date illisible"
        }`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={tonDe(TONS_STATUT, ticket.status)}>
              {libelle(LIBELLES_STATUT, ticket.status)}
            </StatusBadge>
            <Badge tone={tonDe(TONS_PRIORITE, ticket.priority)}>
              Priorité {libelle(LIBELLES_PRIORITE, ticket.priority).toLowerCase()}
            </Badge>
          </div>
        }
      />


      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Conversation" count={messages.length}>
            <Conversation messages={messages} adresseAuteur={adresse} />
          </Panel>

          {peutEcrire ? (
            <Panel
              title="Répondre"
              description="La réponse part au nom d'Oasis Care, et le geste est journalisé."
            >
              <FormulaireReponse
                ticketId={ticket.id}
                statutActuel={ticket.status}
                dejaAssigne={ticket.assigned_to === admin.userId}
              />
            </Panel>
          ) : (
            <Notice tone="unknown" title="Vous ne pouvez pas répondre">
              {phraseDeRefus(admin.role, "support.tickets.write")}
            </Notice>
          )}

          <Panel
            title="Sessions d'assistance rattachées"
            count={sessions.length}
            description="Les accès encadrés ouverts à l'occasion de cette demande."
          >
            {sessions.length === 0 ? (
              <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
                Aucune session n&apos;a été ouverte pour cette demande. C&apos;est le cas normal :
                répondre à un client ne demande presque jamais d&apos;entrer dans ses données.
                {peutOuvrirSession && cible !== null && (
                  <>
                    {" "}
                    Si c&apos;est nécessaire,{" "}
                    <Link
                      href={`/support/sessions?ticket=${ticket.id}${
                        ticket.organization_id !== null
                          ? `&organisation=${ticket.organization_id}`
                          : `&compte=${ticket.user_id}`
                      }`}
                      className="font-medium text-accent hover:underline"
                    >
                      ouvrez-en une, avec son motif
                    </Link>
                    .
                  </>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {sessions.map((session) => {
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
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Qui, et où">
            <Fait label="Auteur">
              {ticket.user_id === null ? (
                <UnknownValue
                  inline
                  label="Sans auteur"
                  reason="La demande n'est rattachée à aucun compte : soit elle a été saisie par l'équipe pour une entreprise, soit le compte a été supprimé depuis (la colonne est en on delete set null)."
                />
              ) : (
                <Link
                  href={`/utilisateurs/${ticket.user_id}`}
                  className="font-medium text-accent hover:underline"
                >
                  {adresse ?? shortId(ticket.user_id)}
                </Link>
              )}
            </Fait>

            <Fait label="Organisation">
              {ticket.organization_id === null ? (
                <span className="text-ink-soft">
                  Particulier — aucune entreprise rattachée à cette demande.
                </span>
              ) : (
                <Link
                  href={`/organisations/${ticket.organization_id}`}
                  className="font-medium text-accent hover:underline"
                >
                  {nomEntreprise ?? shortId(ticket.organization_id)}
                </Link>
              )}
            </Fait>

            <Fait label="Produit">{libelle(LIBELLES_PRODUIT, ticket.product)}</Fait>
            <Fait
              label="Canal"
              note="Comment la demande est entrée. « Saisie par l'équipe » signifie qu'un administrateur l'a créée pour le client — le contexte technique est alors souvent vide."
            >
              {libelle(LIBELLES_CANAL, ticket.channel)}
            </Fait>

            <Fait label="Assignée à">
              {ticket.assigned_to === null ? (
                <span className="text-ink-soft">Personne</span>
              ) : ticket.assigned_to === admin.userId ? (
                <span className="font-medium text-ink">Vous</span>
              ) : (
                <span className="font-mono text-[11px] text-ink-soft">
                  {shortId(ticket.assigned_to)}
                </span>
              )}
            </Fait>
          </Panel>

          <Panel
            title="Contexte technique"
            description="Recopié à l'ouverture de la demande — pas l'état d'aujourd'hui."
          >
            <Fait
              label="Version de l'application"
              note="La version au moment de l'incident. Celle installée AUJOURD'HUI se lit sur la fiche du compte, et ce n'est pas la même information : entre les deux, le client a pu mettre à jour."
            >
              {ticket.app_version === null ? (
                <UnknownValue
                  inline
                  label="Non transmise"
                  reason="Le canal d'entrée ne l'a pas envoyée. Le formulaire client devra la joindre : c'est précisément ce qu'on n'arrive jamais à faire dire au client après coup."
                />
              ) : (
                <span className="font-mono text-[12px]">
                  {ticket.app_version}
                  {ticket.app_build !== null ? ` (${ticket.app_build})` : ""}
                </span>
              )}
            </Fait>

            <Fait label="Plateforme">
              {ticket.platform === null ? (
                <UnknownValue inline label="Non transmise" reason="Le canal d'entrée ne l'a pas envoyée." />
              ) : (
                <span className="font-mono text-[12px]">
                  {ticket.platform}
                  {ticket.os_version !== null ? ` · ${ticket.os_version}` : ""}
                </span>
              )}
            </Fait>
          </Panel>

          <Panel title="Dates">
            <Fait label="Ouverte">{formatDateTime(ticket.created_at) ?? "—"}</Fait>
            <Fait
              label="Première réponse"
              note="Datée une seule fois : l'écraser à chaque message rendrait le délai toujours excellent. Une note interne ne compte pas comme une réponse."
            >
              {ticket.first_response_at === null ? (
                <UnknownValue
                  inline
                  label="Pas encore répondu"
                  reason="Aucune réponse visible du client n'a été envoyée."
                />
              ) : (
                formatDateTime(ticket.first_response_at)
              )}
            </Fait>
            <Fait label="Résolue">{formatDateTime(ticket.resolved_at) ?? "—"}</Fait>
            <Fait label="Close">{formatDateTime(ticket.closed_at) ?? "—"}</Fait>
          </Panel>

          {/* ------------------------------------------------------------
              CE QUE LA SPEC p.19 DEMANDE ET QUE LA BASE NE PORTE PAS.
              Nommé plutôt que tu : « aucune table d'erreurs » et « ce
              ticket n'a pas d'erreur » sont deux informations
              différentes, et la seconde enverrait chercher une panne
              qui n'a jamais été enregistrée.
             ------------------------------------------------------------ */}
          <Panel title="Ce que cette fiche ne peut pas montrer">
            <Fait label="Captures d'écran">
              <UnknownValue
                inline
                label="Aucune pièce jointe possible"
                reason="0081 ne pose aucune table de pièces jointes et aucun compartiment de stockage n'est prévu pour les demandes. Accepter une image demande de décider où elle vit, qui peut la lire, et combien de temps on la garde — trois décisions que ce lot n'a pas prises."
              />
            </Fait>
            <Fait label="Erreurs techniques associées">
              <UnknownValue
                inline
                label="Aucune table d'erreurs"
                reason="Rien n'enregistre une erreur applicative dans cette base : ni l'application iPhone, ni Oasis Care Pro, ni les Edge Functions. Il n'y a donc rien à rattacher — et surtout pas « aucune erreur », qui serait une affirmation."
              />
            </Fait>
            <Fait label="Journaux autorisés">
              <UnknownValue
                inline
                label="Aucun journal applicatif"
                reason="Même cause. Le seul journal de cette base est celui des ACTIONS ADMINISTRATIVES (admin_audit_events), qui dit ce que l'équipe Oasis Care a fait — pas ce que l'application du client a rencontré."
              />
            </Fait>
          </Panel>

          <Panel title="Détails techniques">
            <Fait label="Identifiant de la demande">
              <TechnicalId id={ticket.id} />
            </Fait>
          </Panel>
        </div>
      </div>

      {messages.length === 0 && (
        <div className="mt-5">
          <EmptyState
            tone="unknown"
            title="Conversation vide"
            description="Voir le panneau « Conversation » : cette demande n'a aucun message, ce qui ne devrait pas arriver par le canal normal."
          />
        </div>
      )}
    </>
  );
}
