import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader, EmptyState, DataTable, SearchBar, FilterBar, ButtonLink,
  SubmitButton, StatusBadge, CompanyAvatar, UserAvatar, type Column,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_LABELS,
  formatDate,
  type Customer,
  type ProspectStatus,
} from "@/lib/crm/types";

/**
 * §7 MASTER/DETAIL — la liste des prospects mène à la MÊME fiche que
 * les clients : c'est la même ligne en base, à un stade différent (voir
 * migration 0044, où convertir un prospect ne duplique surtout pas sa
 * fiche).
 *
 * Ce qu'on vient chercher ici, c'est « où en est cette affaire ». D'où
 * quatre colonnes : qui, où, à quel stade, depuis combien de temps. Le
 * reste — la source, les notes, les échanges — est sur la fiche.
 *
 * §37 : recherche, filtres, tri et pagination passent par l'URL, donc
 * par l'historique du navigateur et par le presse-papiers.
 */

const COLONNES_LUES =
  "id, display_name, kind, billing_city, source, prospect_status, created_at";

type Ligne = Pick<
  Customer,
  "id" | "display_name" | "kind" | "billing_city" | "source" | "prospect_status" | "created_at"
>;

const STATUS_TONE: Record<
  ProspectStatus,
  "neutral" | "info" | "warning" | "accent" | "positive" | "critical"
> = {
  new: "neutral",
  contacted: "info",
  visitScheduled: "info",
  quoteInProgress: "warning",
  quoteSent: "warning",
  won: "positive",
  lost: "critical",
};

const PAR_PAGE = 25;

const TRIS = {
  recents: { label: "Récents", column: "created_at", ascending: false },
  anciens: { label: "Les plus anciens", column: "created_at", ascending: true },
  nom: { label: "Nom", column: "display_name", ascending: true },
} as const;
type Tri = keyof typeof TRIS;
const TRI_PAR_DEFAUT: Tri = "recents";

/**
 * « Gagné » n'apparaît pas dans les pastilles.
 *
 * Un prospect gagné devient un client et quitte cette liste : proposer
 * le filtre laisserait croire à un oubli quand il ne rend rien.
 */
const STATUTS_FILTRABLES = PROSPECT_STATUSES.filter((s) => s !== "won");

export default async function ProspectsPage({ searchParams }: PageProps<"/crm/prospects">) {
  const params = await searchParams;

  const q = lire(params.q).trim();
  const statutBrut = lire(params.statut);
  const statut = (STATUTS_FILTRABLES as readonly string[]).includes(statutBrut)
    ? (statutBrut as ProspectStatus)
    : "";
  const triBrut = lire(params.tri);
  const tri: Tri = triBrut in TRIS ? (triBrut as Tri) : TRI_PAR_DEFAUT;
  const page = Math.max(1, Number.parseInt(lire(params.page), 10) || 1);

  const supabase = await createClient();

  /** Les critères communs à la page affichée et aux compteurs. */
  const requeteFiltree = (colonnes: string) => {
    let r = supabase
      .from("crm_customers")
      .select(colonnes, { count: "exact" })
      .eq("lifecycle_stage", "lead")
      .is("archived_at", null);
    if (q) {
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
  if (statut) requetePage = requetePage.eq("prospect_status", statut);

  const [{ data, count, error }, { data: statutsBruts, count: countStatuts }] = await Promise.all([
    requetePage
      .order(ordre.column, { ascending: ordre.ascending })
      .order("id", { ascending: true })
      .range(debut, debut + PAR_PAGE - 1),

    // Un compteur par pastille, dans la recherche en cours : une rangée
    // de zéros ne dit pas si le filtre est vide ou si la liste l'est.
    // Une seule colonne suffit à les compter, on ne rapatrie pas les
    // fiches entières.
    requeteFiltree("prospect_status").range(0, 999),
  ]);

  const prospects = (data ?? []) as unknown as Ligne[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));

  const compteurs = new Map<string, number>();
  for (const ligne of (statutsBruts ?? []) as unknown as { prospect_status: string }[]) {
    compteurs.set(ligne.prospect_status, (compteurs.get(ligne.prospect_status) ?? 0) + 1);
  }
  /**
   * §9 — un chiffre faux vaut moins qu'un tiret.
   *
   * Les compteurs se font en comptant les lignes rapatriées, et on n'en
   * rapatrie pas plus de mille. Au-delà, la somme serait plafonnée sans
   * le dire : on préfère des pastilles sans nombre.
   */
  const compteursFiables = (statutsBruts ?? []).length >= (countStatuts ?? 0);

  const filtreActif = Boolean(q || statut);
  const base = { q, statut, tri };
  const lien = (modifs: Record<string, string>) => construireLien(base, modifs);

  const colonnes: Column<Ligne>[] = [
    {
      key: "nom",
      header: "Prospect",
      cell: (prospect) => (
        <span className="inline-flex items-center gap-2.5">
          {prospect.kind === "company" ? (
            <CompanyAvatar name={prospect.display_name} size="sm" />
          ) : (
            <UserAvatar name={prospect.display_name} size="sm" />
          )}
          {prospect.display_name}
        </span>
      ),
    },
    {
      key: "ville",
      header: "Ville",
      cell: (prospect) =>
        prospect.billing_city ? (
          <span className="text-ink-soft">{prospect.billing_city}</span>
        ) : (
          <span className="text-ink-faint">Non renseignée</span>
        ),
    },
    {
      key: "source",
      header: "Origine",
      secondary: true,
      cell: (prospect) =>
        prospect.source ? (
          <span className="text-ink-soft">{prospect.source}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      key: "statut",
      header: "Étape",
      width: "12rem",
      // §47 — la pastille porte un mot ET une couleur : l'étape reste
      // lisible pour qui ne distingue pas l'orange du rouge.
      cell: (prospect) => (
        <StatusBadge tone={STATUS_TONE[prospect.prospect_status]}>
          {PROSPECT_STATUS_LABELS[prospect.prospect_status]}
        </StatusBadge>
      ),
    },
    {
      key: "depuis",
      header: "Depuis",
      width: "9rem",
      secondary: true,
      cell: (prospect) => (
        <span className="tabular text-ink-soft">{formatDate(prospect.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Prospects"
        subtitle="Les affaires en cours, du premier contact au devis envoyé. Ouvrez-en une pour voir ses échanges et ses devis."
        action={
          <ButtonLink href="/crm/clients/nouveau?type=prospect">
            <Icon name="plus" className="h-4 w-4" />
            Ajouter un prospect
          </ButtonLink>
        }
      />

      <SearchBar
        defaultValue={q}
        placeholder="Rechercher un nom, une raison sociale, un e-mail, une ville…"
      >
        {statut && <input type="hidden" name="statut" value={statut} />}
        {tri !== TRI_PAR_DEFAUT && <input type="hidden" name="tri" value={tri} />}
        <SubmitButton variant="secondary">Rechercher</SubmitButton>
      </SearchBar>

      <FilterBar
        label="Filtrer par étape"
        current={lien({})}
        filters={[
          { label: "Toutes les étapes", href: lien({ statut: "" }) },
          ...STATUTS_FILTRABLES.map((s) => ({
            label: PROSPECT_STATUS_LABELS[s],
            href: lien({ statut: s }),
            count: compteursFiables ? compteurs.get(s) ?? 0 : undefined,
          })),
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
        rows={prospects}
        rowKey={(prospect) => prospect.id}
        rowHref={(prospect) => `/crm/clients/${prospect.id}`}
        empty={
          total > 0 ? (
            <EmptyState
              title="Cette page est vide"
              description={`Il n'y a que ${pages} page${pages > 1 ? "s" : ""} de résultats. Revenez à la première.`}
              action={<ButtonLink href={lien({})}>Revenir au début</ButtonLink>}
            />
          ) : filtreActif ? (
            <EmptyState
              title="Aucun prospect ne correspond"
              description="Aucune affaire ne réunit ces critères. Élargissez la recherche, ou repartez de la liste entière."
              action={
                <ButtonLink href="/crm/prospects" variant="secondary">
                  Effacer les filtres
                </ButtonLink>
              }
            />
          ) : (
            /* §32 — ce qu'il n'y a pas, à quoi ça servira, et le bouton
               pour commencer. */
            <EmptyState
              icon={<Icon name="prospects" className="h-5 w-5" />}
              title="Aucun prospect pour le moment"
              description="Ajoutez votre premier prospect pour suivre l'affaire du premier appel jusqu'au devis signé. Une fois gagné, il devient client sans ressaisie."
              action={
                <ButtonLink href="/crm/clients/nouveau?type=prospect">
                  Ajouter un prospect
                </ButtonLink>
              }
            />
          )
        }
        footer={
          pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-[var(--text-secondary)] text-ink-soft">
              <span className="tabular">
                Page {page} sur {pages} · {total} prospect{total > 1 ? "s" : ""}
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

/** Voir la note jumelle sur la liste des clients : même règle, même raison. */
function construireLien(
  base: { q: string; statut: string; tri: Tri },
  modifs: Record<string, string>,
): string {
  const valeurs: Record<string, string> = {
    q: base.q,
    statut: base.statut,
    tri: base.tri,
    ...modifs,
  };
  const recherche = new URLSearchParams();
  for (const [clef, valeur] of Object.entries(valeurs)) {
    if (valeur) recherche.set(clef, valeur);
  }
  const chaine = recherche.toString();
  return chaine ? `/crm/prospects?${chaine}` : "/crm/prospects";
}
