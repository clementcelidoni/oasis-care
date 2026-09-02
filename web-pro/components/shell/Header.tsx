import Link from "next/link";
import { Icon } from "./Icon";
import { GlobalSearch } from "./GlobalSearch";
import { ProfileMenu } from "./ProfileMenu";
import { recordOpen } from "@/lib/search/actions";

/**
 * §4 HEADER GLOBAL — « premium mais discret ».
 *
 *     [ Recherche globale Oasis Care Pro... ]   ✨ Oasis AI  🔔  ?  👤
 *
 * Discret veut dire : une seule ligne, pas de bordure épaisse, pas de
 * couleur pleine. Ce qui attire l'œil, c'est le champ de recherche —
 * §51 en fait un moyen principal de navigation, donc il occupe la
 * place, et les quatre autres commandes se rangent à droite en icônes.
 */
export function Header({
  userEmail,
  userName,
  unreadCount,
  recents,
  favorites,
  signOut,
}: {
  userEmail: string;
  userName: string;
  unreadCount: number;
  recents: { id: string; entity_type: string; title: string; url: string }[];
  favorites: { id: string; entity_type: string; title: string; url: string }[];
  signOut: () => void | Promise<void>;
}) {
  return (
    <header className="flex h-[var(--header-height)] shrink-0 items-center gap-3 border-b border-line bg-surface px-4 print:hidden">
      <div className="flex min-w-0 max-w-xl flex-1">
        <GlobalSearch recents={recents} favorites={favorites} recordOpen={recordOpen} />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Link
          href="/oasis-ai"
          className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-[var(--text-secondary)] font-medium text-accent transition-colors hover:bg-accent-wash"
        >
          <Icon name="ai" className="h-4 w-4" />
          <span className="hidden md:inline">Oasis AI</span>
        </Link>

        <Link
          href="/notifications"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} non ${unreadCount > 1 ? "lues" : "lue"}`
              : "Notifications"
          }
          className="relative rounded-[var(--radius-control)] p-2 text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
        >
          <Icon name="bell" />
          {unreadCount > 0 && (
            // Le nombre, pas seulement la pastille : « trois choses à
            // regarder » et « une » n'appellent pas la même urgence.
            <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>

        <Link
          href="/aide"
          aria-label="Aide"
          className="rounded-[var(--radius-control)] p-2 text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
        >
          <Icon name="help" />
        </Link>

        <ProfileMenu userEmail={userEmail} userName={userName} signOut={signOut} />
      </div>
    </header>
  );
}
