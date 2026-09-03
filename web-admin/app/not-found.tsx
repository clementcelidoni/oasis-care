import { signOut } from "@/lib/auth/session";

/**
 * ==================================================================
 * LE 404 — et ce qu'il ne dit PAS
 * ==================================================================
 *
 * C'est la page que reçoit un compte connecté qui n'est pas
 * administrateur de plateforme. `requireAdmin()` appelle `notFound()`
 * pour lui : pas « accès refusé », pas « réservé aux administrateurs »,
 * rien qui confirme que la page demandée existe. Un 403 sur
 * `/organisations` apprendrait à un curieux qu'il y a quelque chose à
 * `/organisations` ; un 404 ne lui apprend rien du tout.
 *
 * Elle sert aussi de vrai 404 pour une adresse mal tapée, et les deux
 * cas sont volontairement indiscernables — c'est le but.
 *
 * ------------------------------------------------------------------
 * POURQUOI IL Y A UN BOUTON « SE DÉCONNECTER » DESSUS
 * ------------------------------------------------------------------
 * Sans lui, la page serait un cul-de-sac. Quelqu'un qui s'est connecté
 * avec son compte Oasis Care ordinaire — le cas le plus probable, les
 * comptes sont partagés avec l'app iPhone et avec Pro — n'aurait aucun
 * moyen de repartir : `/login` le renverrait ici, et la barre latérale
 * qui porte la déconnexion ne s'affiche jamais pour lui.
 *
 * Le bouton ne révèle rien : n'importe quel site propose de se
 * déconnecter, et il ne dit ni pourquoi la page est absente, ni ce
 * qu'il aurait fallu être pour la voir.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-20">
      <div className="w-full max-w-sm text-center">
        <p className="wordmark text-[11px] text-ink-faint">Oasis Care</p>

        <h1 className="mt-6 text-[length:var(--text-page)] font-semibold tracking-tight">
          Page introuvable
        </h1>
        <p className="mt-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
          Cette adresse ne correspond à rien.
        </p>

        <form action={signOut} className="mt-8">
          <button
            type="submit"
            className="rounded-[var(--radius-control)] border border-line-strong bg-surface-raised px-3.5 py-2 text-[var(--text-secondary)] font-medium text-ink transition-colors hover:border-ink-faint"
          >
            Se déconnecter
          </button>
        </form>
      </div>
    </main>
  );
}
