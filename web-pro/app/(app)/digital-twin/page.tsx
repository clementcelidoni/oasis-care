import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState, SearchBar, SubmitButton, ButtonLink } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { formatDate } from "@/lib/crm/types";
import { NouveauJardin } from "./NouveauJardin";

/**
 * §38 — le choix du jardin à ouvrir.
 *
 * L'écran d'après est un outil de dessin plein écran ; celui-ci est le
 * vestiaire. Une liste à puces obligeait à lire chaque ligne pour
 * retrouver « Villa Martin » ; des cartes se balayent d'un coup d'œil,
 * et chacune dit la seule chose qu'on veuille savoir avant de cliquer :
 * où est ce jardin, et quand y a-t-on touché pour la dernière fois.
 *
 * Les jardins listés ici sont ceux de la table `gardens` — les mêmes
 * que l'app iPhone. Un jardin créé sur le terrain apparaît donc ici, et
 * inversement : §11C « Le Digital Twin Web doit lire et écrire LES
 * MÊMES données métier que le Digital Twin iPhone. »
 */
export default async function DigitalTwinIndexPage({
  searchParams,
}: PageProps<"/digital-twin">) {
  const params = await searchParams;
  const q = lire(params.q).trim();

  const supabase = await createClient();
  let requete = supabase
    .from("gardens")
    .select("id, name, address, updated_at")
    .is("deleted_at", null)
    .order("name");

  if (q) {
    // Les caractères que PostgREST lirait comme de la syntaxe de filtre.
    const sur = q.replace(/[%,()]/g, " ");
    requete = requete.or(`name.ilike.%${sur}%,address.ilike.%${sur}%`);
  }

  const { data: gardens, error } = await requete;
  const liste = (gardens ?? []) as {
    id: string;
    name: string;
    address: string | null;
    updated_at: string | null;
  }[];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Digital Twin"
        subtitle="Modélisez un jardin depuis votre ordinateur : limites, surfaces, végétaux, réseaux. Les plans sont partagés avec l'application iPhone."
        action={<NouveauJardin />}
      />

      {/* La recherche n'apparaît que quand elle sert. Sur trois jardins,
          un champ de recherche est du mobilier. */}
      {(liste.length > 6 || q) && (
        <SearchBar defaultValue={q} placeholder="Rechercher un jardin, une adresse…">
          <SubmitButton variant="secondary">Rechercher</SubmitButton>
        </SearchBar>
      )}

      {error && (
        <p className="mb-4 rounded-[var(--radius-card)] bg-critical-wash px-4 py-3 text-[var(--text-body)] text-critical">
          {error.message}
        </p>
      )}

      {liste.length === 0 ? (
        q ? (
          <EmptyState
            title="Aucun jardin ne correspond"
            description="Aucun plan ne porte ce nom ni cette adresse. Essayez avec moins de lettres."
            action={
              <ButtonLink href="/digital-twin" variant="secondary">
                Voir tous les jardins
              </ButtonLink>
            }
          />
        ) : (
          /* §32 — ce qu'il n'y a pas, à quoi ça servira, et le bouton
             pour commencer. */
          <EmptyState
            icon={<Icon name="twin" className="h-5 w-5" />}
            title="Aucun jardin pour le moment"
            description="Créez votre premier jardin pour en tracer le plan : limites du terrain, surfaces, végétaux, arrosage. Il apparaîtra aussi dans l'application iPhone."
            action={<NouveauJardin />}
          />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {liste.map((garden) => (
            <li key={garden.id}>
              <Link
                href={`/digital-twin/${garden.id}`}
                className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] transition-colors hover:border-accent/40 hover:bg-accent-wash/30"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-accent-wash text-accent">
                  <Icon name="twin" className="h-5 w-5" />
                </span>

                <span className="mt-3.5 block text-[length:var(--text-card)] font-medium">
                  {garden.name}
                </span>
                <span className="mb-4 mt-1 block text-[var(--text-secondary)] text-ink-soft">
                  {garden.address ?? "Adresse non renseignée"}
                </span>

                <span className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3.5 text-[var(--text-secondary)]">
                  <span className="tabular text-ink-faint">
                    {/* `updated_at` est la date du plan, pas celle de la
                        fiche : c'est elle qui dit si le chantier a bougé. */}
                    {garden.updated_at ? `Modifié le ${formatDate(garden.updated_at)}` : "Jamais ouvert"}
                  </span>
                  <span className="text-accent transition-transform group-hover:translate-x-0.5">
                    Ouvrir le plan →
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Un paramètre d'URL répété arrive en tableau : on ne garde que le premier. */
function lire(valeur: string | string[] | undefined): string {
  if (Array.isArray(valeur)) return valeur[0] ?? "";
  return valeur ?? "";
}
