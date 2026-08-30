import type { PortalCompany } from "@/lib/portal/types";

/**
 * L'entête de l'entreprise sur l'exemplaire du client.
 *
 * Les mêmes mentions que sur le devis papier : raison sociale, adresse,
 * SIRET, TVA, assurance décennale. Un client qui imprime depuis son
 * portail doit obtenir un document équivalent à celui qu'il a reçu —
 * pas une capture d'écran d'un logiciel.
 */
export function Letterhead({ company }: { company: PortalCompany | undefined }) {
  if (!company) return null;

  const address = [
    company.address_line1,
    company.address_line2,
    [company.postal_code, company.city].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join("\n");

  const legal = [
    company.legal_form,
    company.siret && `SIRET ${company.siret}`,
    company.vat_number && `TVA ${company.vat_number}`,
    company.rcs_city && `RCS ${company.rcs_city}`,
  ].filter(Boolean);

  return (
    <div>
      <p className="text-lg font-semibold">{company.name}</p>
      {company.legal_name && company.legal_name !== company.name && (
        <p className="text-sm text-ink-soft">{company.legal_name}</p>
      )}
      {address && <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{address}</p>}
      {(company.email || company.phone) && (
        <p className="mt-1 text-sm text-ink-soft">
          {[company.email, company.phone].filter(Boolean).join(" · ")}
        </p>
      )}
      {legal.length > 0 && (
        <p className="mt-1 text-xs text-ink-faint">{legal.join(" · ")}</p>
      )}
      {company.insurance_details && (
        <p className="mt-1 text-xs text-ink-faint">{company.insurance_details}</p>
      )}
    </div>
  );
}
