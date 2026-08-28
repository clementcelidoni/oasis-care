import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, SubmitButton } from "@/components/ui";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  SITE_TYPES,
  SITE_TYPE_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  formatAmount,
  formatDate,
  type Customer,
  type Contact,
  type CustomerSite,
  type Opportunity,
  type Activity,
} from "@/lib/crm/types";
import {
  addContact,
  addSite,
  addActivity,
  convertLead,
  updateProspectStatus,
  createGardenForSite,
  createOpportunity,
} from "@/lib/crm/actions";

/**
 * §"CUSTOMER — Une fiche client regroupe : contacts, téléphones, emails,
 * adresses, propriétés, jardins, devis, projets, interventions,
 * factures, documents, photos, historique."
 *
 * Milestone 2 delivers the parts whose data exists: contacts, sites,
 * gardens, opportunities and history. Quotes, projects, interventions
 * and invoices arrive with their own milestones — they are listed here
 * as awaited sections rather than as empty tables pretending to work.
 */
export default async function CustomerPage({ params }: PageProps<"/crm/clients/[id]">) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("crm_customers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // RLS makes an unauthorised row indistinguishable from a missing one,
  // which is the correct behaviour: 404 leaks nothing about whether
  // another company's client exists.
  if (!customer) notFound();
  const c = customer as Customer;

  const [{ data: contacts }, { data: sites }, { data: opportunities }, { data: activities }] =
    await Promise.all([
      supabase.from("crm_contacts").select("*").eq("customer_id", id).is("archived_at", null).order("is_primary", { ascending: false }),
      supabase.from("crm_customer_sites").select("*").eq("customer_id", id).is("archived_at", null).order("name"),
      supabase.from("crm_opportunities").select("*").eq("customer_id", id).is("archived_at", null).order("created_at", { ascending: false }),
      supabase.from("crm_activities").select("*").eq("customer_id", id).is("archived_at", null).order("occurred_at", { ascending: false }).limit(30),
    ]);

  const isLead = c.lifecycle_stage === "lead";

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-8">
        <Link href={isLead ? "/crm/prospects" : "/crm/clients"} className="text-sm text-ink-soft hover:text-ink">
          ← {isLead ? "Prospects" : "Clients"}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{c.display_name}</h1>
          <Badge tone={isLead ? "warning" : "accent"}>{isLead ? "Prospect" : "Client"}</Badge>
          <Badge tone={c.kind === "company" ? "info" : "neutral"}>
            {c.kind === "company" ? "Entreprise" : "Particulier"}
          </Badge>
        </div>
        <p className="mt-1.5 text-sm text-ink-soft">
          {[c.email, c.phone, c.billing_city].filter(Boolean).join(" · ") || "Aucune coordonnée"}
        </p>
      </header>

      {isLead && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <form action={updateProspectStatus} className="flex items-end gap-2">
              <input type="hidden" name="customer_id" value={c.id} />
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-soft">Étape du prospect</span>
                <select
                  name="prospect_status"
                  defaultValue={c.prospect_status}
                  className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                >
                  {PROSPECT_STATUSES.filter((s) => s !== "won").map((s) => (
                    <option key={s} value={s}>{PROSPECT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </label>
              <SubmitButton variant="secondary">Mettre à jour</SubmitButton>
            </form>

            <form action={convertLead}>
              <input type="hidden" name="customer_id" value={c.id} />
              <SubmitButton>Convertir en client</SubmitButton>
            </form>
          </div>
          <p className="mt-3 text-xs text-ink-faint">
            La conversion ne recopie rien : la même fiche change d&apos;étape et
            conserve contacts, propriétés et historique.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Contacts" count={contacts?.length ?? 0}>
          {(contacts ?? []).length > 0 && (
            <ul className="divide-y divide-line">
              {((contacts ?? []) as Contact[]).map((contact) => (
                <li key={contact.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">
                      {[contact.first_name, contact.last_name].filter(Boolean).join(" ")}
                    </p>
                    {contact.is_primary && <Badge tone="accent">Principal</Badge>}
                  </div>
                  <p className="text-xs text-ink-soft">
                    {[contact.job_title, contact.email, contact.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <form action={addContact} className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3">
            <input type="hidden" name="customer_id" value={c.id} />
            <input name="first_name" placeholder="Prénom" className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <input name="last_name" required placeholder="Nom *" className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <input name="email" type="email" placeholder="E-mail" className="w-36 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <SubmitButton variant="secondary">Ajouter</SubmitButton>
          </form>
        </Section>

        <Section title="Propriétés" count={sites?.length ?? 0}>
          {(sites ?? []).length > 0 && (
            <ul className="divide-y divide-line">
              {((sites ?? []) as CustomerSite[]).map((site) => (
                <li key={site.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{site.name}</p>
                      <p className="truncate text-xs text-ink-soft">
                        {[SITE_TYPE_LABELS[site.site_type], site.city].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {site.garden_id ? (
                      <Badge tone="accent">Jardin lié</Badge>
                    ) : (
                      <form action={createGardenForSite} className="flex shrink-0 items-center gap-1">
                        <input type="hidden" name="site_id" value={site.id} />
                        <input type="hidden" name="customer_id" value={c.id} />
                        <input type="hidden" name="garden_name" value={`Jardin ${site.name}`} />
                        <SubmitButton variant="secondary">Créer le jardin</SubmitButton>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <form action={addSite} className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3">
            <input type="hidden" name="customer_id" value={c.id} />
            <input name="name" required placeholder="Nom du site *" className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <select name="site_type" defaultValue="residence" className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent">
              {SITE_TYPES.map((t) => <option key={t} value={t}>{SITE_TYPE_LABELS[t]}</option>)}
            </select>
            <input name="city" placeholder="Ville" className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <SubmitButton variant="secondary">Ajouter</SubmitButton>
          </form>
        </Section>

        <Section title="Opportunités" count={opportunities?.length ?? 0}>
          {(opportunities ?? []).length > 0 && (
            <ul className="divide-y divide-line">
              {((opportunities ?? []) as Opportunity[]).map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.title}</p>
                    <p className="text-xs text-ink-soft">{OPPORTUNITY_STAGE_LABELS[o.stage]}</p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-medium">
                    {formatAmount(o.estimated_value_cents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form action={createOpportunity} className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3">
            <input type="hidden" name="customer_id" value={c.id} />
            <input name="title" required placeholder="Intitulé *" className="w-40 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <input name="estimated_value" inputMode="decimal" placeholder="Montant €" className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <SubmitButton variant="secondary">Ajouter</SubmitButton>
          </form>
        </Section>

        <Section title="À venir">
          <div className="px-4 py-3">
            <p className="text-sm text-ink-soft">
              Devis, projets, interventions et factures apparaîtront sur cette
              fiche aux jalons suivants.
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              Rien n&apos;est affiché tant que le module correspondant n&apos;existe pas.
            </p>
          </div>
        </Section>
      </div>

      <section className="mt-4">
        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Historique</h2>
            <span className="text-xs text-ink-faint">{activities?.length ?? 0}</span>
          </div>
          <form action={addActivity} className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
            <input type="hidden" name="customer_id" value={c.id} />
            <select name="activity_type" defaultValue="note" className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent">
              {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_TYPE_LABELS[t]}</option>)}
            </select>
            <input name="subject" placeholder="Objet" className="w-40 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <input name="body" placeholder="Détail" className="min-w-40 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent" />
            <SubmitButton variant="secondary">Enregistrer</SubmitButton>
          </form>
          {(activities ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">
              Aucun échange enregistré.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {((activities ?? []) as Activity[]).map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-3">
                  <Badge>{ACTIVITY_TYPE_LABELS[a.activity_type]}</Badge>
                  <div className="min-w-0 flex-1">
                    {a.subject && <p className="text-sm font-medium">{a.subject}</p>}
                    {a.body && <p className="text-sm text-ink-soft">{a.body}</p>}
                  </div>
                  <span className="tabular shrink-0 text-xs text-ink-faint">
                    {formatDate(a.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {count !== undefined && <span className="text-xs text-ink-faint">{count}</span>}
      </div>
      {children}
    </Card>
  );
}
