import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { Card } from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import {
  PERIODS, PERIOD_LABELS, isPeriod, periodRange,
  formatPercentOrDash, formatHours, formatCount, thresholdTone,
  type Period, type Tone, type LandscaperKpis, type NurseryKpis,
} from "@/lib/analytics/types";

/**
 * §11T ANALYTICS — `ProAnalyticsService`.
 *
 * CHAQUE CHIFFRE DIT COMMENT IL EST CALCULÉ. Un tableau de bord dont on
 * ignore la définition se lit de travers pendant des mois : « ma marge
 * est de 34 % » ne veut rien dire tant qu'on ne sait pas sur quel
 * périmètre, ni sur quelle période. La ligne grise sous chaque nombre
 * n'est pas de la décoration.
 *
 * ET UN TIRET N'EST PAS UN ZÉRO. Les fonctions SQL rendent NULL quand
 * elles ne peuvent pas répondre ; l'écran affiche « — ». Une conversion
 * de 0 % se lit comme un mois catastrophique, alors qu'aucun devis n'a
 * peut-être été envoyé.
 */
export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const organization = await requireOrganization();
  const params = await searchParams;

  const rawPeriod = typeof params.periode === "string" ? params.periode : undefined;
  const period: Period = isPeriod(rawPeriod) ? rawPeriod : "month";
  const { from, to } = periodRange(period);

  const supabase = await createClient();
  const showNursery = ["nursery", "landscaperAndNursery", "horticulturalProducer"].includes(
    organization.businessType,
  );

  const [{ data: landscaper }, { data: nursery }] = await Promise.all([
    supabase.rpc("pro_analytics_landscaper", {
      p_organization_id: organization.organizationId,
      p_from: from,
      p_to: to,
    }),
    showNursery
      ? supabase.rpc("pro_analytics_nursery", {
          p_organization_id: organization.organizationId,
          p_from: from,
          p_to: to,
        })
      : Promise.resolve({ data: null }),
  ]);

  const k = (Array.isArray(landscaper) ? landscaper[0] : landscaper) as LandscaperKpis | undefined;
  const n = (Array.isArray(nursery) ? nursery[0] : nursery) as NurseryKpis | undefined;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Du {new Date(from).toLocaleDateString("fr-FR")} au{" "}
            {new Date(to).toLocaleDateString("fr-FR")}.
          </p>
        </div>

        <nav className="flex flex-wrap gap-1.5">
          {PERIODS.map((option) => (
            <Link
              key={option}
              href={`/analytics?periode=${option}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                option === period
                  ? "bg-accent text-accent-ink"
                  : "border border-line-strong bg-surface hover:bg-canvas"
              }`}
            >
              {PERIOD_LABELS[option]}
            </Link>
          ))}
        </nav>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Activité</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Chiffre d'affaires"
            value={formatCents(k?.revenue_cents ?? 0)}
            note="Le HT des factures émises sur la période. La TVA n'est pas un revenu."
          />
          <Kpi
            label="Devis envoyés"
            value={formatCount(k?.quotes_sent ?? 0)}
            note={`Dont ${formatCount(k?.quotes_accepted ?? 0)} acceptés à ce jour.`}
          />
          <Kpi
            label="Taux de conversion"
            value={formatPercentOrDash(k?.quote_conversion_percent ?? null)}
            tone={thresholdTone(k?.quote_conversion_percent ?? null, { good: 40, warn: 25 })}
            note="Sur les devis ENVOYÉS pendant la période, pas sur les acceptations reçues."
          />
          <Kpi
            label="Panier moyen"
            value={
              k?.average_project_value_cents == null
                ? "—"
                : formatCents(k.average_project_value_cents)
            }
            note="Prix de vente HT moyen des chantiers démarrés sur la période."
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Rentabilité</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Marge chantier"
            value={formatCents(k?.project_margin_cents ?? 0)}
            note={`Sur ${formatCount(k?.projects_measured ?? 0)} chantier(s) terminé(s) sur la période. Un chantier en cours n'a pas de marge.`}
          />
          <Kpi
            label="Taux de marque"
            value={formatPercentOrDash(k?.project_margin_percent ?? null)}
            tone={thresholdTone(k?.project_margin_percent ?? null, { good: 30, warn: 15 })}
            note="Marge rapportée au PRIX DE VENTE, convention du paysage. Le taux de marge, lui, flatte le même chiffre."
          />
          <Kpi
            label="Efficacité main-d'œuvre"
            value={formatPercentOrDash(k?.labor_efficiency_percent ?? null)}
            tone={thresholdTone(k?.labor_efficiency_percent ?? null, { good: 100, warn: 85 })}
            note={`${formatHours(k?.labor_planned_hours ?? null)} prévues pour ${formatHours(k?.labor_actual_hours ?? null)} pointées et validées. Au-dessus de 100 %, on va plus vite que prévu.`}
          />
          <Kpi
            label="Carnet de commandes"
            value={formatCents(k?.backlog_cents ?? 0)}
            note="Le vendu accepté qui n'est pas encore facturé. Photo d'aujourd'hui, pas un cumul."
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Encaissement</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Kpi
            label="Factures en retard"
            value={formatCount(k?.overdue_invoices_count ?? 0)}
            tone={(k?.overdue_invoices_count ?? 0) > 0 ? "critical" : "positive"}
            note="Échéance dépassée et solde non réglé. Indépendant de la période choisie."
            href="/factures"
          />
          <Kpi
            label="Montant impayé"
            value={formatCents(k?.overdue_invoices_cents ?? 0)}
            tone={(k?.overdue_invoices_cents ?? 0) > 0 ? "critical" : "positive"}
            note="Ce qui reste dû, TTC, sur ces factures-là."
            href="/factures"
          />
        </div>
      </section>

      {showNursery && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Pépinière</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Valeur du stock"
              value={formatCents(n?.stock_value_cents ?? 0)}
              note={
                (n?.unpriced_lots ?? 0) > 0
                  ? `Au tarif de VENTE en cours — valeur commerciale, pas comptable. ${formatCount(n?.unpriced_lots ?? 0)} lot(s) sans tarif ne sont pas comptés.`
                  : "Au tarif de VENTE en cours : valeur commerciale, pas une valeur de bilan."
              }
              tone={(n?.unpriced_lots ?? 0) > 0 ? "warning" : "neutral"}
            />
            <Kpi
              label="Disponible à la vente"
              value={formatCount(n?.available_stock ?? 0)}
              note="Sujets à un stade vendable, réservations déduites."
              href="/pepiniere/stock"
            />
            <Kpi
              label="En production"
              value={formatCents(n?.production_value_cents ?? 0)}
              note="Valeur des lots qui n'ont pas encore atteint un stade vendable."
            />
            <Kpi
              label="Rendement de production"
              value={formatPercentOrDash(n?.production_yield_percent ?? null)}
              tone={thresholdTone(n?.production_yield_percent ?? null, { good: 85, warn: 70 })}
              note="Ce qui reste des lots arrivés à un stade vendable, rapporté à ce qui y est entré."
            />
            <Kpi
              label="Taux de perte"
              value={formatPercentOrDash(n?.loss_rate_percent ?? null)}
              tone={thresholdTone(n?.loss_rate_percent ?? null, { good: 5, warn: 10, inverted: true })}
              note="Pertes de la période, rapportées aux pertes + ventes + stock encore debout."
              href="/pepiniere/sante"
            />
            <Kpi
              label="Rotation"
              value={formatPercentOrDash(n?.turnover_percent ?? null)}
              note="Ce qui est sorti en vente sur la période, rapporté au stock présent."
            />
            <Kpi
              label="Stock dormant"
              value={formatCount(n?.dormant_quantity ?? 0)}
              tone={(n?.dormant_lots ?? 0) > 0 ? "warning" : "positive"}
              note={`${formatCount(n?.dormant_lots ?? 0)} lot(s) sans le moindre mouvement depuis six mois.`}
            />
            <Kpi
              label="Occupation des surfaces"
              value={formatPercentOrDash(n?.space_utilization_percent ?? null)}
              note="Sujets présents rapportés à la capacité des emplacements qui en déclarent une."
              href="/pepiniere/emplacements"
            />
          </div>
        </section>
      )}

      <p className="mt-8 text-xs text-ink-faint">
        Ces chiffres sont calculés en base, pas dans le navigateur, et
        n&apos;incluent que les données de {organization.name}. Un pointage non
        validé n&apos;entre dans aucun budget.
      </p>
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: "",
  positive: "text-positive",
  warning: "text-warning",
  critical: "text-critical",
};

function Kpi({
  label, value, note, tone = "neutral", href,
}: {
  label: string;
  value: string;
  note: string;
  tone?: Tone;
  href?: string;
}) {
  const body = (
    <Card className="h-full p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={`tabular mt-1.5 text-2xl font-semibold ${TONE_TEXT[tone]}`}>{value}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">{note}</p>
    </Card>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block transition-opacity hover:opacity-80">
      {body}
    </Link>
  );
}

// Pas de badge « +12 % vs mois dernier » : rien n'archive les valeurs
// passées de ces indicateurs, et une tendance inventée serait pire que
// son absence.
export const dynamic = "force-dynamic";
