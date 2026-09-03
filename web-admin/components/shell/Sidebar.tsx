"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { Wordmark } from "./Wordmark";
import { ConfirmDialog } from "@/components/ui";
import type { AdminNavGroup } from "@/lib/navigation";

/**
 * ==================================================================
 * LA BARRE LATÉRALE
 * ==================================================================
 *
 * Elle ne reçoit QUE les groupes déjà filtrés par le rôle
 * (`visibleNavigation`, appelé côté serveur dans la coquille). Elle ne
 * filtre rien elle-même, et c'est délibéré : un composant client qui
 * déciderait de ce qui est visible aurait besoin de connaître la liste
 * complète des écrans, laquelle partirait alors dans le bundle du
 * navigateur de tout le monde.
 *
 * LE RÔLE EST AFFICHÉ EN PERMANENCE, en haut, sous le titre. Ce n'est
 * pas une décoration : la spec p.30 fait du moindre privilège une règle
 * de fonctionnement, et un administrateur qui ne voit pas une entrée
 * doit pouvoir comprendre pourquoi sans ouvrir un ticket. « Support »
 * écrit en toutes lettres répond à la question avant qu'elle ne se
 * pose.
 *
 * Pas de mode réduit ici, contrairement à Oasis Care Pro : six entrées
 * ne justifient pas un mécanisme de repli, et le repli coûterait un
 * cookie, un état serveur et une classe de bugs.
 */
export function Sidebar({
  groups,
  roleLabel,
  roleDescription,
  email,
  mfaWarning,
  signOut,
}: {
  groups: AdminNavGroup[];
  roleLabel: string;
  roleDescription: string;
  email: string | null;
  /** La phrase MFA, si un avertissement est à porter. */
  mfaWarning: string | null;
  signOut: () => void | Promise<void>;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navigation du Control Center"
      className="flex h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r border-line bg-surface print:hidden"
    >
      <div className="border-b border-line px-3 py-3.5">
        <Link href="/" className="block rounded-[var(--radius-control)]">
          <Wordmark />
        </Link>

        {/* Le rôle, en permanence. */}
        <p
          className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-accent-wash px-2 py-0.5 text-[11px] font-semibold text-accent"
          title={roleDescription}
        >
          <Icon name="shield" className="h-3.5 w-3.5" />
          {roleLabel}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            <p className="eyebrow mb-1.5 px-2">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                // Actif sur la page elle-même ET sur ses sous-pages.
                // La racine est le cas particulier : sans ce test elle
                // serait active partout.
                const active =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(`${item.href}/`));

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={item.hint}
                      className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 text-[var(--text-body)] transition-colors ${
                        active
                          ? "bg-accent-wash font-medium text-accent"
                          : "text-ink-soft hover:bg-surface-raised hover:text-ink"
                      }`}
                    >
                      <Icon name={item.icon} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {groups.length === 0 && (
          <p className="px-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Votre rôle n&apos;ouvre aucun écran de ce jalon. Ce n&apos;est pas une panne :
            c&apos;est le moindre privilège appliqué.
          </p>
        )}
      </div>

      {/* Spec p.32 — l'authentification renforcée. Ce jalon PRÉPARE :
          l'avertissement s'affiche, personne n'est bloqué, l'écran
          d'enrôlement reste à livrer. */}
      {mfaWarning && (
        <div className="mx-2 mb-2 rounded-[var(--radius-control)] border border-warning/30 bg-warning-wash px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-warning">
            <Icon name="warning" className="h-3.5 w-3.5" />
            Authentification à deux facteurs
          </p>
          <p className="mt-1 text-[11px] leading-snug text-ink-soft">{mfaWarning}</p>
        </div>
      )}

      <div className="border-t border-line p-2">
        {email && (
          <p className="truncate px-2 pb-1.5 text-[11px] text-ink-faint" title={email}>
            {email}
          </p>
        )}
        <ConfirmDialog
          triggerLabel={
            <>
              <Icon name="logout" />
              Se déconnecter
            </>
          }
          triggerVariant="ghost"
          title="Se déconnecter du Control Center ?"
          message="La session administrateur est révoquée immédiatement, pas seulement effacée de ce navigateur."
          confirmLabel="Se déconnecter"
          action={signOut}
        />
      </div>
    </nav>
  );
}
