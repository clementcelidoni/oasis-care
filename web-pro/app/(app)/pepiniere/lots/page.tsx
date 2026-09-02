import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader, EmptyState, MetricCard, DataTable, SearchBar, FilterBar,
  ButtonLink, SubmitButton, Badge, type Column,
} from "@/components/ui";
import {
  LOT_STATUSES, LOT_STATUS_LABELS, LOT_STATUS_TONE, formatCount,
  type LotStatus, type NurseryLot,
} from "@/lib/nursery/types";

/**
 * §5 NURSERY — « Lots », l'entrée du menu qui n'avait pas d'écran.
 *
 * La FICHE d'un lot existait déjà (`lots/[id]`), et le tableau de bord
 * de la pépinière en montre une poignée ; il manquait la liste
 * complète — celle qu'on ouvre pour retrouver un lot dont on ne se
 * rappelle que l'espèce, ou pour voir tout ce qui dort en serre 2.
 *
 * §37 TABLES : « recherche, filtres, tri, pagination. Cliquer ligne :
 * ouvre détail. » Tout passe par l'URL, jamais par un état React : une
 * liste filtrée doit rester filtrée quand on ouvre une fiche et qu'on
 * revient, et « les lots en quarantaine de la serre 2 » doit pouvoir
 * s'envoyer par message.
 */

/** §37 — assez de lignes pour balayer, assez peu pour que la page reste légère. */
const PAR_PAGE = 25;

/**
 * Le plafond des totaux affichés en tête.
 *
 * Les cartes additionnent les lots de la sélection courante, ce qui
 * suppose de les charger. Au-delà de ce nombre on ne les charge pas
 * tous — et on affiche un tiret plutôt qu'une somme partielle : §9, un
 * chiffre faux vaut moins qu'un tiret.
 */
const PLAFOND_TOTAUX = 1000;

const TRIS = {
  recents: { label: "Récents", column: "created_at", ascending: false },
  code: { label: "Code", column: "lot_code", ascending: true },
  espece: { label: "Espèce", column: "species_name", ascending: true },
  quantite: { label: "Quantité", column: "current_quantity", ascending: false },
} as const;
type Tri = keyof typeof TRIS;
const TRI_PAR_DEFAUT: Tri = "recents";

/** Ce qu'il faut de colonnes pour savoir ce qui est vendable dans un lot. */
type Quantites = Pick<NurseryLot, "status" | "current_quantity" | "reserved_quantity">;

/**
 * Le disponible d'un lot : ce qu'on peut vendre aujourd'hui.
 *
 * `availableOf` (lib/nursery/types) énonce la même règle, mais réclame
 * un lot entier. Les totaux ci-dessous ne lisent que les trois colonnes
 * qui la déterminent, pour ne pas rapatrier mille lots complets dans le
 * seul but de les additionner — d'où cette forme étroite, utilisée
 * aussi par le tableau pour que la page n'ait qu'une définition du mot
 * « disponible ».
 *
 * La règle : un lot qui n'est pas « disponible » n'a rien de vendable,
 * même s'il est bien physiquement là — et ce qui est réservé est promis
 * à quelqu'un.
 */
function disponibleDe(lot: Quantites): number {
  if (lot.status !== "available") return 0;
  return Math.max(0, lot.current_quantity - lot.reserved_quantity);
}

type LigneLot = NurseryLot & {
  nursery_locations: { id: string; code: string; name: string } | null;
};

export default async function LotsPage({ searchParams }: PageProps<"/pepiniere/lots">) {
  const params = await searchParams;

  const q = lire(params.q).trim();
  const statutBrut = lire(params.statut);
  const statut = (LOT_STATUSES as readonly string[]).includes(statutBrut)
    ? (statutBrut as LotStatus)
    : "";
  const emplacement = lire(params.emplacement);
  const triBrut = lire(params.tri);
  const tri: Tri = triBrut in TRIS ? (triBrut as Tri) : TRI_PAR_DEFAUT;
  const page = Math.max(1, Number.parseInt(lire(params.page), 10) || 1);

  const supabase = await createClient();

  /**
   * Les filtres, décrits une fois et posés deux fois : sur la page
   * affichée, et sur les totaux des cartes. Deux chaînes de `if`
   * séparées finiraient par diverger, et les cartes compteraient autre
   * chose que le tableau qu'elles surplombent.
   */
  const requeteFiltree = (colonnes: string) => {
    let r = supabase
      .from("nursery_lots")
      .select(colonnes, { count: "exact" })
      .is("archived_at", null);
    if (statut) r = r.eq("status", statut);
    // « aucun » n'est pas un identifiant : c'est la demande inverse, les
    // lots posés nulle part — ceux qu'on finit par perdre de vue.
    if (emplacement === "aucun") r = r.is("location_id", null);
    else if (emplacement) r = r.eq("location_id", emplacement);
    if (q) {
      // Les caractères que PostgREST lirait comme de la syntaxe de filtre.
      const sur = q.replace(/[%,()]/g, " ");
      r = r.or(`lot_code.ilike.%${sur}%,species_name.ilike.%${sur}%,cultivar.ilike.%${sur}%`);
    }
    return r;
  };

  const ordre = TRIS[tri];
  const debut = (page - 1) * PAR_PAGE;

  const [{ data: lots, count, error }, { data: totaux, count: countTotaux }, { data: emplacements }] =
    await Promise.all([
      requeteFiltree("*, nursery_locations ( id, code, name )")
        .order(ordre.column, { ascending: ordre.ascending })
        // Départage les ex æquo : sans second critère, deux lots de même
        // quantité peuvent échanger leur place d'une page à l'autre, et
        // l'un des deux ne s'afficherait jamais.
        .order("lot_code", { ascending: true })
        .range(debut, debut + PAR_PAGE - 1),

      requeteFiltree("status, current_quantity, reserved_quantity").range(0, PLAFOND_TOTAUX - 1),

      supabase
        .from("nursery_locations")
        .select("id, code, name")
        .is("archived_at", null)
        .order("code"),
    ]);

  const lignes = (lots ?? []) as unknown as LigneLot[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));

  const quantites = (totaux ?? []) as unknown as Quantites[];
  // Les totaux ne valent que si on a bien tout chargé — voir PLAFOND_TOTAUX.
  const complets = quantites.length >= (countTotaux ?? 0);
  const somme = quantites.reduce(
    (acc, lot) => ({
      physique: acc.physique + lot.current_quantity,
      reserve: acc.reserve + lot.reserved_quantity,
      disponible: acc.disponible + disponibleDe(lot),
    }),
    { physique: 0, reserve: 0, disponible: 0 },
  );

  const filtreActif = Boolean(q || statut || emplacement);
  const base = { q, statut, emplacement, tri };
  const lien = (modifs: Record<string, string>) => construireLien(base, modifs);

  const colonnes: Column<LigneLot>[] = [
    {
      key: "code",
      header: "Lot",
      width: "9rem",
      cell: (lot) => <span className="tabular">{lot.lot_code}</span>,
    },
    {
      key: "espece",
      header: "Espèce",
      cell: (lot) => (
        <span>
          {lot.species_name}
          {lot.cultivar && <span className="text-ink-soft"> ‘{lot.cultivar}’</span>}
        </span>
      ),
    },
    {
      key: "contenant",
      header: "Contenant",
      secondary: true,
      cell: (lot) => (
        <span className="text-ink-soft">
          {[lot.container_size, lot.plant_size].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      key: "emplacement",
      header: "Emplacement",
      secondary: true,
      cell: (lot) =>
        lot.nursery_locations ? (
          <span className="text-ink-soft" title={lot.nursery_locations.name}>
            {lot.nursery_locations.code}
          </span>
        ) : (
          <span className="text-ink-faint">Non situé</span>
        ),
    },
    {
      key: "physique",
      header: "Physique",
      numeric: true,
      cell: (lot) => formatCount(lot.current_quantity),
    },
    {
      key: "disponible",
      header: "Disponible",
      numeric: true,
      // La colonne qui décide si on peut dire oui à un client : elle est
      // donc la seule en gras, à côté du physique qui la relativise.
      cell: (lot) => <span className="font-medium">{formatCount(disponibleDe(lot))}</span>,
    },
    {
      key: "statut",
      header: "État",
      width: "8rem",
      cell: (lot) => <Badge tone={LOT_STATUS_TONE[lot.status]}>{LOT_STATUS_LABELS[lot.status]}</Badge>,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Lots"
        subtitle="Chaque lot est un groupe de plantes qui partagent une espèce, un contenant et une histoire. Ouvrez-en un pour voir son journal."
        action={
          // Le formulaire de création vit sur le tableau de bord de la
          // pépinière, avec les emplacements et les étapes qu'il lui
          // faut. Y renvoyer vaut mieux que d'en poser un deuxième ici,
          // qui divergerait du premier à la première évolution.
          <ButtonLink href="/pepiniere" variant="secondary">
            Nouveau lot
          </ButtonLink>
        }
      />

      {/* §1 — « grandes cartes KPI » avant le tableau : le chiffre qu'on
          vient chercher se lit sans parcourir une seule ligne. */}
      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Lots"
          value={formatCount(total)}
          hint={filtreActif ? "Dans cette sélection" : "Actifs, hors archivés"}
        />
        <MetricCard
          label="Physique"
          value={complets ? formatCount(somme.physique) : null}
          hint={complets ? "Sur place, quarantaine comprise" : "Trop de lots pour totaliser ici"}
        />
        <MetricCard
          label="Réservé"
          value={complets ? formatCount(somme.reserve) : null}
          hint={complets ? "Promis à un client" : "Trop de lots pour totaliser ici"}
        />
        <MetricCard
          label="Disponible"
          value={complets ? formatCount(somme.disponible) : null}
          hint={complets ? "Vendable aujourd'hui" : "Trop de lots pour totaliser ici"}
          tone="accent"
        />
      </section>

      {/* §37 — la recherche emporte les filtres en cours : chercher une
          espèce ne doit pas effacer l'emplacement qu'on venait de choisir. */}
      <SearchBar
        defaultValue={q}
        placeholder="Rechercher un code de lot, une espèce, un cultivar…"
      >
        {statut && <input type="hidden" name="statut" value={statut} />}
        {tri !== TRI_PAR_DEFAUT && <input type="hidden" name="tri" value={tri} />}
        <select
          name="emplacement"
          defaultValue={emplacement}
          aria-label="Emplacement"
          className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent"
        >
          <option value="">Tous les emplacements</option>
          <option value="aucun">Sans emplacement</option>
          {((emplacements ?? []) as { id: string; code: string; name: string }[]).map((e) => (
            <option key={e.id} value={e.id}>
              {e.code} — {e.name}
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
          ...LOT_STATUSES.map((s) => ({
            label: LOT_STATUS_LABELS[s],
            href: lien({ statut: s }),
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
        rows={lignes}
        rowKey={(lot) => lot.id}
        rowHref={(lot) => `/pepiniere/lots/${lot.id}`}
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
              title="Aucun lot ne correspond"
              description="Aucun lot ne réunit ces critères. Élargissez la recherche, ou repartez de la liste entière."
              action={
                <ButtonLink href="/pepiniere/lots" variant="secondary">
                  Effacer les filtres
                </ButtonLink>
              }
            />
          ) : (
            /* §32 — ce qu'il n'y a pas, à quoi ça servira, et par où commencer. */
            <EmptyState
              title="Aucun lot pour le moment"
              description="Ajoutez votre premier lot pour suivre ses quantités, ses déplacements et ce qu'il vous reste à vendre."
              action={<ButtonLink href="/pepiniere">Créer un lot</ButtonLink>}
            />
          )
        }
        footer={
          pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-[var(--text-secondary)] text-ink-soft">
              <span className="tabular">
                Page {page} sur {pages} · {formatCount(total)} lot{total > 1 ? "s" : ""}
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

      <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
        <strong>Physique</strong> : ce qui est sur place, quarantaine comprise.{" "}
        <strong>Disponible</strong> : ce qui est vendable aujourd&apos;hui, une fois retiré ce
        qui est réservé et ce qui n&apos;est pas en vente. Les confondre, c&apos;est soit
        vendre deux fois la même plante, soit refuser une commande qu&apos;on pouvait honorer.
      </p>
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
 * Les clés vides disparaissent, et l'ordre est fixe : deux appels qui
 * décrivent le même état produisent la même chaîne, ce dont dépend
 * `FilterBar` pour savoir quelle pastille est active. `page` n'est
 * jamais reporté — changer de filtre remet au début, sinon on atterrit
 * sur la page 4 d'une liste qui n'en a plus que deux.
 */
function construireLien(
  base: { q: string; statut: string; emplacement: string; tri: Tri },
  modifs: Record<string, string>,
): string {
  const valeurs: Record<string, string> = {
    q: base.q,
    statut: base.statut,
    emplacement: base.emplacement,
    tri: base.tri,
    ...modifs,
  };
  const recherche = new URLSearchParams();
  for (const [clef, valeur] of Object.entries(valeurs)) {
    if (valeur) recherche.set(clef, valeur);
  }
  const chaine = recherche.toString();
  return chaine ? `/pepiniere/lots?${chaine}` : "/pepiniere/lots";
}
