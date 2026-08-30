import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { requirePortal } from "@/lib/portal/access";
import { signOut } from "@/lib/auth/session";

/**
 * §11S — la coquille du portail client.
 *
 * Volontairement DIFFÉRENTE de celle du professionnel : pas de barre
 * latérale, pas de sélecteur d'entreprise, cinq liens en tout. Un
 * particulier ouvre ce portail deux fois par an, pour lire un devis ou
 * payer une facture — lui présenter l'ossature d'un ERP lui ferait
 * chercher où sont ses documents.
 *
 * La séparation est aussi une garantie : rien de `(app)` n'est monté
 * ici, donc aucun écran interne ne peut s'y glisser par une route
 * partagée.
 */
export default async function PortalLayout({ children }: LayoutProps<"/portail">) {
  const [companies, user] = await Promise.all([requirePortal(), getCurrentUser()]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/portail" className="flex items-center gap-2.5">
            <span className="h-7 w-7 rounded-lg bg-accent" aria-hidden />
            <span className="font-semibold tracking-tight">Mon espace</span>
          </Link>

          <nav className="flex items-center gap-5 text-sm">
            <Link href="/portail" className="text-ink-soft hover:text-ink">
              Documents
            </Link>
            <Link href="/portail/jardins" className="text-ink-soft hover:text-ink">
              Mes jardins
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-4 text-xs text-ink-faint">
            <span className="hidden sm:inline">{user?.email}</span>
            <form action={signOut}>
              <button type="submit" className="hover:text-ink">
                Se déconnecter
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-line px-6 py-5 print:hidden">
        <p className="mx-auto max-w-4xl text-xs text-ink-faint">
          {companies.length === 1
            ? `Vos documents chez ${companies[0].name}.`
            : `Vos documents chez ${companies.map((c) => c.name).join(", ")}.`}{" "}
          Une question sur un montant ou une date ? Contactez directement votre
          professionnel — c&apos;est lui qui tient ces documents à jour.
        </p>
      </footer>
    </div>
  );
}
