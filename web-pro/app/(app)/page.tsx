import { getActiveOrganization } from "@/lib/auth/organization";
import { BUSINESS_TYPE_LABELS, ROLE_LABELS } from "@/lib/auth/permissions";

/**
 * §11A — Dashboard / Oasis Daily.
 *
 * Milestone 1 delivers the shell only. The counts the spec shows
 * ("4 chantiers, 7 interventions, 3 visites…") come from CRM, projects
 * and nursery data that Milestones 2 and beyond create — inventing
 * placeholder numbers here would put fake figures in front of someone
 * who might believe them.
 */
export default async function DashboardPage() {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const now = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          {now}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Bonjour
        </h1>
        <p className="mt-2 text-ink-soft">
          {organization.name} · {BUSINESS_TYPE_LABELS[organization.businessType]}
        </p>
      </header>

      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold">Aujourd&apos;hui</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-soft">
          Votre journée s&apos;affichera ici — chantiers, interventions, visites,
          devis à relancer et commandes à réceptionner. Ces chiffres viendront
          des modules CRM, Projets et Pépinière, qui arrivent aux prochains
          jalons.
        </p>
        <p className="mt-3 text-xs text-ink-faint">
          Aucun chiffre n&apos;est affiché tant qu&apos;il n&apos;y a pas de
          données réelles derrière.
        </p>
      </section>

      <section className="mt-4 grid gap-4 sm:grid-cols-3">
        <InfoTile label="Organisation" value={organization.name} />
        <InfoTile label="Votre rôle" value={ROLE_LABELS[organization.role]} />
        <InfoTile
          label="Permissions"
          value={`${organization.permissions.length}`}
          mono
        />
      </section>
    </div>
  );
}

function InfoTile({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p className={`mt-1 truncate text-lg font-semibold ${mono ? "tabular" : ""}`}>
        {value}
      </p>
    </div>
  );
}
