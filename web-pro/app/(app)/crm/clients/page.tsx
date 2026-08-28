import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, Badge, ButtonLink } from "@/components/ui";
import { formatDate, type Customer } from "@/lib/crm/types";

/**
 * §"CRM → Clients". Same table as Prospects, filtered on
 * `lifecycle_stage` — see migration 0044 for why converting a prospect
 * must not copy their data into a second row.
 */
export default async function ClientsPage({ searchParams }: PageProps<"/crm/clients">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";

  const supabase = await createClient();
  let request = supabase
    .from("crm_customers")
    .select("id, display_name, kind, email, phone, billing_city, created_at, lifecycle_stage, prospect_status, legal_name, mobile, billing_postal_code, source, notes, converted_at")
    .eq("lifecycle_stage", "customer")
    .is("archived_at", null)
    .order("display_name");

  if (query) {
    // `or` with ilike rather than the tsvector index: on a customer list
    // people type three letters of a name and expect a prefix match,
    // which full-text search does not give.
    const safe = query.replace(/[%,()]/g, " ");
    request = request.or(
      `display_name.ilike.%${safe}%,email.ilike.%${safe}%,billing_city.ilike.%${safe}%`,
    );
  }

  const { data, error } = await request;
  const customers = (data ?? []) as Customer[];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Clients"
        subtitle={`${customers.length} fiche${customers.length > 1 ? "s" : ""}`}
        action={<ButtonLink href="/crm/clients/nouveau">Nouveau client</ButtonLink>}
      />

      <form className="mb-4">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Rechercher un nom, un e-mail, une ville…"
          className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </form>

      {error && (
        <p className="mb-4 rounded-lg bg-critical-wash px-3 py-2 text-sm text-critical">
          {error.message}
        </p>
      )}

      {customers.length === 0 ? (
        <EmptyState
          title={query ? "Aucun résultat" : "Aucun client pour l'instant"}
          description={
            query
              ? "Essayez avec un autre nom, e-mail ou ville."
              : "Vos clients apparaîtront ici. Un prospect gagné devient automatiquement un client."
          }
          action={!query && <ButtonLink href="/crm/clients/nouveau">Créer un client</ButtonLink>}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {customers.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/crm/clients/${customer.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{customer.display_name}</p>
                    <p className="truncate text-sm text-ink-soft">
                      {[customer.billing_city, customer.email].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge tone={customer.kind === "company" ? "info" : "neutral"}>
                      {customer.kind === "company" ? "Entreprise" : "Particulier"}
                    </Badge>
                    <span className="tabular text-xs text-ink-faint">
                      {formatDate(customer.converted_at ?? customer.created_at)}
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
