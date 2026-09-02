"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { isAvailable, type NavGroup, type NavItem } from "@/lib/navigation";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { Icon } from "./Icon";
import { Brand } from "./Brand";
import { ConfirmDialog } from "@/components/ui";

/**
 * §5 SIDEBAR.
 *
 * Trois choses qu'elle doit faire et que l'ancienne ne faisait pas :
 * grouper (§5), se réduire (§"SIDEBAR COLLAPSIBLE"), et porter la
 * déconnexion (§18).
 *
 * L'ÉTAT RÉDUIT VIT DANS UN COOKIE, pas dans `localStorage`. Le serveur
 * rend la barre à la bonne largeur dès la première image : avec
 * `localStorage`, la page s'afficherait toujours dépliée puis se
 * replierait après hydratation, et ce sursaut se voit à chaque
 * navigation. Le clic écrit le cookie côté navigateur — pas d'aller-
 * retour serveur pour un bouton d'affichage.
 */
export function Sidebar({
  groups,
  organizationName,
  organizationLogoUrl,
  role,
  initialCompact,
  organizations,
  activeOrganizationId,
  switchOrganization,
  signOut,
}: {
  groups: NavGroup[];
  organizationName: string;
  organizationLogoUrl: string | null;
  role: Role;
  initialCompact: boolean;
  organizations: { id: string; name: string }[];
  activeOrganizationId: string;
  switchOrganization: (formData: FormData) => void | Promise<void>;
  signOut: () => void | Promise<void>;
}) {
  const pathname = usePathname();
  const [compact, setCompact] = useState(initialCompact);

  function toggle() {
    const next = !compact;
    setCompact(next);
    // Un an : c'est une préférence d'affichage, pas une session.
    document.cookie = `oasis_sidebar=${next ? "compact" : "full"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <nav
      aria-label="Navigation principale"
      data-compact={compact ? "" : undefined}
      className={`flex h-full shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-150 print:hidden ${
        compact ? "w-[var(--sidebar-width-compact)]" : "w-[var(--sidebar-width)]"
      }`}
    >
      <div className={`border-b border-line ${compact ? "px-2 py-3" : "px-3 py-4"}`}>
        <Brand
          organizationName={organizationName}
          organizationLogoUrl={organizationLogoUrl}
          compact={compact}
        />

        {/* §13 COMPANY SWITCHER — seulement s'il y a de quoi changer. */}
        {!compact && organizations.length > 1 && (
          <CompanySwitcher
            organizations={organizations}
            activeOrganizationId={activeOrganizationId}
            switchOrganization={switchOrganization}
          />
        )}

        {!compact && (
          <p className="mt-2 px-0.5 text-[var(--text-secondary)] text-ink-faint">
            {ROLE_LABELS[role]}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {compact ? (
              <div className="mx-2 mb-2 border-t border-line first:border-0" aria-hidden />
            ) : (
              <p className="eyebrow mb-1.5 px-2.5">{group.label}</p>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} pathname={pathname} compact={compact} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-2">
        {/* §18 — une vraie déconnexion, avec confirmation, accessible
            depuis le bas de la barre ET depuis le menu profil. */}
        <div className={compact ? "flex justify-center" : ""}>
          <ConfirmDialog
            triggerLabel={
              compact ? (
                <Icon name="logout" />
              ) : (
                <>
                  <Icon name="logout" />
                  Se déconnecter
                </>
              )
            }
            triggerVariant="ghost"
            title="Se déconnecter ?"
            message="Vos données restent enregistrées. Vous les retrouverez à la prochaine connexion, ici comme dans l'application Oasis Care."
            confirmLabel="Se déconnecter"
            action={signOut}
          />
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-pressed={compact}
          title={compact ? "Déplier le menu" : "Réduire le menu"}
          className={`mt-1 flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-[var(--text-secondary)] text-ink-faint transition-colors hover:bg-canvas hover:text-ink ${
            compact ? "justify-center" : ""
          }`}
        >
          <Icon name={compact ? "expand" : "collapse"} />
          {!compact && <span>Réduire le menu</span>}
        </button>
      </div>
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  compact,
}: {
  item: NavItem;
  pathname: string;
  compact: boolean;
}) {
  // Actif sur la page elle-même ET sur ses sous-pages : depuis la
  // fiche d'un devis, c'est bien « Devis » qu'on est en train de
  // consulter. La racine est le cas particulier — sinon elle serait
  // active partout.
  const active =
    pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));

  const shape = `flex items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-2 text-[var(--text-body)] transition-colors ${
    compact ? "justify-center" : ""
  }`;

  // Une section dont le jalon n'est pas sorti reste visible, mais pas
  // cliquable : la forme du produit est une information utile, un lien
  // vers un 404 ne l'est pas.
  if (!isAvailable(item)) {
    return (
      <span
        className={`${shape} cursor-default text-ink-faint`}
        title={compact ? `${item.label} — à venir` : "Module à venir"}
      >
        <Icon name={item.icon} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              à venir
            </span>
          </>
        )}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={compact ? item.label : undefined}
      className={`${shape} ${
        active
          ? "bg-accent-wash font-medium text-accent"
          : "text-ink-soft hover:bg-canvas hover:text-ink"
      }`}
    >
      <Icon name={item.icon} />
      {!compact && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
    </Link>
  );
}

/**
 * §13 COMPANY SWITCHER — « Si utilisateur dans plusieurs organisations ».
 *
 * Un `<details>` natif plutôt qu'un menu maison : il s'ouvre au clavier,
 * se ferme à Échap, et n'a besoin d'aucun écouteur de clic extérieur —
 * la source la plus fréquente de menus qui restent coincés ouverts.
 */
function CompanySwitcher({
  organizations,
  activeOrganizationId,
  switchOrganization,
}: {
  organizations: { id: string; name: string }[];
  activeOrganizationId: string;
  switchOrganization: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <details className="group relative mt-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-[var(--text-secondary)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink">
        Changer d&apos;entreprise
        <Icon name="chevron" className="h-3.5 w-3.5 rotate-90 transition-transform group-open:-rotate-90" />
      </summary>

      <div className="absolute left-0 right-0 z-20 mt-1 rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-float)]">
        {organizations.map((organization) => (
          <form key={organization.id} action={switchOrganization}>
            <input type="hidden" name="organization_id" value={organization.id} />
            <button
              type="submit"
              className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-[var(--text-body)] transition-colors hover:bg-canvas ${
                organization.id === activeOrganizationId ? "font-medium text-accent" : "text-ink-soft"
              }`}
            >
              <span className="min-w-0 truncate">{organization.name}</span>
              {organization.id === activeOrganizationId && (
                <Icon name="check" className="h-4 w-4 shrink-0" />
              )}
            </button>
          </form>
        ))}

        <Link
          href="/bienvenue"
          className="mt-1 flex items-center gap-2 rounded-[var(--radius-control)] border-t border-line px-2.5 py-2 text-[var(--text-secondary)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
        >
          <Icon name="plus" className="h-4 w-4" />
          Créer une organisation
        </Link>
      </div>
    </details>
  );
}
