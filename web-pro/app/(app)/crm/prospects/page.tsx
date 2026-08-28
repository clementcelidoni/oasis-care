import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge, ButtonLink } from "@/components/ui";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  formatDate,
  type Customer,
  type ProspectStatus,
} from "@/lib/crm/types";

const STATUS_TONE: Record<ProspectStatus, "neutral" | "info" | "warning" | "accent" | "critical"> = {
  new: "neutral",
  contacted: "info",
  visitScheduled: "info",
  quoteInProgress: "warning",
  quoteSent: "warning",
  won: "accent",
  lost: "critical",
};

/** §"CRM → Prospects", avec le workflow en 7 étapes du document. */
export default async function ProspectsPage({ searchParams }: PageProps<"/crm/prospects">) {
  const params = await searchParams;
  const statusFilter = typeof params.statut === "string" ? params.statut : "";

  const supabase = await createClient();
  let request = supabase
    .from("crm_customers")
    .select("id, display_name, kind, email, phone, billing_city, created_at, lifecycle_stage, prospect_status, legal_name, mobile, billing_postal_code, source, notes, converted_at")
    .eq("lifecycle_stage", "lead")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (statusFilter && (PROSPECT_STATUSES as readonly string[]).includes(statusFilter)) {
    request = request.eq("prospect_status", statusFilter);
  }

  const { data } = await request;
  const prospects = (data ?? []) as Customer[];

  // Counts per status, so the filter chips show what is actually there
  // rather than a row of zeroes.
  const { data: allLeads } = await supabase
    .from("crm_customers")
    .select("prospect_status")
    .eq("lifecycle_stage", "lead")
    .is("archived_at", null);

  const counts = new Map<string, number>();
  for (const row of allLeads ?? []) {
    counts.set(row.prospect_status, (counts.get(row.prospect_status) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Prospects"
        subtitle={`${prospects.length} en cours`}
        action={
          <ButtonLink href="/crm/clients/nouveau?type=prospect">Nouveau prospect</ButtonLink>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip label="Tous" href="/crm/prospects" active={!statusFilter} />
        {PROSPECT_STATUSES.filter((s) => s !== "won").map((status) => (
          <FilterChip
            key={status}
            label={`${PROSPECT_STATUS_LABELS[status]} ${counts.get(status) ?? 0}`}
            href={`/crm/prospects?statut=${status}`}
            active={statusFilter === status}
          />
        ))}
      </div>

      {prospects.length === 0 ? (
        <EmptyState
          title="Aucun prospect"
          description="Les affaires en cours apparaîtront ici, du premier contact au devis envoyé."
          action={<ButtonLink href="/crm/clients/nouveau?type=prospect">Créer un prospect</ButtonLink>}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {prospects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/crm/clients/${p.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.display_name}</p>
                    <p className="truncate text-sm text-ink-soft">
                      {[p.billing_city, p.source && `via ${p.source}`].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge tone={STATUS_TONE[p.prospect_status]}>
                      {PROSPECT_STATUS_LABELS[p.prospect_status]}
                    </Badge>
                    <span className="tabular text-xs text-ink-faint">
                      {formatDate(p.created_at)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function FilterChip({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-accent bg-accent-wash font-medium text-accent"
          : "border-line bg-surface text-ink-soft hover:border-line-strong"
      }`}
    >
      {label}
    </Link>
  );
}
