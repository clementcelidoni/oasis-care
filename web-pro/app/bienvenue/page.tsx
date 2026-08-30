import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { getUserOrganizations } from "@/lib/auth/organization";
import { hasPortalAccess } from "@/lib/portal/access";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS } from "@/lib/auth/permissions";

/**
 * First run: create the professional organization.
 *
 * Creation goes through the `create_professional_organization()`
 * Postgres function rather than an insert from here. That function
 * makes the workspace, the organization and the owner membership in one
 * transaction — doing it as three client calls would leave an
 * organization with no owner if the third one failed, locking the user
 * out of the thing they just created.
 */
export default async function WelcomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const organizations = await getUserOrganizations();
  if (organizations.length > 0) redirect("/");

  // Un client invité arrive ici par le chemin le plus court : connexion,
  // pas d'organisation, redirection. Lui demander de créer une
  // entreprise pour lire sa facture serait absurde.
  if (await hasPortalAccess()) redirect("/portail");

  async function createOrganization(formData: FormData) {
    "use server";

    const name = String(formData.get("name") ?? "").trim();
    const businessType = String(formData.get("businessType") ?? "landscaper");
    if (!name) return;

    const supabase = await createClient();
    const { error } = await supabase.rpc("create_professional_organization", {
      org_name: name,
      org_business_type: businessType,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/", "layout");
    redirect("/");
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <div className="mb-6 h-10 w-10 rounded-lg bg-accent" aria-hidden />
          <h1 className="text-2xl font-semibold tracking-tight">
            Créons votre entreprise
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            Oasis Care Pro s&apos;organise autour de votre entreprise. Vous
            pourrez inviter votre équipe ensuite.
          </p>
        </div>

        <form action={createOrganization} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-soft">
              Nom de l&apos;entreprise
            </span>
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Paysages Martin"
              className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-soft">Activité</span>
            <select
              name="businessType"
              defaultValue="landscaper"
              className="rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BUSINESS_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink-faint">
              Détermine les modules affichés. Modifiable à tout moment.
            </span>
          </label>

          <button
            type="submit"
            className="mt-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Créer mon espace
          </button>
        </form>
      </div>
    </main>
  );
}
