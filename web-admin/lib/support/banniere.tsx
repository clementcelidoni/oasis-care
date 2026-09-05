import "server-only";

import Link from "next/link";

import { CompteARebours } from "./compte-a-rebours.tsx";
import { mesSessionsOuvertes } from "./source.ts";
import type { SessionOuverteMienne } from "./types.ts";

/**
 * ==================================================================
 * LA BANNIÈRE PERMANENTE — spec p.21
 * ==================================================================
 *
 *     SUPPORT MODE
 *     Read Only
 *     Session expires in 18 min
 *
 * TROIS INFORMATIONS, ET LA SPEC LES DEMANDE ENSEMBLE : qu'on est en
 * mode assistance, que c'est en lecture seule, et combien de temps il
 * reste. La troisième sans les deux premières serait une horloge ; les
 * deux premières sans la troisième laisseraient croire à un accès
 * permanent.
 *
 * ------------------------------------------------------------------
 * CE QU'ELLE EST, ET CE QU'ELLE N'EST PAS
 * ------------------------------------------------------------------
 * Elle est un AVERTISSEMENT — pour l'administrateur, qui doit savoir
 * qu'il travaille sous un accès qui court, et pour quiconque regarde
 * son écran par-dessus son épaule. Elle N'EST PAS la sécurité :
 * l'expiration est vérifiée en SQL par
 * `support_session_record_access()` à chaque accès, et une bannière
 * masquée ou un onglet jamais rafraîchi n'ouvre rien de plus.
 *
 * « Read Only » n'est pas une promesse de l'interface non plus : il
 * n'existe AUCUNE fonction d'écriture sous session d'assistance dans
 * 0081. Pas de `support_session_record_write`. La lecture seule est
 * une propriété du schéma, pas une politesse de cet écran.
 *
 * ------------------------------------------------------------------
 * POURQUOI ELLE PEUT MONTRER PLUSIEURS SESSIONS
 * ------------------------------------------------------------------
 * Rien n'interdit d'en ouvrir deux — sur deux clients différents, un
 * jour d'incident. Les afficher toutes évite le pire cas : croire
 * qu'on n'en a qu'une, fermer celle qu'on voit, et laisser l'autre
 * courir.
 *
 * ------------------------------------------------------------------
 * OÙ ELLE VIT, ET POURQUOI PAS AILLEURS
 * ------------------------------------------------------------------
 * Dans `app/(control)/layout.tsx`, et NULLE PART AILLEURS. C'est ce qui
 * la rend permanente au sens de la spec.
 *
 * Elle a d'abord été posée dans les quatre écrans d'assistance et de
 * sécurité — c'est-à-dire là où l'on n'a justement pas besoin d'être
 * rappelé qu'on a un dossier client ouvert. Sur « Organisations », sur
 * « Utilisateurs », sur le tableau de bord, elle disparaissait. Ces
 * quatre appels locaux ont été retirés en même temps qu'elle montait
 * dans la coquille : les laisser l'aurait affichée deux fois.
 *
 * Ne l'appelez donc pas depuis une page. Elle est déjà là.
 */
export async function BanniereSessionsOuvertes() {
  let sessions: SessionOuverteMienne[];
  try {
    sessions = await mesSessionsOuvertes();
  } catch {
    // Une bannière qui plante emporterait la page entière. Elle est un
    // ornement de sécurité, pas une porte : son absence ne donne accès
    // à rien, et l'écran qu'elle surplombe reste utile.
    return null;
  }

  if (sessions.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-5 rounded-[var(--radius-card)] border border-warning/40 bg-warning-wash px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[var(--radius-pill)] bg-warning px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-surface">
          Mode assistance
        </span>
        <span className="text-[var(--text-secondary)] font-semibold text-warning">
          Lecture seule
        </span>
        <span className="text-[var(--text-secondary)] text-ink-soft">
          {sessions.length === 1
            ? "Une session d'accès est ouverte à votre nom."
            : `${sessions.length} sessions d'accès sont ouvertes à votre nom.`}
        </span>
      </div>

      <ul className="mt-2 flex flex-col gap-1.5">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[var(--text-secondary)] text-ink-soft"
          >
            <CompteARebours
              expiresAt={session.expires_at}
              secondesInitiales={session.seconds_remaining}
            />
            <span className="text-ink">{session.access_level}</span>
            {session.opens_business_data && (
              <span className="font-semibold text-critical">ouvre des données métier</span>
            )}
            {session.consent_required && session.consent_given_at === null && (
              <span className="font-semibold text-info">
                en attente du consentement du client — n&apos;ouvre rien pour l&apos;instant
              </span>
            )}
            <span className="truncate">« {session.reason} »</span>
            <Link
              href={`/support/sessions/${session.id}`}
              className="font-medium text-accent hover:underline"
            >
              Voir et fermer
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-2 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
        Le décompte est un affichage. Ce qui ferme réellement l&apos;accès est la vérification
        de l&apos;échéance faite en base à chaque lecture — une page laissée ouverte n&apos;ouvre
        rien de plus.
      </p>
    </div>
  );
}
