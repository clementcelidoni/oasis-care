import Link from "next/link";
import {
  PageHeader,
  EmptyState,
  DataTable,
  SearchBar,
  FilterBar,
  ButtonLink,
  SubmitButton,
  Badge,
  type Column,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { formatDate } from "@/lib/crm/types";
import {
  perimetreBioLab,
  STADES,
  STADE_LABELS,
  STADE_TON,
  STATUTS_LOT,
  STATUT_LOT_LABELS,
  STATUT_LOT_TON,
  libelle,
  tonDe,
  formatNombre,
} from "@/lib/biolab/cultures";
import {
  lireLots,
  lireParametres,
  construireLien,
  filtreActif,
  ECHEANCES,
  LIGNEES,
  TRIS,
  TRI_PAR_DEFAUT,
  type Echeance,
  type Lignee,
  type LigneLot,
  type Tri,
} from "@/lib/biolab/lots";
import { refusBioLab } from "@/lib/biolab/etats";

/**
 * §7 « cultures », « lots », « sous-lots », « plantes mères » — UN SEUL
 * ÉCRAN, ET C'EST MESURÉ.
 *
 * Le §7 énumère les quatre mots, la base n'a qu'une table :
 * `culture_batches`. Les sous-lots sont son auto-référence
 * (`parent_batch_id`, le résultat du geste « Diviser » du téléphone) ;
 * les plantes mères sont une clé vers `plants`, c'est-à-dire vers le
 * monde du jardin. Quatre écrans qui liraient la même table avec les
 * mêmes colonnes seraient le second système que le §6 interdit — ils
 * divergeraient au premier filtre ajouté d'un seul côté. Ils sont donc
 * quatre FILTRES d'une seule liste, et deux sections d'une seule fiche.
 *
 * §37 TABLES : recherche, filtres, tri, pagination, tout par l'URL —
 * « les lots contaminés d'Alocasia » doit pouvoir s'envoyer par
 * message, et un retour arrière depuis une fiche doit retrouver la
 * liste telle qu'on l'avait laissée.
 */
export default async function LotsBioLabPage({ searchParams }: PageProps<"/biolab/lots">) {
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "Le laboratoire");

  if (refus) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Lots de culture" subtitle="Les cultures in vitro du laboratoire." />
        <EmptyState
          icon={<Icon name="lots" className="h-6 w-6" />}
          title="Accès non autorisé"
          description="Votre rôle ne donne pas accès au laboratoire de cette entreprise. Un responsable ou un administrateur peut vous l'ouvrir depuis Entreprise › Équipe."
        />
      </div>
    );
  }

  const params = await searchParams;
  const p = lireParametres(params);
  const maintenant = new Date();
  const { lignes, total, pages, filtreEnDeuxTemps } = await lireLots(
    perimetre.workspaceId,
    p,
    maintenant,
  );

  const lien = (modifs: Partial<Record<string, string>> = {}) => construireLien(p, modifs);
  const filtre = filtreActif(p);

  const colonnes: Column<LigneLot>[] = [
    {
      key: "code",
      header: "Lot",
      width: "10rem",
      cell: (lot) => (
        <span className="tabular">
          {lot.batch_code}
          {/* Un sous-lot se reconnaît à l'œil : il descend d'un autre
              lot, et c'est la première chose qu'on veut savoir en
              parcourant une liste de lignées. */}
          {lot.parent_batch_id && (
            <span className="ml-2 text-ink-faint" title="Issu d'une division">
              ↳
            </span>
          )}
        </span>
      ),
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
      key: "stade",
      header: "Stade",
      width: "9rem",
      cell: (lot) => (
        <Badge tone={tonDe(STADE_TON, lot.culture_stage)}>
          {libelle(STADE_LABELS, lot.culture_stage)}
        </Badge>
      ),
    },
    {
      key: "explants",
      header: "Explants",
      numeric: true,
      // Le nombre du jour en gras, celui du départ à côté : c'est le
      // rapport des deux qui dit si le lot multiplie ou s'épuise, et le
      // lire d'un coup d'œil évite d'ouvrir la fiche.
      cell: (lot) => (
        <span>
          <span className="font-medium">{formatNombre(lot.current_count)}</span>
          <span className="ml-1.5 text-ink-faint">/ {formatNombre(lot.initial_explant_count)}</span>
        </span>
      ),
    },
    {
      key: "debut",
      header: "Démarré",
      secondary: true,
      cell: (lot) => <span className="text-ink-soft">{formatDate(lot.started_at)}</span>,
    },
    {
      key: "echeance",
      header: "Fin prévue",
      secondary: true,
      cell: (lot) => {
        if (!lot.expected_end_at) return <span className="text-ink-faint">Non fixée</span>;
        const depasse = lot.status === "active" && new Date(lot.expected_end_at) < maintenant;
        return (
          <span className={depasse ? "font-medium text-critical" : "text-ink-soft"}>
            {formatDate(lot.expected_end_at)}
          </span>
        );
      },
    },
    {
      key: "statut",
      header: "État",
      width: "7.5rem",
      cell: (lot) => (
        <Badge tone={tonDe(STATUT_LOT_TON, lot.status)}>
          {libelle(STATUT_LOT_LABELS, lot.status)}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Lots de culture"
        subtitle="Un lot, c'est une espèce, un stade et un nombre d'explants qui partagent la même histoire. Ouvrez-en un pour voir sa lignée, ses inspections et son acclimatation."
        breadcrumb={{ label: "BioLab", href: "/biolab" }}
        action={
          <ButtonLink href="/biolab/tracabilite" variant="secondary">
            Traçabilité
          </ButtonLink>
        }
      />

      <SearchBar
        action="/biolab/lots"
        defaultValue={p.q}
        placeholder="Rechercher un code de lot, une espèce, un cultivar, un type d'explant…"
      >
        {/* Les filtres en cours voyagent avec la recherche : chercher une
            espèce ne doit pas effacer le stade qu'on venait de choisir. */}
        {p.stade && <input type="hidden" name="stade" value={p.stade} />}
        {p.statut && <input type="hidden" name="statut" value={p.statut} />}
        {p.lignee && <input type="hidden" name="lignee" value={p.lignee} />}
        {p.echeance && <input type="hidden" name="echeance" value={p.echeance} />}
        {p.contamination && <input type="hidden" name="contamination" value={p.contamination} />}
        {p.inspection && <input type="hidden" name="inspection" value={p.inspection} />}
        {p.tri !== TRI_PAR_DEFAUT && <input type="hidden" name="tri" value={p.tri} />}
        <SubmitButton variant="secondary">Filtrer</SubmitButton>
      </SearchBar>

      <FilterBar
        label="Filtrer par stade"
        current={lien()}
        filters={[
          { label: "Tous les stades", href: lien({ stade: "" }) },
          ...STADES.map((s) => ({ label: STADE_LABELS[s], href: lien({ stade: s }) })),
        ]}
      />

      <FilterBar
        label="Filtrer par état"
        current={lien()}
        filters={[
          { label: "Tous les états", href: lien({ statut: "" }) },
          ...STATUTS_LOT.map((s) => ({ label: STATUT_LOT_LABELS[s], href: lien({ statut: s }) })),
        ]}
      />

      <FilterBar
        label="Filtrer par lignée"
        current={lien()}
        filters={(Object.keys(LIGNEES) as Lignee[]).map((clef) => ({
          label: LIGNEES[clef],
          href: lien({ lignee: clef }),
        }))}
      />

      {/* Les deux filtres qui viennent du tableau de bord. Ils ne sont
          affichés que lorsqu'ils sont actifs : les proposer en
          permanence encombrerait la barre pour une question qu'on ne se
          pose pas en parcourant une liste. */}
      {(p.echeance || p.contamination || p.inspection) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-[var(--text-secondary)]">
          <span className="text-ink-soft">Filtre venu du tableau de bord :</span>
          <strong>
            {p.echeance
              ? ECHEANCES[p.echeance as Echeance]
              : p.contamination
                ? "Contamination confirmée"
                : "Jamais inspecté"}
          </strong>
          <Link
            href={lien({ echeance: "", contamination: "", inspection: "" })}
            className="text-accent hover:underline"
          >
            retirer
          </Link>
        </div>
      )}

      <FilterBar
        label="Trier"
        current={lien()}
        filters={(Object.keys(TRIS) as Tri[]).map((clef) => ({
          label: TRIS[clef].label,
          href: lien({ tri: clef }),
        }))}
      />

      <DataTable
        columns={colonnes}
        rows={lignes}
        rowKey={(lot) => lot.id}
        rowHref={(lot) => `/biolab/lots/${lot.id}`}
        empty={
          total > 0 ? (
            <EmptyState
              title="Cette page est vide"
              description={`Il n'y a que ${pages} page${pages > 1 ? "s" : ""} de résultats. Revenez à la première.`}
              action={<ButtonLink href={lien()}>Revenir au début</ButtonLink>}
            />
          ) : filtre ? (
            <EmptyState
              title="Aucun lot ne correspond"
              description="Aucun lot ne réunit ces critères. Élargissez la recherche, ou repartez de la liste entière."
              action={
                <ButtonLink href="/biolab/lots" variant="secondary">
                  Effacer les filtres
                </ButtonLink>
              }
            />
          ) : (
            <EmptyState
              icon={<Icon name="lots" className="h-5 w-5" />}
              title="Aucun lot de culture dans cet espace"
              description="Les lots se créent sur le téléphone, à la paillasse, au moment où les explants entrent en bocal. Le web les supervise ensuite : lignée, inspections, contaminations, acclimatation."
              action={
                <ButtonLink href="/biolab" variant="secondary">
                  Retour au tableau de bord
                </ButtonLink>
              }
            />
          )
        }
        footer={
          pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-[var(--text-secondary)] text-ink-soft">
              <span className="tabular">
                Page {p.page} sur {pages} · {formatNombre(total)} lot{total > 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-3">
                {p.page > 1 && (
                  <Link href={lien({ page: String(p.page - 1) })} className="hover:text-accent">
                    ← Précédents
                  </Link>
                )}
                {p.page < pages && (
                  <Link href={lien({ page: String(p.page + 1) })} className="hover:text-accent">
                    Suivants →
                  </Link>
                )}
              </span>
            </div>
          ) : undefined
        }
      />

      {filtreEnDeuxTemps && (
        /* Honnêteté sur le décompte : « contaminé » et « jamais
           inspecté » ne sont pas des colonnes du lot mais des faits
           portés par les inspections. Le filtre se pose donc en deux
           requêtes, et la seconde est bornée. Le dire vaut mieux que
           laisser croire à un décompte exhaustif. */
        <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
          Ce filtre repose sur les inspections, pas sur une colonne du lot : au-delà de mille
          inspections, la sélection peut être partielle.
        </p>
      )}

      <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
        <strong>Explants</strong> : le nombre du jour, puis celui du départ. Leur rapport est le
        rendement de multiplication du lot. <strong>Stade</strong> décrit où en est la plante ;{" "}
        <strong>état</strong> décrit où en est le lot — un lot « divisé » n&apos;est pas perdu, il
        a passé la main à ses sous-lots et garde son compte d&apos;alors comme fait historique.
      </p>
    </div>
  );
}
