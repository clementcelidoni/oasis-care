import { PageHeader, Card, Field, SelectField, SubmitButton, ButtonLink } from "@/components/ui";
import { createCustomer } from "@/lib/crm/actions";

export default async function NewCustomerPage({
  searchParams,
}: PageProps<"/crm/clients/nouveau">) {
  const params = await searchParams;
  const isProspect = params.type === "prospect";

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <PageHeader
        title={isProspect ? "Nouveau prospect" : "Nouveau client"}
        subtitle="Seul le nom est obligatoire — le reste se complète au fil des échanges."
      />

      <form action={createCustomer}>
        <input
          type="hidden"
          name="lifecycle_stage"
          value={isProspect ? "lead" : "customer"}
        />

        <Card className="p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="Nom affiché"
                name="display_name"
                required
                placeholder="Famille Martin, ou Jardins du Cap SARL"
              />
            </div>

            <SelectField
              label="Type"
              name="kind"
              defaultValue="individual"
              options={[
                { value: "individual", label: "Particulier" },
                { value: "company", label: "Entreprise" },
              ]}
            />
            <Field label="Origine" name="source" placeholder="Bouche-à-oreille, salon…" />

            <Field label="E-mail" name="email" type="email" placeholder="contact@exemple.fr" />
            <Field label="Téléphone" name="phone" type="tel" placeholder="06 00 00 00 00" />

            <div className="sm:col-span-2">
              <Field label="Adresse de facturation" name="billing_address_line1" />
            </div>
            <Field label="Code postal" name="billing_postal_code" />
            <Field label="Ville" name="billing_city" />

            <div className="sm:col-span-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-ink-soft">Notes</span>
                <textarea
                  name="notes"
                  rows={3}
                  className="rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
                  placeholder="Contexte, contraintes d'accès, préférences…"
                />
              </label>
            </div>
          </div>
        </Card>

        <div className="mt-4 flex items-center gap-2">
          <SubmitButton>Créer la fiche</SubmitButton>
          <ButtonLink
            href={isProspect ? "/crm/prospects" : "/crm/clients"}
            variant="secondary"
          >
            Annuler
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
