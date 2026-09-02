import Image from "next/image";
import { CompanyAvatar } from "@/components/ui";

/**
 * §3 BRANDING PRINCIPAL — et §51, le critère final :
 *
 *     [ Logo Oasis Care ]
 *     OASIS CARE PRO
 *     Oasis Rare
 *     [ Logo Oasis Rare ]
 *
 * §"Créer une hiérarchie élégante. Ne pas mettre les deux logos à la
 * même taille." Deux marques côte à côte à taille égale se disputent
 * l'attention et n'en gagnent aucune. Ici le produit s'annonce en
 * premier — logo et nom —, l'entreprise vient dessous, plus petite et
 * plus discrète : elle dit « où je suis », pas « qui édite ce
 * logiciel ».
 *
 * §12 « PAS DE LOGO ENTREPRISE → afficher initiales ». `CompanyAvatar`
 * s'en charge, avec une teinte dérivée du nom pour que chaque
 * entreprise reste reconnaissable.
 */
export function Brand({
  organizationName,
  organizationLogoUrl,
  compact = false,
}: {
  organizationName: string;
  organizationLogoUrl?: string | null;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex flex-col items-center gap-2 py-1">
        <Image
          src="/oasis-logo.png"
          alt="Oasis Care"
          width={28}
          height={28}
          priority
          className="rounded-md"
        />
        <CompanyAvatar name={organizationName} logoUrl={organizationLogoUrl} size="sm" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Image
          src="/oasis-logo.png"
          alt=""
          width={32}
          height={32}
          priority
          className="shrink-0 rounded-md"
        />
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">
          Oasis Care Pro
        </span>
      </div>

      <div className="flex items-center gap-2.5 rounded-[var(--radius-control)] bg-canvas px-2.5 py-2">
        <CompanyAvatar name={organizationName} logoUrl={organizationLogoUrl} size="sm" />
        <span className="min-w-0 truncate text-[var(--text-body)] font-medium">
          {organizationName}
        </span>
      </div>
    </div>
  );
}
