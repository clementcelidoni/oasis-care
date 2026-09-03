import { Icon } from "./Icon";
import { SEARCH_HREF } from "@/lib/navigation";

/**
 * L'en-tête du Control Center.
 *
 * Il porte deux choses, et rien d'autre :
 *
 *   • LA RECHERCHE GLOBALE (spec p.33). Un formulaire GET vers
 *     `/recherche` : la requête atterrit dans l'URL, donc dans
 *     l'historique et le presse-papiers, et elle fonctionne sans
 *     JavaScript. Elle cherche des IDENTITÉS — un compte, une adresse,
 *     une entreprise, un SIRET, un identifiant — jamais du contenu
 *     métier. `admin_global_search()` n'a d'ailleurs aucune branche qui
 *     touche un devis, une facture ou une plante.
 *
 *   • LE RAPPEL DE CE QU'ON REGARDE. « Plateforme entière » est écrit
 *     à droite en permanence. Ce n'est pas un ornement : ailleurs dans
 *     l'écosystème, un écran qui ressemble à celui-ci montre les
 *     données d'UNE entreprise. Ici, toute action porte sur les
 *     comptes de tout le monde.
 *
 * Le champ est absent — et non grisé — pour un rôle qui n'a pas
 * `platform.search` : une barre de recherche inerte invite à taper
 * dedans.
 */
export function Header({ canSearch, query }: { canSearch: boolean; query?: string }) {
  return (
    <header className="flex h-[var(--header-height)] shrink-0 items-center gap-4 border-b border-line bg-surface px-4 print:hidden">
      {canSearch ? (
        <form action={SEARCH_HREF} role="search" className="max-w-xl flex-1">
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
            >
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Utilisateur, e-mail, entreprise, SIRET, identifiant…"
              aria-label="Recherche administrative globale"
              className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken py-1.5 pl-8 pr-3 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
            />
          </div>
        </form>
      ) : (
        <div className="flex-1" />
      )}

      <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
        Plateforme entière
      </p>
    </header>
  );
}
