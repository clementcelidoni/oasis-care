import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { PageHeader, Panel, SubmitButton, Field, SelectField, Badge } from "@/components/ui";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS } from "@/lib/auth/permissions";
import { updateCompanyProfile, updateCompanyAdministration } from "@/lib/company/actions";
import { CompanyTabs } from "./CompanyTabs";
import { LogoUploader } from "./LogoUploader";

/**
 * §11 MA SOCIÉTÉ — « Créer une vraie page ».
 *
 * §1 PHILOSOPHIE UX : « Réduire la densité visuelle. » Vingt-cinq
 * champs sur un seul écran, c'est un formulaire administratif. Ils sont
 * donc rangés en trois panneaux qui répondent à trois questions
 * différentes — qui êtes-vous, où êtes-vous joignable, et qu'est-ce qui
 * vous couvre — chacun avec son propre bouton d'enregistrement.
 *
 * Trois formulaires plutôt qu'un : corriger un numéro de contrat
 * d'assurance ne doit pas obliger à revalider l'adresse du siège.
 */
/**
 * Une attestation d'assurance qui expire dans moins de deux mois.
 *
 * Hors du composant, et pas par coquetterie : lire l'heure pendant un
 * rendu rend celui-ci impur, et l'analyseur de React le refuse — à
 * juste titre, puisque deux rendus du même état donneraient deux
 * résultats. Ici la fonction est appelée une fois, au rendu serveur, et
 * son résultat est une donnée comme une autre.
 *
 * Deux mois de préavis : le temps de relancer un assureur.
 */
function expiresSoon(date: string | null): boolean {
  if (!date) return false;
  return new Date(date).getTime() < Date.now() + 60 * 24 * 3600 * 1000;
}

export default async function CompanyPage() {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const supabase = await createClient();
  const [{ data: company }, { data: memberCount }] = await Promise.all([
    supabase
      .from("business_organizations")
      .select("*")
      .eq("id", organization.organizationId)
      .maybeSingle(),
    supabase.rpc("organization_employee_count", {
      p_organization_id: organization.organizationId,
    }),
  ]);

  if (!company) return null;

  const canEdit = organization.permissions.includes("organization.manageUsers");
  const logoUrl = company.logo_path
    ? supabase.storage.from("organization-logos").getPublicUrl(company.logo_path).data.publicUrl
    : null;

  // §12 — l'effectif calculé, à côté du champ qui permet de l'imposer.
  const automatic = company.employee_count_override === null;

  const expiring = expiresSoon(company.insurance_expires_on);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Ma société"
        subtitle="Ces informations composent l'en-tête de vos devis et de vos factures, et l'exemplaire que vos clients consultent dans leur portail."
        action={
          <Badge tone={canEdit ? "accent" : "neutral"}>
            {canEdit ? "Modifiable" : "Lecture seule"}
          </Badge>
        }
      />

      <CompanyTabs current="/entreprise" />

      {!canEdit && (
        <p className="mb-6 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-[var(--text-body)] text-ink-soft">
          Seul un administrateur peut modifier la fiche de l&apos;entreprise. Vous
          pouvez la consulter.
        </p>
      )}

      {/* §12 LOGO SOCIÉTÉ — en tête, parce que c'est la chose qu'on
          vient faire en premier quand on installe le produit. */}
      <Panel title="Logo" className="mb-4">
        <div className="px-5 py-5">
          {canEdit ? (
            <LogoUploader organizationName={company.name} logoUrl={logoUrl} />
          ) : (
            <p className="text-[var(--text-body)] text-ink-soft">
              {logoUrl ? "Un logo est configuré." : "Aucun logo n'est configuré."}
            </p>
          )}
        </div>
      </Panel>

      {/* §11 INFORMATIONS + ACTIVITÉ + NOMBRE DE SALARIÉS */}
      <form action={updateCompanyProfile}>
        <Panel
          title="Identité"
          description="La raison sociale, l'immatriculation et l'activité."
          className="mb-4"
          footer={canEdit ? <SubmitButton variant="secondary">Enregistrer</SubmitButton> : undefined}
        >
          <fieldset disabled={!canEdit} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <Field label="Nom affiché" name="name" required defaultValue={company.name} />
            <Field label="Nom commercial" name="trade_name" defaultValue={company.trade_name ?? ""} />
            <Field label="Raison sociale" name="legal_name" defaultValue={company.legal_name ?? ""} />
            <Field
              label="Forme juridique"
              name="legal_form"
              defaultValue={company.legal_form ?? ""}
              placeholder="SARL, SAS, EI…"
            />
            <Field label="SIREN" name="siren" defaultValue={company.siren ?? ""} placeholder="123 456 789" />
            <Field
              label="SIRET"
              name="siret"
              defaultValue={company.siret ?? ""}
              placeholder="123 456 789 00012"
              hint="Mention obligatoire sur vos devis et factures."
            />
            <Field label="TVA intracommunautaire" name="vat_number" defaultValue={company.vat_number ?? ""} />
            <Field label="RCS" name="rcs_city" defaultValue={company.rcs_city ?? ""} placeholder="Nice" />
            <Field
              label="Capital social (€)"
              name="share_capital"
              defaultValue={
                company.share_capital_cents === null
                  ? ""
                  : (company.share_capital_cents / 100).toFixed(2)
              }
            />

            <SelectField
              label="Activité"
              name="business_type"
              defaultValue={company.business_type}
              options={BUSINESS_TYPES.map((type) => ({
                value: type,
                label: BUSINESS_TYPE_LABELS[type],
              }))}
              hint="Détermine les modules affichés dans le menu."
            />

            {/* §12 NOMBRE DE SALARIÉS — « calculer automatiquement depuis
                les membres actifs. Permettre override manuel. » */}
            <Field
              label="Nombre de salariés"
              name="employee_count_override"
              type="number"
              defaultValue={company.employee_count_override ?? ""}
              placeholder={String(memberCount ?? 0)}
              hint={
                automatic
                  ? `Calculé depuis les membres actifs : ${memberCount ?? 0}. Renseignez ce champ pour l'imposer.`
                  : `Valeur imposée. Les membres actifs sont ${memberCount ?? 0} — videz le champ pour revenir au calcul.`
              }
            />
          </fieldset>
        </Panel>

        <Panel
          title="Coordonnées"
          description="L'adresse du siège, telle qu'elle s'imprime en en-tête."
          className="mb-4"
          footer={canEdit ? <SubmitButton variant="secondary">Enregistrer</SubmitButton> : undefined}
        >
          <fieldset disabled={!canEdit} className="grid gap-4 px-5 py-5 sm:grid-cols-2">
            <Field label="Adresse" name="address_line1" defaultValue={company.address_line1 ?? ""} />
            <Field label="Complément" name="address_line2" defaultValue={company.address_line2 ?? ""} />
            <Field label="Code postal" name="postal_code" defaultValue={company.postal_code ?? ""} />
            <Field label="Ville" name="city" defaultValue={company.city ?? ""} />
            <Field label="Pays" name="country" defaultValue={company.country ?? "FR"} />
            <Field label="Téléphone" name="phone" defaultValue={company.phone ?? ""} />
            <Field label="E-mail" name="email" type="email" defaultValue={company.email ?? ""} />
            <Field
              label="Site internet"
              name="website"
              defaultValue={company.website ?? ""}
              placeholder="paysages-martin.fr"
            />
            <Field label="Devise" name="currency" defaultValue={company.currency ?? "EUR"} />
            <Field label="Langue" name="locale" defaultValue={company.locale ?? "fr"} />
            <Field
              label="Fuseau horaire"
              name="timezone"
              defaultValue={company.timezone ?? "Europe/Paris"}
              hint="Utilisé pour les plannings et les pointages."
            />
          </fieldset>
        </Panel>
      </form>

      {/* §12 ADMINISTRATION — « Champs facultatifs ». Facultatifs dans
          le logiciel, obligatoires sur un devis de travaux : c'est ce
          que dit l'encart quand il en manque. */}
      <form action={updateCompanyAdministration}>
        <Panel
          title="Assurances et agréments"
          description="Ce qu'un client, un donneur d'ordre ou un contrôle peut réclamer."
          action={
            expiring ? (
              <Badge tone="warning">Attestation à renouveler</Badge>
            ) : undefined
          }
          footer={canEdit ? <SubmitButton variant="secondary">Enregistrer</SubmitButton> : undefined}
        >
          <fieldset disabled={!canEdit} className="flex flex-col gap-4 px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Assureur" name="insurer_name" defaultValue={company.insurer_name ?? ""} />
              <Field
                label="Date d'expiration"
                name="insurance_expires_on"
                type="date"
                defaultValue={company.insurance_expires_on ?? ""}
              />
              <Field
                label="N° de contrat RC Pro"
                name="insurance_rc_pro_number"
                defaultValue={company.insurance_rc_pro_number ?? ""}
              />
              <Field
                label="N° de contrat décennale"
                name="insurance_decennale_number"
                defaultValue={company.insurance_decennale_number ?? ""}
              />
              <Field
                label="Certifications"
                name="certifications"
                defaultValue={company.certifications ?? ""}
                placeholder="Qualipaysage, Label Rouge…"
              />
              <Field
                label="Qualifications"
                name="qualifications"
                defaultValue={company.qualifications ?? ""}
              />
              <Field
                label="N° opérateur phytosanitaire"
                name="phytosanitary_operator_number"
                defaultValue={company.phytosanitary_operator_number ?? ""}
                hint="Si applicable."
              />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Mention imprimée sur les devis et factures
              </span>
              <textarea
                name="insurance_details"
                rows={2}
                defaultValue={company.insurance_details ?? ""}
                placeholder="AXA — contrat n° 1234567 — couverture France métropolitaine"
                className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent"
              />
              <span className="text-[var(--text-secondary)] text-ink-faint">
                C&apos;est cette phrase-là qui figure sur le document. Les champs
                ci-dessus servent à la retrouver ; ils ne s&apos;impriment pas.
              </span>
            </label>
          </fieldset>
        </Panel>
      </form>
    </div>
  );
}
