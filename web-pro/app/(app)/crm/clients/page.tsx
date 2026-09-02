import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader, EmptyState, DataTable, SearchBar, FilterBar, ButtonLink,
  SubmitButton, Badge, CompanyAvatar, UserAvatar, type Column,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { formatDate, type Customer } from "@/lib/crm/types";

/**
 * §7 MASTER/DETAIL — « LISTE ↓ DÉTAIL. Cliquer sur Villa Martin ouvre
 * une vraie fiche client. Ne pas afficher toutes les informations
 * directement dans la liste. »
 *
 * La liste ne répond qu'à une question : « lequel ? ». Quatre colonnes
 * y suffisent — qui, où, quel type, depuis quand. Le téléphone,
 * l'e-mail, les chantiers et l'historique vivent sur la fiche, qui est
 * à un clic. Les entasser ici obligerait à lire trente caractères par
 * ligne pour en retenir deux.
 *
 * L'e-mail reste CHERCHABLE sans être affiché : on retrouve souvent un
 * client par son adresse, on ne la relit presque jamais dans une liste.
 *
 * §37 TABLES : recherche, filtres, tri et pagination passent tous par
 * l'URL. Une liste filtrée doit rester filtrée quand on ouvre une fiche
 * et qu'on revient, et « mes clients niçois » doit pouvoir s'envoyer
 * par message.
 */

/** Le même schéma que la table `crm_customers`, restreint à la liste. */
const COLONNES_LUES =
  "id, display_name, kind, billing_city, created_at, converted_at";

type Ligne = Pick<
  Customer,
  "id" | "display_name" | "kind" | "billing_city" | "created_at" | "converted_at"
>;

/** §37 — assez de lignes pour balayer, assez peu pour rester légère. */
const PAR_PAGE = 25;

const TRIS = {
  nom: { label: "Nom", column: "display_name", ascending: true },
  recents: { label: "Récents", column: "created_at", ascending: false },
} as const;
type Tri = keyof typeof TRIS;
const TRI_PAR_DEFAUT: Tri = "nom";

const TYPES = {
  individual: "Particulier",
  company: "Entreprise",
} as const;
type TypeClient = keyof typeof TYPES;

export default async function ClientsPage({ searchParams }: PageProps<"/crm/clients">) {
  const params = await searchParams;

  const q = lire(params.q).trim();
  const typeBrut = lire(params.type);
  const type = typeBrut in TYPES ? (typeBrut as TypeClient) : "";
  const triBrut = lire(params.tri);
  const tri: Tri = triBrut in TRIS ? (triBrut as Tri) : TRI_PAR_DEFAUT;
  const page = Math.max(1, Number.parseInt(lire(params.page), 10) || 1);

  const supabase = await createClient();

  /**
   * Les critères, décrits une fois et posés trois fois : sur la page
   * affichée et sur les deux compteurs des pastilles. Trois chaînes de
   * `if` séparées finiraient par diverger, et les compteurs annonceraient
   * autre chose que ce que le tableau montre.
   *
   * Le type est volontairement HORS de cette fonction : les compteurs
   * de « Particuliers » et « Entreprises » doivent tenir compte de la
   * recherche en cours, pas du type déjà choisi — sinon l'un des deux
   * afficherait toujours zéro.
   */
  const requeteFiltree = (colonnes: string) => {
    let r = supabase
      .from("crm_customers")
      .select(colonnes, { count: "exact" })
      .eq("lifecycle_stage", "customer")
      .is("archived_at", null);
    if (q) {
      // `or` avec `ilike` plutôt que l'index tsvector : sur une liste de
      // clients on tape trois lettres d'un nom et on attend une
      // correspondance par préfixe, ce que la recherche plein texte ne
      // donne pas. Les caractères que PostgREST lirait comme de la
      // syntaxe de filtre sont neutralisés.
      const sur = q.replace(/[%,()]/g, " ");
      r = r.or(
        `display_name.ilike.%${sur}%,legal_name.ilike.%${sur}%,email.ilike.%${sur}%,billing_city.ilike.%${sur}%`,
      );
    }
    return r;
  };

  const ordre = TRIS[tri];
  const debut = (page - 1) * PAR_PAGE;

  let requetePage = requeteFiltree(COLONNES_LUES);
  if (type) requetePage = requetePage.eq("kind", type);

  const [{ data, count, error }, { count: nbParticuliers }, { count: nbEntreprises }] =
    await Promise.all([
      requetePage
        .order(ordre.column, { ascending: ordre.ascending })
        // Départage les ex æquo : sans second critère, deux clients
        // créés la même seconde peuvent échanger leur place d'une page à
        // l'autre, et l'un des deux ne s'afficherait jamais.
        .order("id", { ascending: true })
        .range(debut, debut + PAR_PAGE - 1),

      requeteFiltree("id").eq("kind", "individual").range(0, 0),
      requeteFiltree("id").eq("kind", "company").range(0, 0),
    ]);

  const clients = (data ?? []) as unknown as Ligne[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const nbTous = (nbParticuliers ?? 0) + (nbEntreprises ?? 0);

  const filtreActif = Boolean(q || type);
  const base = { q, type, tri };
  const lien = (modifs: Record<string, string>) => construireLien(base, modifs);

  const colonnes: Column<Ligne>[] = [
    {
      key: "nom",
      header: "Client",
      cell: (client) => (
        <span className="inline-flex items-center gap-2.5">
          {/* §3 — une pastille d'initiales colorée par le nom : c'est ce
              qui rend une ligne reconnaissable avant même d'être lue. */}
          {client.kind === "company" ? (
            <CompanyAvatar name={client.display_name} size="sm" />
          ) : (
            <UserAvatar name={client.display_name} size="sm" />
          )}
          {client.display_name}
        </span>
      ),
    },
    {
      key: "ville",
      header: "Ville",
      cell: (client) =>
        client.billing_city ? (
          <span className="text-ink-soft">{client.billing_city}</span>
        ) : (
          <span className="text-ink-faint">Non renseignée</span>
        ),
    },
    {
      key: "type",
      header: "Type",
      width: "9rem",
      cell: (client) => (
        <Badge tone={client.kind === "company" ? "info" : "neutral"}>
          {TYPES[client.kind]}
        </Badge>
      ),
    },
    {
      key: "depuis",
      header: "Client depuis",
      width: "9rem",
      secondary: true,
      // `converted_at` quand le client vient d'un prospect gagné :
      // c'est la date qui compte pour lui, pas celle où sa fiche a été
      // créée en tant que piste.
      cell: (client) => (
        <span className="tabular text-ink-soft">
          {formatDate(client.converted_at ?? client.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Clients"
        subtitle="Ouvrez une fiche pour voir ses coordonnées, ses chantiers, ses devis et son historique."
        action={
          <ButtonLink href="/crm/clients/nouveau">
            <Icon name="plus" className="h-4 w-4" />
            Ajouter un client
          </ButtonLink>
        }
      />

      {/* §37 — la recherche emporte les filtres en cours : chercher une
          ville ne doit pas effacer le type qu'on venait de choisir. */}
      <SearchBar
        defaultValue={q}
        placeholder="Rechercher un nom, une raison sociale, un e-mail, une ville…"
      >
        {type && <input type="hidden" name="type" value={type} />}
        {tri !== TRI_PAR_DEFAUT && <input type="hidden" name="tri" value={tri} />}
        <SubmitButton variant="secondary">Rechercher</SubmitButton>
      </SearchBar>

      <FilterBar
        label="Filtrer par type"
        current={lien({})}
        filters={[
          { label: "Tous", href: lien({ type: "" }), count: nbTous },
          {
            label: "Particuliers",
            href: lien({ type: "individual" }),
            count: nbParticuliers ?? 0,
          },
          {
            label: "Entreprises",
            href: lien({ type: "company" }),
            count: nbEntreprises ?? 0,
          },
        ]}
      />

      <FilterBar
        label="Trier"
        current={lien({})}
        filters={(Object.keys(TRIS) as Tri[]).map((clef) => ({
          label: TRIS[clef].label,
          href: lien({ tri: clef }),
        }))}
      />

      {error && (
        <p className="mb-4 rounded-[var(--radius-card)] bg-critical-wash px-4 py-3 text-[var(--text-body)] text-critical">
          {error.message}
        </p>
      )}

      <DataTable
        columns={colonnes}
        rows={clients}
        rowKey={(client) => client.id}
        rowHref={(client) => `/crm/clients/${client.id}`}
        empty={
          total > 0 ? (
            // Une page hors limites, typiquement après un retour en
            // arrière : la liste existe, c'est ce numéro-là qui est vide.
            <EmptyState
              title="Cette page est vide"
              description={`Il n'y a que ${pages} page${pages > 1 ? "s" : ""} de résultats. Revenez à la première.`}
              action={<ButtonLink href={lien({})}>Revenir au début</ButtonLink>}
            />
          ) : filtreActif ? (
            <EmptyState
              title="Aucun client ne correspond"
              description="Aucune fiche ne réunit ces critères. Élargissez la recherche, ou repartez de la liste entière."
              action={
                <ButtonLink href="/crm/clients" variant="secondary">
                  Effacer les filtres
                </ButtonLink>
              }
            />
          ) : (
            /* §32 — ce qu'il n'y a pas, à quoi ça servira, et par où
               commencer. Un tableau vide sans porte de sortie ressemble
               à une panne. */
            <EmptyState
              icon={<Icon name="clients" className="h-5 w-5" />}
              title="Aucun client pour le moment"
              description="Ajoutez votre premier client pour commencer à créer ses projets, ses devis et ses chantiers. Un prospect gagné devient client automatiquement."
              action={
                <>
                  <ButtonLink href="/crm/clients/nouveau">Ajouter un client</ButtonLink>
                  <ButtonLink href="/crm/prospects" variant="secondary">
                    Voir les prospects
                  </ButtonLink>
                </>
              }
            />
          )
        }
        footer={
          pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-[var(--text-secondary)] text-ink-soft">
              <span className="tabular">
                Page {page} sur {pages} · {total} client{total > 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-3">
                {page > 1 && (
                  <Link href={lien({ page: String(page - 1) })} className="hover:text-accent">
                    ← Précédents
                  </Link>
                )}
                {page < pages && (
                  <Link href={lien({ page: String(page + 1) })} className="hover:text-accent">
                    Suivants →
                  </Link>
                )}
              </span>
            </div>
          ) : undefined
        }
      />
    </div>
  );
}

/** Un paramètre d'URL répété arrive en tableau : on ne garde que le premier. */
function lire(valeur: string | string[] | undefined): string {
  if (Array.isArray(valeur)) return valeur[0] ?? "";
  return valeur ?? "";
}

/**
 * L'URL de la liste, filtres compris.
 *
 * Les clés vides disparaissent et l'ordre est fixe : deux appels qui
 * décrivent le même état produisent la même chaîne, ce dont dépend
 * `FilterBar` pour savoir quelle pastille est active. `page` n'est
 * jamais reporté — changer de filtre remet au début, sinon on atterrit
 * sur la page 4 d'une liste qui n'en a plus que deux.
 */
function construireLien(
  base: { q: string; type: string; tri: Tri },
  modifs: Record<string, string>,
): string {
  const valeurs: Record<string, string> = {
    q: base.q,
    type: base.type,
    tri: base.tri,
    ...modifs,
  };
  const recherche = new URLSearchParams();
  for (const [clef, valeur] of Object.entries(valeurs)) {
    if (valeur) recherche.set(clef, valeur);
  }
  const chaine = recherche.toString();
  return chaine ? `/crm/clients?${chaine}` : "/crm/clients";
}
