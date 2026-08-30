import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { PageHeader, Card, Badge } from "@/components/ui";
import {
  ROLE_LABELS,
  BUSINESS_TYPE_LABELS,
  PERMISSIONS,
  type Role,
} from "@/lib/auth/permissions";
import { OrganizationForm } from "./OrganizationForm";
import { IdentityForm, type OrganizationIdentity } from "./IdentityForm";

/**
 * Organisation, membres et droits — la partie visible de ce que
 * Milestone 1 a construit.
 *
 * L'invitation d'un membre n'est pas encore branchée ici : la table et
 * la fonction d'acceptation existent (0043), mais envoyer l'e-mail
 * demande une Edge Function. Afficher un bouton qui ne poste rien
 * serait pire que de ne rien afficher.
 */
export default async function SettingsPage() {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const supabase = await createClient();
  const [{ data: members }, { data: identity }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("id, role, created_at, user_id")
      .is("archived_at", null)
      .order("created_at"),
    supabase
      .from("business_organizations")
      .select(
        "legal_name, legal_form, siret, vat_number, rcs_city, share_capital_cents, address_line1, address_line2, postal_code, city, email, phone, website, insurance_details",
      )
      .eq("id", organization.organizationId)
      .maybeSingle(),
  ]);

  const canEditIdentity = organization.permissions.includes("organization.manageUsers");

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader title="Paramètres" subtitle="Organisation, équipe et droits d'accès." />

      <Card className="mb-4 p-5">
        <h2 className="mb-3 text-sm font-semibold">Organisation</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Row label="Nom" value={organization.name} />
          <Row label="Activité" value={BUSINESS_TYPE_LABELS[organization.businessType]} />
          <Row label="Votre rôle" value={ROLE_LABELS[organization.role]} />
          <Row label="Espace de travail" value={organization.workspaceId} mono />
        </dl>

        <OrganizationForm
          name={organization.name}
          businessType={organization.businessType}
          canEdit={organization.permissions.includes("organization.manageUsers")}
        />
      </Card>

      <Card className="mb-4 p-5">
        <h2 className="mb-1 text-sm font-semibold">Identité légale</h2>
        <p className="mb-4 text-xs text-ink-faint">
          Ces informations composent l&apos;entête de vos devis et de vos
          factures, et l&apos;exemplaire que vos clients consultent dans leur
          portail.
        </p>
        <IdentityForm
          identity={(identity ?? {}) as OrganizationIdentity}
          canEdit={canEditIdentity}
        />
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">Équipe</h2>
          <span className="text-xs text-ink-faint">{members?.length ?? 0}</span>
        </div>
        <ul className="divide-y divide-line">
          {(members ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between px-5 py-3">
              <span className="mono truncate text-sm text-ink-soft">{m.user_id}</span>
              <Badge tone={m.role === "owner" ? "accent" : "neutral"}>
                {ROLE_LABELS[m.role as Role]}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-xs text-ink-faint">
          L&apos;invitation par e-mail arrive avec l&apos;envoi de messages côté
          serveur. La table et l&apos;acceptation d&apos;invitation existent déjà en
          base.
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="mb-1 text-sm font-semibold">Vos droits</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Ces droits sont vérifiés en base à chaque requête, pas seulement dans
          l&apos;interface : masquer un bouton ne protège rien.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PERMISSIONS.map((permission) => {
            const granted = organization.permissions.includes(permission);
            return (
              <span
                key={permission}
                className={`rounded px-2 py-1 font-mono text-[11px] ${
                  granted ? "bg-accent-wash text-accent" : "bg-canvas text-ink-faint line-through"
                }`}
              >
                {permission}
              </span>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className={`mt-0.5 truncate text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
