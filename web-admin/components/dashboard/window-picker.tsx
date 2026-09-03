import Link from "next/link";

import { ACTIVITY_WINDOWS, type ActivityWindowKey } from "@/lib/dashboard/windows";

/**
 * Le choix de la fenêtre d'observation.
 *
 * Des LIENS, pas des boutons : la fenêtre vit dans l'URL, donc elle
 * survit au rafraîchissement automatique de la page, se garde dans
 * l'historique et se colle dans un message (« regarde les 24 h »). Un
 * `useState` la perdrait à chaque `router.refresh()`, c'est-à-dire
 * toutes les minutes sur cet écran.
 */
export function WindowPicker({
  basePath,
  current,
}: {
  basePath: string;
  current: ActivityWindowKey;
}) {
  return (
    <nav
      aria-label="Fenêtre d'observation"
      className="flex flex-wrap items-center gap-1 rounded-[var(--radius-control)] border border-line bg-surface-sunken p-1"
    >
      {ACTIVITY_WINDOWS.map((option) => {
        const active = option.key === current;
        return (
          <Link
            key={option.key}
            href={`${basePath}?fenetre=${option.key}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-[var(--radius-control)] px-2.5 py-1 text-[var(--text-secondary)] font-medium transition-colors ${
              active
                ? "bg-accent text-accent-ink"
                : "text-ink-soft hover:bg-surface-raised hover:text-ink"
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
