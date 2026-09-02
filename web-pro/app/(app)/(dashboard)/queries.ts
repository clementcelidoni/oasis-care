import { createClient } from "@/lib/supabase/server";
import type { OrganizationContext } from "@/lib/auth/organization";
import type { LandscaperKpis } from "@/lib/analytics/types";
import type { ModuleKey } from "@/lib/navigation";
import { INTERVENTION_KIND_LABELS, type InterventionKind } from "@/lib/field/types";
import type { IconName } from "@/components/shell/Icon";

/**
 * §10 DASHBOARD V2 — la collecte.
 *
 * Tout ce que l'écran affiche est ramené ici, en un seul aller-retour
 * parallèle, pour que `page.tsx` ne fasse plus que de la mise en page.
 * Un tableau de bord qui mélange requêtes et JSX devient illisible au
 * troisième indicateur.
 *
 * DEUX RÈGLES TIENNENT CE FICHIER.
 *
 * 1. UN INDICATEUR INCALCULABLE VAUT `null`, JAMAIS ZÉRO. C'est la
 *    leçon du correctif 0059 : « 0 % d'efficacité » se lisait « équipe
 *    catastrophique » là où la vérité était « personne n'a estimé ce
 *    chantier ». `MetricCard` affiche un tiret pour `null`. Un zéro
 *    RÉELLEMENT calculé — aucune facture émise ce mois-ci, donc aucun
 *    chiffre d'affaires — reste un zéro : c'est une réponse.
 *
 * 2. RIEN N'EST RECALCULÉ ICI DE CE QUE LA BASE SAIT DÉJÀ. Le chiffre
 *    d'affaires et les impayés viennent de `pro_analytics_landscaper`
 *    (migrations 0058 et 0059), la même fonction que l'écran Analytics.
 *    Deux définitions du même KPI finissent par donner deux réponses,
 *    et c'est toujours celle qu'on a sous les yeux qu'on croit.
 */

/**
 * Le fuseau dans lequel « aujourd'hui » veut dire quelque chose.
 *
 * Le serveur tourne en UTC. Sans ce fuseau, une intervention de 8 h à
 * Nice s'afficherait à 06:00 dans la timeline, et un chantier planifié
 * le 1er à 00 h 30 tomberait dans le mois précédent.
 */
const TIMEZONE = "Europe/Paris";

/**
 * Au bout de combien de jours un devis envoyé mérite un rappel.
 *
 * C'est une CONVENTION, pas une mesure — d'où le fait qu'elle soit
 * écrite ici, en un seul endroit, et répétée en toutes lettres à
 * l'écran. Un seuil caché produit des alertes que personne ne sait
 * expliquer.
 */
const RELANCE_APRES_JOURS = 15;

/** Combien de jours en avant l'alerte « planning incomplet » regarde. */
const PLANNING_HORIZON_JOURS = 7;

// ---------------------------------------------------------------
// Ce que la page reçoit
// ---------------------------------------------------------------

export type TimelineEntry = {
  id: string;
  time: string;
  title: string;
  detail?: string;
  href?: string;
  tone?: "neutral" | "accent" | "warning" | "critical";
};

export type DashboardAlert = {
  id: string;
  icon: IconName;
  title: string;
  detail: string;
  href: string;
  tone: "warning" | "critical";
};

export type Dashboard = {
  /** §10 « CA DU MOIS » — `null` si la facturation est éteinte (§43). */
  revenue: { cents: number; deltaPercent: number | null } | null;
  /** §10 « DEVIS EN ATTENTE » — montant ET nombre. */
  quotesPending: { count: number; cents: number } | null;
  /** §10 « CHANTIERS ACTIFS ». */
  projects: { inProgress: number; planned: number } | null;
  /** §10 « PÉPINIÈRE » — absent chez un paysagiste sans pépinière. */
  nursery: { plants: number; species: number } | null;

  timeline: TimelineEntry[];
  alerts: DashboardAlert[];
  /** Ce qui a réellement été contrôlé — pour ne pas promettre plus. */
  alertChecks: string[];

  /**
   * Ce que le métier de l'entreprise (§43), ses modules éteints et les
   * permissions de CE compte autorisent à montrer. La page s'en sert
   * pour les cartes d'action de §44 : proposer « Configurer Nursery » à
   * un paysagiste l'enverrait sur un écran qui n'est pas pour lui.
   */
  visible: { invoicing: boolean; quotes: boolean; projects: boolean; nursery: boolean };

  /** §44 PREMIÈRE PAGE : l'entreprise n'a encore rien créé. */
  isBlank: boolean;
};

// ---------------------------------------------------------------
// Dates
// ---------------------------------------------------------------

/** `AAAA-MM-JJ` du jour vécu à Paris, quel que soit le fuseau du serveur. */
export function parisDay(date: Date): string {
  return date.toLocaleDateString("fr-CA", { timeZone: TIMEZONE });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Du 1er du mois à aujourd'hui. */
function monthToDate(dayIso: string): { from: string; to: string } {
  return { from: `${dayIso.slice(0, 7)}-01`, to: dayIso };
}

/**
 * La même tranche de jours, un mois plus tôt.
 *
 * PAS le mois précédent ENTIER. Comparer le 3 du mois à trente jours
 * complets afficherait « −90 % » tous les débuts de mois, et l'écart le
 * plus visible du tableau de bord serait faux douze fois par an. Le 31
 * d'un mois se compare au dernier jour du mois précédent, faute d'un
 * trente-et-unième — l'écran dit sur quoi il compare.
 */
function previousMonthToSameDay(dayIso: string): { from: string; to: string } {
  const [year, month, day] = dayIso.split("-").map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  // Jour 0 du mois suivant = dernier jour de `prevMonth`.
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  return {
    from: `${prevYear}-${pad(prevMonth)}-01`,
    to: `${prevYear}-${pad(prevMonth)}-${pad(Math.min(day, lastDay))}`,
  };
}

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIMEZONE,
});

export const DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TIMEZONE,
});

/** Le nombre de jours entiers écoulés depuis un instant, en jours vécus. */
function daysSince(iso: string, todayIso: string): number {
  const from = Date.parse(`${parisDay(new Date(iso))}T00:00:00Z`);
  const to = Date.parse(`${todayIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// ---------------------------------------------------------------
// La collecte
// ---------------------------------------------------------------

type InterventionRow = {
  id: string;
  title: string;
  kind: InterventionKind;
  status: string;
  scheduled_start: string | null;
  crm_customers: { display_name: string } | null;
  projects: { name: string } | null;
};

type QuoteRow = {
  id: string;
  number: string;
  valid_until: string | null;
  sent_at: string | null;
};

type StockRow = {
  species_name: string | null;
  physical: number | null;
  available: number | null;
  in_production: number | null;
  expected: number | null;
};

/** Les métiers qui ont une pépinière — la même liste que la navigation. */
const NURSERY_TYPES: string[] = ["nursery", "landscaperAndNursery", "horticulturalProducer"];

export async function loadDashboard(organization: OrganizationContext): Promise<Dashboard> {
  const supabase = await createClient();
  const orgId = organization.organizationId;
  const permissions = organization.permissions;

  // §43 — l'entreprise éteint ce dont elle ne se sert pas. Une carte
  // « PÉPINIÈRE » à zéro chez un paysagiste n'est pas une information,
  // c'est un reproche.
  const { data: profile } = await supabase
    .from("business_organizations")
    .select("disabled_modules")
    .eq("id", orgId)
    .maybeSingle();
  const disabled = (profile?.disabled_modules ?? []) as ModuleKey[];

  const showInvoicing = !disabled.includes("invoicing") && permissions.includes("invoice.create");
  const showQuotes = permissions.includes("quotes.read");
  const showProjects = !disabled.includes("projects") && permissions.includes("projects.read");
  const showNursery =
    NURSERY_TYPES.includes(organization.businessType) &&
    !disabled.includes("nursery") &&
    permissions.includes("nursery.stock.manage");

  const today = parisDay(new Date());
  const currentRange = monthToDate(today);
  const previousRange = previousMonthToSameDay(today);

  // La timeline est bornée LARGEMENT en UTC puis filtrée sur le jour
  // parisien : calculer le décalage à la main se trompe deux fois par
  // an, la nuit du changement d'heure.
  const now = Date.now();
  const windowFrom = new Date(now - 36 * 3_600_000).toISOString();
  const windowTo = new Date(now + 36 * 3_600_000).toISOString();
  const horizon = new Date(now + PLANNING_HORIZON_JOURS * 86_400_000).toISOString();

  const [
    currentKpi,
    previousKpi,
    pendingQuotes,
    inProgressProjects,
    plannedProjects,
    stock,
    interventions,
    openQuotes,
    unassigned,
    undated,
    customerCount,
    quoteCount,
    projectCount,
  ] = await Promise.all([
    showInvoicing
      ? supabase.rpc("pro_analytics_landscaper", {
          p_organization_id: orgId,
          p_from: currentRange.from,
          p_to: currentRange.to,
        })
      : Promise.resolve({ data: null }),
    showInvoicing
      ? supabase.rpc("pro_analytics_landscaper", {
          p_organization_id: orgId,
          p_from: previousRange.from,
          p_to: previousRange.to,
        })
      : Promise.resolve({ data: null }),
    showQuotes
      ? supabase
          .from("quotes")
          .select("id")
          .eq("organization_id", orgId)
          .is("archived_at", null)
          .in("status", ["sent", "viewed"])
      : Promise.resolve({ data: null }),
    showProjects
      ? supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("archived_at", null)
          .eq("status", "inProgress")
      : Promise.resolve({ count: null }),
    showProjects
      ? supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .is("archived_at", null)
          .eq("status", "planned")
      : Promise.resolve({ count: null }),
    showNursery
      ? supabase
          .from("nursery_stock")
          .select("species_name, physical, available, in_production, expected")
          .eq("organization_id", orgId)
      : Promise.resolve({ data: null }),
    showProjects
      ? supabase
          .from("field_interventions")
          .select(
            "id, title, kind, status, scheduled_start, crm_customers ( display_name ), projects ( name )",
          )
          .eq("organization_id", orgId)
          .neq("status", "cancelled")
          .gte("scheduled_start", windowFrom)
          .lt("scheduled_start", windowTo)
          .order("scheduled_start")
      : Promise.resolve({ data: null }),
    showQuotes
      ? supabase
          .from("quotes")
          .select("id, number, valid_until, sent_at")
          .eq("organization_id", orgId)
          .is("archived_at", null)
          .in("status", ["sent", "viewed"])
      : Promise.resolve({ data: null }),
    showProjects
      ? supabase
          .from("field_interventions")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .in("status", ["scheduled", "inProgress"])
          .is("team_id", null)
          .gte("scheduled_start", new Date(now).toISOString())
          .lt("scheduled_start", horizon)
      : Promise.resolve({ count: null }),
    showProjects
      ? supabase
          .from("field_interventions")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "scheduled")
          .is("scheduled_start", null)
      : Promise.resolve({ count: null }),
    supabase
      .from("crm_customers")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("archived_at", null),
    supabase
      .from("quotes")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("archived_at", null),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("archived_at", null),
  ]);

  // -------------------------------------------------------------
  // Les cartes
  // -------------------------------------------------------------

  const kpi = firstRow<LandscaperKpis>(currentKpi.data);
  const previousKpiRow = firstRow<LandscaperKpis>(previousKpi.data);

  // Un aller-retour raté vaut `null`, pas zéro : « 0 € de chiffre
  // d'affaires » et « la requête n'a pas répondu » ne se soignent pas
  // de la même façon.
  const revenue = kpi
    ? {
        cents: kpi.revenue_cents,
        // Division par le mois dernier : sans mois dernier, il n'y a
        // pas d'évolution à afficher. Pas 0 %, pas +100 % — rien.
        deltaPercent:
          previousKpiRow && previousKpiRow.revenue_cents > 0
            ? round1(
                ((kpi.revenue_cents - previousKpiRow.revenue_cents) /
                  previousKpiRow.revenue_cents) *
                  100,
              )
            : null,
      }
    : null;

  const pendingIds = ((pendingQuotes.data ?? []) as { id: string }[]).map((row) => row.id);
  let pendingCents = 0;
  if (pendingIds.length > 0) {
    // `quote_totals` est une vue agrégée sur les lignes : un devis sans
    // aucune ligne n'y a PAS de ligne. Il compte donc pour zéro euro,
    // ce qui est exact — il ne chiffre rien.
    const { data: totals } = await supabase
      .from("quote_totals")
      .select("quote_id, total_excluding_vat_cents")
      .in("quote_id", pendingIds);
    pendingCents = (totals ?? []).reduce(
      (sum, row) => sum + ((row.total_excluding_vat_cents as number) ?? 0),
      0,
    );
  }

  const stockRows = (stock.data ?? []) as StockRow[];
  const nursery = showNursery
    ? {
        plants: stockRows.reduce((sum, row) => sum + (row.physical ?? 0), 0),
        species: stockRows.filter((row) => (row.physical ?? 0) > 0).length,
      }
    : null;

  // -------------------------------------------------------------
  // §10 AUJOURD'HUI
  // -------------------------------------------------------------

  const timeline: TimelineEntry[] = ((interventions.data ?? []) as unknown as InterventionRow[])
    .filter((row) => row.scheduled_start !== null && parisDay(new Date(row.scheduled_start)) === today)
    .map((row) => {
      // Le client d'abord, le chantier à défaut : « Villa Martin » situe
      // mieux qu'un numéro de chantier quand on lit sa journée.
      const who = row.crm_customers?.display_name ?? row.projects?.name ?? null;
      const kind = INTERVENTION_KIND_LABELS[row.kind] ?? "Intervention";
      return {
        id: row.id,
        time: TIME_FORMAT.format(new Date(row.scheduled_start as string)),
        title: row.title,
        detail: who ? `${kind} · ${who}` : kind,
        href: `/projets/interventions/${row.id}`,
        tone: row.status === "inProgress" ? ("accent" as const) : ("neutral" as const),
      };
    });

  // -------------------------------------------------------------
  // §10 À SURVEILLER
  // -------------------------------------------------------------

  const alerts: DashboardAlert[] = [];
  const alertChecks: string[] = [];

  if (showQuotes) {
    alertChecks.push("devis à relancer");
    const rows = (openQuotes.data ?? []) as QuoteRow[];
    const isExpired = (quote: QuoteRow) =>
      quote.valid_until !== null && quote.valid_until < today;
    const expired = rows.filter(isExpired);
    const stale = rows.filter(
      (quote) =>
        !isExpired(quote) &&
        quote.sent_at !== null &&
        daysSince(quote.sent_at, today) >= RELANCE_APRES_JOURS,
    );

    if (expired.length > 0) {
      alerts.push({
        id: "devis-expires",
        icon: "quote",
        title: plural(
          expired.length,
          "devis a dépassé sa validité",
          "devis ont dépassé leur validité",
        ),
        detail: "Toujours sans réponse. Prolonger la validité, ou clore le devis.",
        href: "/devis?statut=sent",
        tone: "critical",
      });
    }
    if (stale.length > 0) {
      alerts.push({
        id: "devis-sans-reponse",
        icon: "quote",
        title: plural(stale.length, "devis sans réponse", "devis sans réponse"),
        detail: `Envoyés il y a plus de ${RELANCE_APRES_JOURS} jours, toujours pas décidés.`,
        href: "/devis?statut=sent",
        tone: "warning",
      });
    }
  }

  if (showInvoicing && kpi) {
    alertChecks.push("factures échues");
    if (kpi.overdue_invoices_count > 0) {
      alerts.push({
        id: "factures-echues",
        icon: "invoice",
        title: plural(kpi.overdue_invoices_count, "facture échue", "factures échues"),
        detail: `${euros(kpi.overdue_invoices_cents)} restent dus, échéance dépassée.`,
        href: "/factures?statut=overdue",
        tone: "critical",
      });
    }
  }

  if (showNursery) {
    alertChecks.push("disponibilité pépinière");
    // §10 demande « stock faible ». LE SEUIL N'EXISTE PAS EN BASE :
    // aucune table ne porte de quantité minimale par espèce, et un
    // seuil inventé ici déclencherait des alertes que personne ne
    // pourrait ni expliquer ni régler. Ce qui EST un fait, sans le
    // moindre réglage : une espèce dont il ne reste rien à vendre, rien
    // en production et rien en commande. C'est une rupture constatée,
    // pas une estimation.
    const outOfStock = stockRows.filter(
      (row) =>
        (row.physical ?? 0) > 0 &&
        (row.available ?? 0) === 0 &&
        (row.in_production ?? 0) === 0 &&
        (row.expected ?? 0) === 0,
    );
    if (outOfStock.length > 0) {
      alerts.push({
        id: "pepiniere-rupture",
        icon: "stock",
        title: plural(outOfStock.length, "espèce en rupture", "espèces en rupture"),
        detail: "Plus rien de disponible à la vente, rien en production, rien en commande.",
        href: "/pepiniere/stock",
        tone: "warning",
      });
    }
  }

  if (showProjects) {
    alertChecks.push("planning");
    const withoutTeam = unassigned.count ?? 0;
    const withoutDate = undated.count ?? 0;
    if (withoutTeam > 0) {
      alerts.push({
        id: "planning-sans-equipe",
        icon: "planning",
        title: plural(withoutTeam, "intervention sans équipe", "interventions sans équipe"),
        detail: `Programmée dans les ${PLANNING_HORIZON_JOURS} prochains jours, personne n'est affecté.`,
        href: "/planning",
        tone: "warning",
      });
    }
    if (withoutDate > 0) {
      alerts.push({
        id: "planning-sans-date",
        icon: "interventions",
        title: plural(withoutDate, "intervention à planifier", "interventions à planifier"),
        detail: "Créées sans date : elles n'apparaissent sur aucun planning.",
        href: "/projets/interventions",
        tone: "warning",
      });
    }
  }

  // §44 — « rien » veut dire rien : ni client, ni devis, ni chantier,
  // ni plante. Une pépinière pure n'a pas forcément de client dans le
  // CRM et un paysagiste qui démarre n'a aucun lot ; il faut les quatre
  // pour conclure que l'espace est neuf.
  const isBlank =
    (customerCount.count ?? 0) === 0 &&
    (quoteCount.count ?? 0) === 0 &&
    (projectCount.count ?? 0) === 0 &&
    (nursery?.plants ?? 0) === 0;

  return {
    revenue,
    quotesPending: showQuotes ? { count: pendingIds.length, cents: pendingCents } : null,
    projects: showProjects
      ? { inProgress: inProgressProjects.count ?? 0, planned: plannedProjects.count ?? 0 }
      : null,
    nursery,
    timeline,
    alerts,
    alertChecks,
    visible: {
      invoicing: showInvoicing,
      quotes: showQuotes,
      projects: showProjects,
      nursery: showNursery,
    },
    isBlank,
  };
}

// ---------------------------------------------------------------
// Petits outils
// ---------------------------------------------------------------

/** `rpc()` rend tantôt une ligne, tantôt un tableau d'une ligne. */
function firstRow<T>(data: unknown): T | undefined {
  if (!data) return undefined;
  return (Array.isArray(data) ? data[0] : data) as T | undefined;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function plural(count: number, one: string, many: string): string {
  return `${new Intl.NumberFormat("fr-FR").format(count)} ${count > 1 ? many : one}`;
}

const EUROS_ROUNDED = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Sans les centimes : dans une alerte, « 12 480 € » se lit d'un coup d'œil. */
function euros(cents: number): string {
  return EUROS_ROUNDED.format(cents / 100);
}
