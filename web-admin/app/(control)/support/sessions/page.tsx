import type { Metadata } from "next";
import Link from "next/link";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Notice,
  PageHeader,
  Panel,
  SectionHeader,
  StatusBadge,
  UnknownValue,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { formatDateTime, formatRelative, shortId } from "@/lib/format";
import { EcranAssistanceFerme } from "@/lib/support/ecran-ferme";
import { peut } from "@/lib/support/guard";
import {
  etatSession,
  LIBELLES_ETAT_SESSION,
  niveauProposable,
  resumeRessources,
  tonDe,
  TONS_ETAT_SESSION,
} from "@/lib/support/libelles";
import { phraseDeRefus } from "@/lib/support/permissions";
import { diagnostiquerSocleAssistance } from "@/lib/support/socle";
import {
  chargerNomsEntreprises,
  lireCatalogueNiveaux,
  listerSessions,
  type CatalogueNiveaux,
} from "@/lib/support/source";
import type { SessionAssistance } from "@/lib/support/types";

import {
  FormulaireOuvertureSession,
  type NiveauProposable,
  type NiveauRefuse,
} from "./ouvrir-session";
import { FormulaireRevocation } from "./revoquer";

/**
 * ==================================================================
 * LES SESSIONS D'ASSISTANCE — spec p.19-21, LA PARTIE LA PLUS SENSIBLE
 * ==================================================================
 *
 * La spec est catégorique, et cet écran est écrit contre la tentation
 * qu'elle nomme :
 *
 *   « Ne PAS permettre à un administrateur de naviguer librement dans
 *     toutes les données privées d'un client. »
 *   « Par défaut : NO BUSINESS DATA ACCESS. »
 *   « NE PAS CRÉER un bouton caché "Login as customer" sans
 *     garde-fous. »
 *
 * ------------------------------------------------------------------
 * CE QUE CET ÉCRAN FAIT, ET CE QU'IL NE FAIT PAS
 * ------------------------------------------------------------------
 * Il OUVRE et FERME des autorisations bornées. Il n'ouvre AUCUNE
 * donnée, et aucun autre écran du Control Center n'en ouvre non plus :
 * il n'existe à ce jour aucun lecteur qui appelle
 * `support_session_record_access()`. Une session ouverte aujourd'hui
 * autorise donc, littéralement, la lecture de quatre tables techniques
 * — et le fait qu'on ait cherché à la lire est tracé.
 *
 * CE N'EST PAS UNE FAÇADE, ET LA DISTINCTION EST PRÉCISE. Le garde-fou
 * précède l'usage volontairement : poser la cible d'abord, ce serait
 * ouvrir la porte avant de poser la serrure. Une session ouverte ici
 * produit dès aujourd'hui trois effets réels — une ligne d'audit signée
 * et motivée, une trace que LE CLIENT peut lire, et une échéance que la
 * base fera respecter. Le jour où un écran ouvrira une donnée sous
 * couvert d'une session, il n'aura rien à négocier : le contrat existe.
 *
 * ------------------------------------------------------------------
 * IL N'Y A PAS DE BOUTON « SE CONNECTER EN TANT QUE »
 * ------------------------------------------------------------------
 * Ni actif, ni désactivé, ni commenté dans le code. La page le DIT, en
 * bas, parce qu'un exploitant qui ne trouve pas ce bouton doit
 * comprendre qu'il est absent par décision et non par retard — sans
 * quoi quelqu'un finira par le demander comme un manque.
 */

export const metadata: Metadata = {
  title: "Sessions d'assistance — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOuIndefini(valeur: string | string[] | undefined): string | undefined {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur;
  return typeof brut === "string" && UUID.test(brut) ? brut : undefined;
}

function LigneSession({
  session,
  nomEntreprise,
  peutFermer,
}: {
  session: SessionAssistance;
  nomEntreprise: string | null;
  peutFermer: boolean;
}) {
  const etat = etatSession(session);
  const ouverte = etat === "active" || etat === "consentement-attendu";

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tonDe(TONS_ETAT_SESSION, etat)}>
          {LIBELLES_ETAT_SESSION[etat]}
        </StatusBadge>
        <span className="font-medium text-ink">{session.access_level}</span>
        <span className="text-[var(--text-secondary)] text-ink-soft">
          {session.organization_id !== null ? (
            <Link
              href={`/organisations/${session.organization_id}`}
              className="hover:text-accent"
            >
              {nomEntreprise ?? shortId(session.organization_id)}
            </Link>
          ) : session.customer_user_id !== null ? (
            <Link
              href={`/utilisateurs/${session.customer_user_id}`}
              className="font-mono text-[11px] hover:text-accent"
            >
              {shortId(session.customer_user_id)}
            </Link>
          ) : (
            "cible inconnue"
          )}
        </span>
        <Link
          href={`/support/sessions/${session.id}`}
          className="ml-auto text-[var(--text-secondary)] font-medium text-accent hover:underline"
        >
          Journal d&apos;accès
        </Link>
      </div>

      <p className="mt-1 max-w-4xl text-[var(--text-body)] leading-relaxed text-ink-soft">
        « {session.reason} »
      </p>

      <p className="mt-1 flex flex-wrap gap-x-3 text-[var(--text-secondary)] text-ink-faint">
        <span>
          ouverte {formatRelative(session.started_at)} par{" "}
          <span className="font-mono">{shortId(session.admin_user_id)}</span> ({session.admin_role})
        </span>
        <span title={formatDateTime(session.expires_at) ?? undefined}>
          échéance {formatDateTime(session.expires_at)}
        </span>
        {session.revoked_at !== null && (
          <span className="text-critical">
            fermée {formatRelative(session.revoked_at)}
            {session.revoked_reason !== null ? ` — « ${session.revoked_reason} »` : ""}
          </span>
        )}
      </p>

      {ouverte && peutFermer && (
        <div className="mt-2">
          <FormulaireRevocation sessionId={session.id} compact />
        </div>
      )}
    </li>
  );
}

export default async function SessionsAssistancePage({
  searchParams,
}: PageProps<"/support/sessions">) {
  const admin = await requireAdmin();
  const socle = await diagnostiquerSocleAssistance(admin.permissions, "support.sessions.read");

  if (socle.etat !== "ok") {
    return (
      <EcranAssistanceFerme
        etat={socle.etat}
        requise="support.sessions.read"
        titre="Sessions d'assistance"
        sousTitre="Les accès encadrés aux dossiers des clients : qui, chez qui, pourquoi, jusqu'à quand."
      />
    );
  }

  const params = await searchParams;
  const peutOuvrir = peut(admin, "support.sessions.manage");

  let sessions: SessionAssistance[];
  let catalogue: CatalogueNiveaux;
  let noms: Map<string, string>;
  try {
    [sessions, catalogue] = await Promise.all([listerSessions({ limite: 100 }), lireCatalogueNiveaux()]);
    noms = (await chargerNomsEntreprises()).noms;
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Assistance" title="Sessions d'assistance" />
        <ReadFailure error={error} />
      </>
    );
  }

  // Le partage entre ce qui est proposable et ce qui ne l'est pas se
  // fait avec la MÊME fonction que celle qui est testée, et avec les
  // ressources RÉELLEMENT rattachées — pas avec le seul drapeau
  // `is_grantable`, qui ne dit que la moitié de la règle de 0081 § 8.c.
  const proposables: NiveauProposable[] = [];
  const refuses: NiveauRefuse[] = [];
  for (const niveau of catalogue.niveaux) {
    const ressources = (catalogue.ressources.get(niveau.key) ?? []).map((r) => r.resource);
    const verdict = niveauProposable(niveau, ressources.length);
    if (verdict.proposable) {
      proposables.push({
        cle: niveau.key,
        libelle: niveau.label,
        ouvreDonneesMetier: niveau.opens_business_data,
        minutesMax: niveau.max_minutes,
        consentementRequis: niveau.requires_consent,
        ressources,
        note: niveau.note,
      });
    } else {
      refuses.push({ cle: niveau.key, libelle: niveau.label, motif: verdict.motif });
    }
  }

  // « Ouverte » recouvre DEUX états : celle qui court, et celle qui
  // attend le consentement du client. La seconde n'ouvre rien encore —
  // mais elle est vivante, elle a une échéance, et on doit pouvoir la
  // fermer. La ranger avec les sessions terminées la ferait oublier.
  const estOuverte = (session: SessionAssistance) => {
    const etat = etatSession(session);
    return etat === "active" || etat === "consentement-attendu";
  };
  const ouvertes = sessions.filter(estOuverte);
  const closes = sessions.filter((session) => !estOuverte(session));

  return (
    <>
      <PageHeader
        eyebrow="Assistance"
        title="Sessions d'assistance"
        subtitle="Les accès encadrés aux dossiers des clients : qui, chez qui, pourquoi, jusqu'à quand."
      />


      <Notice tone="info" title="Par défaut, aucun accès aux données d'un client">
        Une session est une autorisation <strong>bornée dans le temps</strong>,{" "}
        <strong>motivée</strong>, <strong>en lecture seule</strong> et{" "}
        <strong>visible du client</strong> — la politique de lecture de la base lui donne accès à
        ses propres sessions, et c&apos;est la contrepartie de l&apos;accès, pas une faveur.
        L&apos;échéance est vérifiée <strong>en base à chaque lecture</strong> : ce n&apos;est pas
        un compte à rebours dans le navigateur.
      </Notice>

      {peutOuvrir ? (
        <section className="mb-8">
          <SectionHeader
            title="Ouvrir une session"
            description="Choisissez le niveau le plus étroit qui réponde à la question. Un niveau ouvre une liste de tables nommées, jamais « les données du client »."
          />
          <Panel>
            <FormulaireOuvertureSession
              niveaux={proposables}
              refuses={refuses}
              organisationParDefaut={uuidOuIndefini(params.organisation)}
              compteParDefaut={uuidOuIndefini(params.compte)}
              ticketParDefaut={uuidOuIndefini(params.ticket)}
            />
          </Panel>
        </section>
      ) : (
        <Notice tone="unknown" title="Vous surveillez les sessions, vous n'en ouvrez pas">
          {phraseDeRefus(admin.role, "support.sessions.manage")} C&apos;est délibéré et non un
          oubli : surveiller et faire ne sont pas le même rôle. Vous pouvez en revanche{" "}
          <strong>fermer</strong> n&apos;importe quelle session ouverte — couper doit être plus
          facile qu&apos;ouvrir.
        </Notice>
      )}

      <section className="mb-8">
        <SectionHeader
          title="Sessions en cours"
          count={ouvertes.length}
          description="Un accès qui court en ce moment, chez un client, sous le nom de quelqu'un."
        />
        <Panel>
          {ouvertes.length === 0 ? (
            <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Aucune session ouverte. C&apos;est l&apos;état normal, et le seul rassurant.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {ouvertes.map((session) => (
                <LigneSession
                  key={session.id}
                  session={session}
                  nomEntreprise={
                    session.organization_id !== null
                      ? (noms.get(session.organization_id) ?? null)
                      : null
                  }
                  peutFermer
                />
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Sessions terminées"
          count={closes.length}
          description="Les cent dernières, les plus récentes d'abord. Elles se conservent : c'est la mémoire de qui est entré chez qui."
        />
        <Panel>
          {closes.length === 0 ? (
            <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Aucune session n&apos;a jamais été ouverte.{" "}
              <UnknownValue
                inline
                label="Et ce zéro-là est vrai"
                reason="La table support_sessions n'a de lignes que par admin_start_support_session(), qui est le seul chemin. Un zéro y signifie réellement « personne n'est entré », contrairement aux compteurs dont la source n'existe pas."
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {closes.map((session) => (
                <LigneSession
                  key={session.id}
                  session={session}
                  nomEntreprise={
                    session.organization_id !== null
                      ? (noms.get(session.organization_id) ?? null)
                      : null
                  }
                  peutFermer={false}
                />
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <section className="mb-8">
        <SectionHeader title="Ce que ces sessions n'ouvrent pas, et pourquoi" />
        <Panel>
          <div className="max-w-4xl px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
            <p>
              <strong className="text-ink">
                Il n&apos;existe aucun bouton « se connecter en tant que ce client ».
              </strong>{" "}
              Ni actif, ni désactivé, ni prévu. La spec p.21 l&apos;interdit en toutes lettres, et
              cette page le dit pour qu&apos;on ne prenne pas son absence pour un retard : usurper
              la session de quelqu&apos;un rend son journal illisible — on ne sait plus qui a fait
              quoi — et donne d&apos;un coup tous les droits du client, ce qu&apos;aucun motif ne
              justifie.
            </p>
            <p className="mt-3">
              <strong className="text-ink">Aucune écriture n&apos;est possible</strong> sous
              couvert d&apos;une session. La base n&apos;expose pas de fonction pour cela : il
              n&apos;y a pas de « support_session_record_write ». Ce n&apos;est pas une politesse
              de cet écran, c&apos;est une propriété du schéma.
            </p>
            <p className="mt-3">
              Et les niveaux d&apos;accès sont des <strong className="text-ink">listes de
              tables nommées</strong> :{" "}
              {catalogue.niveaux.length === 0
                ? "aucun niveau n'est déclaré."
                : catalogue.niveaux
                    .map(
                      (niveau) =>
                        `${niveau.label} — ${resumeRessources(
                          (catalogue.ressources.get(niveau.key) ?? []).map((r) => r.resource),
                        ).toLowerCase()}`,
                    )
                    .join(" ")}
            </p>
          </div>
        </Panel>
      </section>
    </>
  );
}
