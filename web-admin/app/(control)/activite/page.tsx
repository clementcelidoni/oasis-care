import type { Metadata } from "next";

import { LiveRefresh } from "@/components/dashboard/live-refresh";
import { ReadError } from "@/components/dashboard/read-error";
import { UnknownsPanel } from "@/components/dashboard/unknowns";
import { WindowPicker } from "@/components/dashboard/window-picker";
import { MetricCard, PageHeader, Panel, SectionHeader, StatStrip } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { combineReasons, reasonFor, sumKnown } from "@/lib/dashboard/aggregate";
import { readLiveActivity } from "@/lib/dashboard/source";
import type { LiveActivityRow } from "@/lib/dashboard/types";
import { resolveActivityWindow } from "@/lib/dashboard/windows";
import { formatCount, formatDateTime, formatTime } from "@/lib/format";

/**
 * ==================================================================
 * L'ACTIVITÉ EN DIRECT — spec p.4-5
 * ==================================================================
 *
 * Huit chiffres demandés : nouvelles inscriptions, nouvelles
 * entreprises, conversions Premium, conversions Pro, résiliations,
 * connexions actives, consommation IA, erreurs importantes. CINQ sont
 * hors d'atteinte aujourd'hui — les conversions Premium et Pro, les
 * résiliations, la consommation IA, les erreurs — chacun pour une
 * raison différente qu'il faut pouvoir lire à l'écran : le webhook
 * Apple n'a jamais écrit une ligne, rien n'écrit les abonnements
 * d'entreprise, les compteurs d'IA sont mensuels et cumulatifs (donc
 * insécables au jour), et il n'existe aucune table d'erreurs.
 *
 * Le sixième, « connexions actives », est le plus traître : deux
 * chiffres s'en approchent et aucun ne le mesure. La dernière section
 * de la page dit lequel dit quoi, parce qu'un chiffre approché affiché
 * sans cette phrase serait pris pour la réponse.
 *
 * ------------------------------------------------------------------
 * POURQUOI TOUTES LES FENÊTRES SE TERMINENT MAINTENANT
 * ------------------------------------------------------------------
 * Ce n'est pas une commodité d'interface. « Comptes connectés » est
 * dérivé de `last_sign_in_at`, qui ne retient que la DERNIÈRE
 * connexion de chaque compte : « dernière connexion postérieure à X »
 * n'est l'ensemble des comptes connectés depuis X que si la fenêtre se
 * termine à l'instant présent. Offrir « hier » rendrait un nombre
 * faux, silencieusement. On ne l'offre donc pas.
 */

export const metadata: Metadata = {
  title: "Activité en direct — Oasis Care Control Center",
};

/** Un écran d'activité servi depuis un cache n'est pas un écran d'activité. */
export const dynamic = "force-dynamic";

const UNKNOWN_LABELS: Record<string, string> = {
  premium_conversions: "Conversions Premium (mobile)",
  pro_conversions: "Conversions Pro (entreprises)",
  mobile_cancellations: "Résiliations mobile",
  pro_cancellations: "Résiliations Pro",
  ai_requests: "Consommation IA sur la fenêtre",
  important_errors: "Erreurs importantes",
};

export default async function ActivitePage({
  searchParams,
}: {
  // `searchParams` est une promesse dans cette version de Next :
  // l'attendre n'est pas facultatif.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdmin("platform.dashboard.read");

  const params = await searchParams;
  const observed = resolveActivityWindow(params.fenetre);

  let activity: LiveActivityRow;
  try {
    activity = await readLiveActivity(observed.since);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Vue d'ensemble" title="Activité en direct" />
        <ReadError error={error} />
      </>
    );
  }

  const reasons = activity.unknown_reasons;

  // Mobile et Pro sont deux mondes, mais une résiliation est une
  // résiliation. Tant que l'un des deux est muet, le total l'est.
  const cancellations = sumKnown([
    activity.mobile_cancellations,
    activity.pro_cancellations,
  ]);

  // La seule trace IA horodatée à la journée. Elle s'affiche À CÔTÉ de
  // la consommation IA inconnue, jamais à sa place : c'est un
  // sous-ensemble — les analyses rattachées à une plante — et le
  // présenter comme « la consommation du jour » serait l'à-peu-près
  // qui finit cité en réunion.
  const plantAnalyses = activity.plant_ai_analyses;

  return (
    <>
      <PageHeader
        eyebrow="Vue d'ensemble"
        title="Activité en direct"
        subtitle={`Ce qui s'est passé sur la plateforme pendant ${observed.description}.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <WindowPicker basePath="/activite" current={observed.key} />
            <LiveRefresh />
          </div>
        }
      />

      <p className="mb-5 text-[var(--text-secondary)] text-ink-faint">
        Fenêtre : depuis le {formatDateTime(activity.since_at) ?? "début inconnu"}, arrêtée à{" "}
        <span className="tabular">{formatTime(activity.until_at) ?? "heure inconnue"}</span> —
        heure de Paris.
      </p>

      <section className="mb-8">
        <SectionHeader
          title="Le mouvement"
          description="Ce qui est entré et ce qui est parti pendant la fenêtre. Les chiffres inconnus le sont parce que la table qui répondrait n'a jamais reçu de ligne, pas parce qu'il ne s'est rien passé."
        />
        <StatStrip
          items={[
            {
              label: "Nouvelles inscriptions",
              value: formatCount(activity.signups),
            },
            {
              label: "Nouvelles entreprises",
              value: formatCount(activity.new_organizations),
            },
            {
              label: "Conversions Premium",
              value: formatCount(activity.premium_conversions),
              unknownReason: reasonFor(reasons, "premium_conversions"),
              // LA RÉSERVE EST À CÔTÉ DU CHIFFRE, pas dans un pavé de
              // bas de page. Le compteur ne retient que la
              // notification SUBSCRIBED d'Apple — une reconduction
              // (DID_RENEW) n'est pas une conversion, et la compter
              // ferait apparaître des dizaines de « conversions » par
              // jour en régime permanent. Reste qu'Apple distingue un
              // premier achat d'un réabonnement par un SOUS-TYPE que le
              // webhook ne stocke pas : un client qui revient est
              // compté ici comme un nouveau.
              note: "Notifications SUBSCRIBED d'Apple. Un client qui se réabonne y est compté comme une conversion : le sous-type qui les distingue n'est pas enregistré.",
            },
            {
              label: "Conversions Pro",
              value: formatCount(activity.pro_conversions),
              unknownReason: reasonFor(reasons, "pro_conversions"),
            },
            {
              label: "Résiliations",
              value: formatCount(cancellations),
              unknownReason: combineReasons(reasons, [
                "mobile_cancellations",
                "pro_cancellations",
              ]),
              note: "Fins de droit effectives (expiration, révocation, remboursement). Une personne qui décoche le renouvellement reste abonnée jusqu'à l'échéance et n'est comptée qu'à ce moment-là.",
            },
          ]}
        />
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Présence, usage et incidents"
          description="Ces cinq-là demandent une précision pour être lus juste : aucun ne mesure tout à fait ce que son nom laisse croire."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            size="small"
            label="Sessions ouvertes"
            value={formatCount(activity.open_sessions)}
            hint="instantané des 30 dernières minutes, indépendant de la fenêtre"
          />
          <MetricCard
            size="small"
            label="Comptes connectés"
            value={formatCount(activity.signed_in_users)}
            hint="des personnes, pas des connexions"
          />
          <MetricCard
            size="small"
            label="Consommation IA"
            value={formatCount(activity.ai_requests)}
            unknownReason={reasonFor(reasons, "ai_requests")}
          />
          <MetricCard
            size="small"
            label="Analyses IA de plantes"
            value={formatCount(plantAnalyses)}
            hint="seule trace IA datée au jour — un sous-ensemble"
          />
          <MetricCard
            size="small"
            label="Erreurs importantes"
            value={formatCount(activity.important_errors)}
            unknownReason={reasonFor(reasons, "important_errors")}
          />
        </div>
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Ce que cet écran ne sait pas encore mesurer"
          description="Le détail dit, pour chacun, quelle donnée manque — et ce qu'il faudrait construire pour que le chiffre existe."
        />
        <UnknownsPanel id="inconnus" reasons={reasons} labels={UNKNOWN_LABELS} />
      </section>

      <section className="mb-8">
        <SectionHeader title="Pourquoi « connexions du jour » n'apparaît nulle part" />
        <Panel>
          <div className="max-w-4xl p-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
            <p>
              La spec demande « connexions actives ». Deux chiffres y répondent
              partiellement, et aucun des deux ne compte des connexions.{" "}
              <strong className="font-semibold text-ink">Sessions ouvertes</strong> est un
              instantané : la table des sessions ne contient que les sessions vivantes, et
              la ligne disparaît à la déconnexion — un comptage journalier y serait
              systématiquement sous-évalué.{" "}
              <strong className="font-semibold text-ink">Comptes connectés</strong> compte
              des personnes à partir de leur dernière connexion : deux connexions du même
              compte n&apos;en font qu&apos;une.
            </p>
            <p className="mt-3">
              Le journal qui saurait répondre,{" "}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
                auth.audit_log_entries
              </code>
              , est vide sur ce projet. Tant qu&apos;il le reste, « combien de connexions
              aujourd&apos;hui » n&apos;a pas de réponse — et un chiffre approché affiché
              sans cette phrase serait pris pour la réponse.
            </p>
          </div>
        </Panel>
      </section>
    </>
  );
}
