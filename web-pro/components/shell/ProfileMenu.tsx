"use client";

import Link from "next/link";
import { UserAvatar, ConfirmDialog } from "@/components/ui";
import { Icon } from "./Icon";

/**
 * §17 MENU PROFIL — « Mon profil, Ma société, Abonnement, Préférences,
 * Aide, Déconnexion ».
 *
 * Un `<details>` natif plutôt qu'un menu maison. Il s'ouvre au clavier,
 * se ferme à Échap, et ne demande aucun écouteur de clic sur le
 * document — la mécanique qui, mal faite, laisse un menu ouvert
 * derrière soi pendant toute la navigation.
 */
export function ProfileMenu({
  userEmail,
  userName,
  signOut,
}: {
  userEmail: string;
  userName: string;
  signOut: () => void | Promise<void>;
}) {
  return (
    <details className="group relative">
      <summary
        className="flex cursor-pointer list-none items-center rounded-full p-0.5 transition-colors hover:bg-canvas"
        aria-label="Menu du profil"
      >
        <UserAvatar name={userName || userEmail} size="sm" />
      </summary>

      <div className="absolute right-0 z-30 mt-2 w-60 rounded-[var(--radius-card)] border border-line bg-surface p-1 shadow-[var(--shadow-float)]">
        <div className="border-b border-line px-3 py-2.5">
          <p className="truncate text-[var(--text-body)] font-medium">{userName || "Mon compte"}</p>
          <p className="truncate text-[var(--text-secondary)] text-ink-faint">{userEmail}</p>
        </div>

        <MenuLink href="/profil" icon="clients" label="Mon profil" />
        <MenuLink href="/entreprise" icon="company" label="Ma société" />
        <MenuLink href="/entreprise/abonnement" icon="subscription" label="Abonnement" />
        <MenuLink href="/parametres" icon="settings" label="Préférences" />
        <MenuLink href="/aide" icon="help" label="Aide" />

        <div className="mt-1 border-t border-line pt-1">
          <ConfirmDialog
            triggerLabel={
              <>
                <Icon name="logout" className="h-4 w-4" />
                Se déconnecter
              </>
            }
            triggerVariant="ghost"
            title="Se déconnecter ?"
            message="Vos données restent enregistrées. Vous les retrouverez à la prochaine connexion, ici comme dans l'application Oasis Care."
            confirmLabel="Se déconnecter"
            action={signOut}
          />
        </div>
      </div>
    </details>
  );
}

function MenuLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: Parameters<typeof Icon>[0]["name"];
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[var(--text-body)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
    >
      <Icon name={icon} className="h-4 w-4" />
      {label}
    </Link>
  );
}
