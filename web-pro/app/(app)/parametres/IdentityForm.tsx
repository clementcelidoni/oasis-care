import { SubmitButton } from "@/components/ui";
import { updateOrganizationIdentity } from "@/lib/auth/organizationActions";

export type OrganizationIdentity = {
  legal_name: string | null;
  legal_form: string | null;
  siret: string | null;
  vat_number: string | null;
  rcs_city: string | null;
  share_capital_cents: number | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  insurance_details: string | null;
};

/** Ce qu'un devis ou une facture doit porter pour être un vrai document. */
const REQUIRED_FOR_DOCUMENTS: (keyof OrganizationIdentity)[] = [
  "siret",
  "address_line1",
  "postal_code",
  "city",
];

/**
 * L'identité légale de l'entreprise.
 *
 * Elle n'était nulle part. Les pages d'impression du devis et de la
 * facture réclamaient déjà ces colonnes, qui n'existaient pas : la
 * requête échouait sans bruit et l'entête retombait sur « Oasis Care
 * Pro ». Chaque document sortait donc sans SIRET, sans adresse et sans
 * numéro de TVA — ce qui, en France, n'est pas un devis.
 *
 * Le bandeau du haut le dit tant que ça reste vrai. Un réglage
 * manquant qu'on ne signale nulle part ne se découvre qu'au moment où
 * un client réclame une facture conforme.
 */
export function IdentityForm({
  identity,
  canEdit,
}: {
  identity: OrganizationIdentity;
  canEdit: boolean;
}) {
  const missing = REQUIRED_FOR_DOCUMENTS.filter((key) => !identity[key]);

  if (!canEdit) {
    return (
      <p className="text-xs text-ink-faint">
        Ces mentions figurent sur vos devis et vos factures. Seul un
        administrateur peut les modifier.
      </p>
    );
  }

  return (
    <form action={updateOrganizationIdentity} className="flex flex-col gap-4">
      {missing.length > 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning-wash px-3 py-2 text-xs text-warning">
          Vos devis et vos factures sortent actuellement sans entête complète.
          Il manque : {missing.map((key) => FIELD_LABELS[key]).join(", ")}. Un
          devis sans SIRET ni adresse n&apos;est pas un document valable.
        </p>
      )}

      <Group title="Raison sociale">
        <Text name="legal_name" label="Dénomination" value={identity.legal_name} placeholder="Paysages Martin SARL" />
        <Text name="legal_form" label="Forme juridique" value={identity.legal_form} placeholder="SARL" />
        <Text name="siret" label="SIRET" value={identity.siret} placeholder="123 456 789 00012" />
        <Text name="vat_number" label="N° de TVA" value={identity.vat_number} placeholder="FR12345678900" />
        <Text name="rcs_city" label="RCS" value={identity.rcs_city} placeholder="Nice" />
        <Text
          name="share_capital"
          label="Capital social (€)"
          value={
            identity.share_capital_cents === null
              ? null
              : (identity.share_capital_cents / 100).toFixed(2)
          }
          placeholder="10000"
        />
      </Group>

      <Group title="Adresse">
        <Text name="address_line1" label="Adresse" value={identity.address_line1} placeholder="12 chemin des Oliviers" />
        <Text name="address_line2" label="Complément" value={identity.address_line2} />
        <Text name="postal_code" label="Code postal" value={identity.postal_code} placeholder="06000" />
        <Text name="city" label="Ville" value={identity.city} placeholder="Nice" />
      </Group>

      <Group title="Contact">
        <Text name="email" label="E-mail" value={identity.email} type="email" />
        <Text name="phone" label="Téléphone" value={identity.phone} />
        <Text name="website" label="Site web" value={identity.website} placeholder="paysages-martin.fr" />
      </Group>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-faint">Assurance décennale</span>
        <textarea
          name="insurance_details"
          rows={2}
          defaultValue={identity.insurance_details ?? ""}
          placeholder="AXA — contrat n° 1234567 — couverture France métropolitaine"
          className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        <span className="text-[11px] text-ink-faint">
          Mention obligatoire sur les devis et factures de travaux de paysage.
          Recopiez-la de votre attestation.
        </span>
      </label>

      <div>
        <SubmitButton variant="secondary">Enregistrer</SubmitButton>
      </div>
    </form>
  );
}

const FIELD_LABELS: Record<string, string> = {
  siret: "le SIRET",
  address_line1: "l'adresse",
  postal_code: "le code postal",
  city: "la ville",
};

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {title}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Text({
  name, label, value, placeholder, type = "text",
}: {
  name: string;
  label: string;
  value: string | null;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
      />
    </label>
  );
}
