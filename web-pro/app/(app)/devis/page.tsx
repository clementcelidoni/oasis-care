import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader, EmptyState, DataTable, SearchBar, FilterBar, ButtonLink,
  SubmitButton, StatusBadge, type Column,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { formatDate } from "@/lib/crm/types";
import {
  QUOTE_STATUS_LABELS, QUOTE_STATUS_TONE, QUOTE_STATUSES,
  EMPTY_TOTALS, formatCents, formatPercent, marginTone,
  type QuoteStatus, type QuoteTotals,
} from "@/lib/quotes/types";
import { NewQuoteForm } from "./NewQuoteForm";

/**
 * §39 DEVIS UX — « Le devis doit occuper le grand workspace. »
 *
 * La liste tient donc sur toute la largeur, et elle porte les quatre
 * chiffres qu'on vient y chercher : Total HT, TVA, Total TTC et MARGE.
 * Sans la marge, choisir quel devis relancer se fait au montant — or
 * un devis à 40 000 € vendu à perte mérite l'appel avant un devis à
 * 8 000 € bien margé.
 *
 * Les totaux viennent de la vue `quote_totals`, jamais de colonnes
 * stockées sur le devis : un montant recalculé à la lecture ne peut pas
 * mentir sur ce que contiennent réellement les lignes.
 *
 * §37 : recherche, filtres, tri et pagination passent par l'URL.
 */

const PAR_PAGE = 25;

const TRIS = {
  recents: { label: "Récents", column: "created_at", ascending: false },
  numero: { label: "Numéro", column: "number", ascending: false },
  echeance: { label: "Validité", column: "valid_until", ascending: true },
} as const;
type Tri = keyof typeof TRIS;
const TRI_PAR_DEFAUT: Tri = "recents";

type LigneDevis = {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
  issued_on: string;
  valid_until: string | null;
  crm_customers: { display_name: string } | null;
};

export default async function QuotesPage({ searchParams }: PageProps<"/devis">) {
  const params = await searchParams;

  const q = lire(params.q).trim();
  const statutBrut = lire(params.statut);
  const statut = (QUOTE_STATUSES as readonly string[]).includes(statutBrut)
    ? (statutBrut as QuoteStatus)
    : "";
  const client = lire(params.client);
  const triBrut = lire(params.tri);
  const tri: Tri = triBrut in TRIS ? (triBrut as Tri) : TRI_PAR_DEFAUT;
  const page = Math.max(1, Number.parseInt(lire(params.page), 10) || 1);

  const supabase = await createClient();

  /** Les critères, décrits une fois, posés sur la page et sur les compteurs. */
  const requeteFiltree = (colonnes: string) => {
    let r = supabase
      .from("quotes")
      .select(colonnes, { count: "exact" })
      .is("archived_at", null);
    if (client) r = r.eq("customer_id", client);
    if (q) {
      // Le numéro et l'objet seulement : le client se choisit dans la
      // liste déroulante à côté, ce qui est plus sûr que d'espérer
      // l'orthographe exacte de sa raison sociale.
      const sur = q.replace(/[%,()]/g, " ");
      r = r.or(`number.ilike.%${sur}%,title.ilike.%${sur}%`);
    }
    return r;
  };

  const ordre = TRIS[tri];
  const debut = (page - 1) * PAR_PAGE;

  let requetePage = requeteFiltree(
    "id, number, title, status, issued_on, valid_until, customer_id, crm_customers ( display_name )",
  );
  if (statut) requetePage = requetePage.eq("status", statut);

  const [
    { data, count, error },
    { data: statutsBruts, count: countStatuts },
    { data: customers },
  ] = await Promise.all([
    requetePage
      .order(ordre.column, { ascending: ordre.ascending, nullsFirst: false })
      // Départage les ex æquo : sans second critère, deux devis créés la
      // même seconde peuvent échanger leur place d'une page à l'autre.
      .order("id", { ascending: true })
      .range(debut, debut + PAR_PAGE - 1),

    // Un compteur par pastille, dans la sélection en cours (hors statut,
    // sinon toutes les autres afficheraient zéro).
    requeteFiltree("status").range(0, 999),

    supabase
      .from("crm_customers")
      .select("id, display_name")
      .is("archived_at", null)
      .order("display_name"),
  ]);

  const rows = (data ?? []) as unknown as LigneDevis[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));

  const compteurs = new Map<string, number>();
  for (const ligne of (statutsBruts ?? []) as unknown as { status: string }[]) {
    compteurs.set(ligne.status, (compteurs.get(ligne.status) ?? 0) + 1);
  }
  // §9 — au-delà de mille devis, la somme serait plafonnée sans le
  // dire : on préfère des pastilles sans nombre à des nombres faux.
  const compteursFiables = (statutsBruts ?? []).length >= (countStatuts ?? 0);

  /**
   * Les totaux des devis AFFICHÉS, et d'eux seuls.
   *
   * Vingt-cinq identifiants dans un `in`, plutôt que la vue entière
   * rapatriée à chaque visite. Un devis sans aucune ligne n'apparaît
   * pas dans la vue — elle regroupe des lignes — d'où le repli sur des
   * totaux à zéro, qui est la vérité pour un brouillon vide.
   */
  const totauxParDevis = new Map<string, QuoteTotals>();
  if (rows.length > 0) {
    const { data: totaux } = await supabase
      .from("quote_totals")
      .select("*")
      .in("quote_id", rows.map((r) => r.id));
    for (const t of (totaux ?? []) as unknown as (QuoteTotals & { quote_id: string })[]) {
      totauxParDevis.set(t.quote_id, t);
    }
  }
  const totauxDe = (id: string) => totauxParDevis.get(id) ?? EMPTY_TOTALS;

  // Le sous-total de la page, explicitement nommé comme tel : additionner
  // ce qu'on voit est utile, le faire passer pour le total du portefeuille
  // serait faux dès la deuxième page.
  const sousTotal = rows.reduce(
    (acc, row) => {
      const t = totauxDe(row.id);
      return {
        ht: acc.ht + t.total_excluding_vat_cents,
        ttc: acc.ttc + t.total_including_vat_cents,
        marge: acc.marge + t.margin_cents,
      };
    },
    { ht: 0, ttc: 0, marge: 0 },
  );

  const filtreActif = Boolean(q || statut || client);
  const base = { q, statut, client, tri };
  const lien = (modifs: Record<string, string>) => construireLien(base, modifs);

  const colonnes: Column<LigneDevis>[] = [
    {
      key: "numero",
      header: "Numéro",
      width: "9rem",
      cell: (devis) => <span className="tabular">{devis.number}</span>,
    },
    {
      key: "objet",
      header: "Objet",
      cell: (devis) => (
        <span>
          {devis.title || <span className="text-ink-faint">Sans objet</span>}
        </span>
      ),
    },
    {
      key: "client",
      header: "Client",
      cell: (devis) =>
        devis.crm_customers ? (
          <span className="text-ink-soft">{devis.crm_customers.display_name}</span>
        ) : (
          // Le devis survit à la suppression de la fiche client : le
          // dire vaut mieux qu'afficher une case vide.
          <span className="text-ink-faint">Client supprimé</span>
        ),
    },
    {
      key: "date",
      header: "Émis le",
      width: "8rem",
      secondary: true,
      cell: (devis) => (
        <span className="tabular text-ink-soft">{formatDate(devis.issued_on)}</span>
      ),
    },
    {
      key: "ht",
      header: "Total HT",
      numeric: true,
      cell: (devis) => (
        <span className="font-medium">
          {formatCents(totauxDe(devis.id).total_excluding_vat_cents)}
        </span>
      ),
    },
    {
      key: "tva",
      header: "TVA",
      numeric: true,
      secondary: true,
      cell: (devis) => (
        <span className="text-ink-soft">{formatCents(totauxDe(devis.id).total_vat_cents)}</span>
      ),
    },
    {
      key: "ttc",
      header: "Total TTC",
      numeric: true,
      cell: (devis) => (
        <span className="font-medium">
          {formatCents(totauxDe(devis.id).total_including_vat_cents)}
        </span>
      ),
    },
    {
      key: "marge",
      header: "Marge",
      numeric: true,
      // §RENTABILITÉ — le signe compte : une marge négative est un
      // chantier vendu à perte, elle doit sauter aux yeux.
      cell: (devis) => {
        const t = totauxDe(devis.id);
        const ton = marginTone(t.margin_cents);
        return (
          <span
            className={
              ton === "critical" ? "text-critical" : ton === "warning" ? "text-warning" : "text-positive"
            }
          >
            <span className="block font-medium">{formatCents(t.margin_cents)}</span>
            <span className="block text-[var(--text-secondary)] opacity-80">
              {formatPercent(t.margin_percent)}
            </span>
          </span>
        );
      },
    },
    {
      key: "statut",
      header: "État",
      width: "11rem",
      cell: (devis) => (
        <StatusBadge tone={QUOTE_STATUS_TONE[devis.status]}>
          {QUOTE_STATUS_LABELS[devis.status]}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-8 py-10">
      <PageHeader
        title="Devis"
        subtitle="Ouvrez un devis pour composer ses lignes, y verser le métré d'un plan et le présenter au client."
        action={<NewQuoteForm customers={customers ?? []} />}
      />

      <SearchBar defaultValue={q} placeholder="Rechercher un numéro, un objet…">
        {statut && <input type="hidden" name="statut" value={statut} />}
        {tri !== TRI_PAR_DEFAUT && <input type="hidden" name="tri" value={tri} />}
        <select
          name="client"
          defaultValue={client}
          aria-label="Client"
          className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent"
        >
          <option value="">Tous les clients</option>
          {((customers ?? []) as { id: string; display_name: string }[]).map((c) => (
            <option key={c.id} value={c.id}>
              {c.display_name}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary">Filtrer</SubmitButton>
      </SearchBar>

      <FilterBar
        label="Filtrer par état"
        current={lien({})}
        filters={[
          { label: "Tous les états", href: lien({ statut: "" }) },
          ...QUOTE_STATUSES.map((s) => ({
            label: QUOTE_STATUS_LABELS[s],
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
        rows={rows}
        rowKey={(devis) => devis.id}
        rowHref={(devis) => `/devis/${devis.id}`}
        empty={
          total > 0 ? (
            <EmptyState
              title="Cette page est vide"
              description={`Il n'y a que ${pages} page${pages > 1 ? "s" : ""} de résultats. Revenez à la première.`}
              action={<ButtonLink href={lien({})}>Revenir au début</ButtonLink>}
            />
          ) : filtreActif ? (
            <EmptyState
              title="Aucun devis ne correspond"
              description="Aucun devis ne réunit ces critères. Élargissez la recherche, ou repartez de la liste entière."
              action={
                <ButtonLink href="/devis" variant="secondary">
                  Effacer les filtres
                </ButtonLink>
              }
            />
          ) : (
            /* §32 — ce qu'il n'y a pas, à quoi ça servira, et par où
               commencer. Un devis part d'un client : sans client, le
               bouton « Nouveau devis » n'a rien à proposer, et l'empty
               state doit le dire plutôt que de laisser buter dessus. */
            <EmptyState
              icon={<Icon name="quote" className="h-5 w-5" />}
              title="Aucun devis pour le moment"
              description={
                (customers ?? []).length === 0
                  ? "Un devis part d'un client. Ajoutez d'abord un client, puis composez son premier devis."
                  : "Créez votre premier devis pour chiffrer un chantier : lignes, remises, TVA et marge, puis envoi au client. Vous pourrez y verser le métré d'un plan."
              }
              action={
                (customers ?? []).length === 0 ? (
                  <ButtonLink href="/crm/clients/nouveau">Ajouter un client</ButtonLink>
                ) : (
                  <NewQuoteForm customers={customers ?? []} />
                )
              }
            />
          )
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 text-[var(--text-secondary)] text-ink-soft">
            <span className="tabular">
              {pages > 1
                ? `Page ${page} sur ${pages} · ${total} devis`
                : `${total} devis`}
            </span>

            <span className="flex flex-wrap items-center gap-4">
              <span className="tabular">
                Cette page&nbsp;: <strong className="text-ink">{formatCents(sousTotal.ht)}</strong> HT
                {" · "}
                {formatCents(sousTotal.ttc)} TTC
                {" · "}
                marge {formatCents(sousTotal.marge)}
              </span>
              {pages > 1 && (
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
              )}
            </span>
          </div>
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
  base: { q: string; statut: string; client: string; tri: Tri },
  modifs: Record<string, string>,
): string {
  const valeurs: Record<string, string> = {
    q: base.q,
    statut: base.statut,
    client: base.client,
    tri: base.tri,
    ...modifs,
  };
  const recherche = new URLSearchParams();
  for (const [clef, valeur] of Object.entries(valeurs)) {
    if (valeur) recherche.set(clef, valeur);
  }
  const chaine = recherche.toString();
  return chaine ? `/devis?${chaine}` : "/devis";
}
