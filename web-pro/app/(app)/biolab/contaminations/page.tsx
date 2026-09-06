import { createClient } from "@/lib/supabase/server";
import {
  Card,
  DataTable,
  FilterBar,
  MetricCard,
  PageHeader,
  Panel,
  StatusBadge,
  type Column,
} from "@/components/ui";
import {
  perimetreBioLab,
  CONTAMINATION_LABELS,
  CONTAMINATION_TON,
  SEVERITE_LABELS,
  SEVERITE_TON,
  formatAnciennete,
  formatNombre,
  libelle,
  tonDe,
  type Ton,
} from "@/lib/biolab/cultures";
import { EspaceVide, LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  AXES,
  LIBELLE_AXE,
  LIBELLE_TROUBLE,
  TROUBLES,
  axeValide,
  foyers,
  lireBioreacteurs,
  nommeurDeBioreacteur,
  nommeurDeVersion,
  suspicions,
  troublesObserves,
  ventiler,
  type Foyer,
  type LigneVentilation,
} from "@/lib/biolab/contaminations";
import { lireRecettes, lireVersions } from "@/lib/biolab/recettes";
import { lireMatiere, type LigneInspection, type LigneLot } from "@/lib/biolab/statistiques";
import { SEUIL_TAUX, direTaux, formaterDate } from "@/lib/biolab/referentiel";

/**
 * §7 « contaminations » — TROIS QUESTIONS, TROIS BLOCS.
 *
 *   QUOI      : les quatre troubles que l'inspection relève, comptés
 *               séparément — ils n'ont ni la même cause ni le même
 *               remède.
 *   OÙ        : la ventilation, sur les seuls axes que la base porte.
 *   DEPUIS QUAND : les foyers, du plus récent au plus ancien, avec la
 *               date de la PREMIÈRE confirmation.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CET ÉCRAN NE MONTRE PAS, ET POURQUOI C'ÉCRIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Ni « par salle », ni « par rack », ni « par opérateur ». Aucun des
 * trois n'existe dans les données : il n'y a pas de table de salle ;
 * une étiquette `smart_tags` ne porte qu'un seul rattachement à la
 * fois, donc une étiquette de rack ne connaît aucun lot ; et
 * `bioreactor_inspections` n'a pas de colonne d'auteur. Trois colonnes
 * fourre-tout auraient l'air de répondre à la question. Le bandeau du
 * bas le dit à l'utilisateur plutôt que de le laisser chercher.
 */

function lire(valeur: string | string[] | undefined): string {
  if (Array.isArray(valeur)) return valeur[0] ?? "";
  return valeur ?? "";
}

export default async function ContaminationsPage({ searchParams }: PageProps<"/biolab/contaminations">) {
  const contexte = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(contexte, "Le suivi des contaminations");
  const axe = axeValide(lire((await searchParams).axe));

  const entete = (
    <PageHeader
      eyebrow="BioLab"
      title="Contaminations"
      subtitle="Ce qui contamine, où on l'a vu, et depuis quand. Une contamination n'est comptée que lorsqu'un humain l'a confirmée."
    />
  );

  if (refus) {
    return (
      <>
        {entete}
        {refus}
      </>
    );
  }

  const supabase = await createClient();
  const [matiere, versions, recettes, bioreacteurs] = await Promise.all([
    lireMatiere(supabase, contexte.workspaceId),
    lireVersions(supabase, contexte.workspaceId),
    lireRecettes(supabase, contexte.workspaceId),
    lireBioreacteurs(supabase, contexte.workspaceId),
  ]);

  const erreur = matiere.erreur ?? versions.erreur ?? recettes.erreur ?? bioreacteurs.erreur;
  if (erreur) {
    return (
      <>
        {entete}
        <LectureImpossible sujet="Les contaminations" erreur={erreur} />
      </>
    );
  }

  const { lots, inspections } = matiere.donnees;

  if (lots.length === 0) {
    return (
      <>
        {entete}
        <EspaceVide
          quoi="Aucun lot de culture à surveiller"
          aQuoiCaSert="Cet écran ventile les contaminations confirmées par espèce, par milieu, par bioréacteur et par stade, et donne pour chaque lot touché la date de la première confirmation."
        />
      </>
    );
  }

  const troubles = troublesObserves(lots, inspections);
  const listeFoyers = foyers(lots, inspections);
  const listeSuspicions = suspicions(lots, inspections);
  const nommer = {
    version: nommeurDeVersion(versions.donnees, recettes.donnees),
    bioreacteur: nommeurDeBioreacteur(bioreacteurs.donnees),
  };
  const ventilation = ventiler(axe, lots, inspections, nommer);

  return (
    <>
      {entete}

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TROUBLES.map((trouble) => {
          const observe = troubles[trouble];
          return (
            <MetricCard
              key={trouble}
              label={LIBELLE_TROUBLE[trouble]}
              // `direTaux` rend « Non disponible » quand il n'y a rien à
              // mesurer ; `MetricCard` attend null pour afficher un
              // tiret plutôt qu'un zéro.
              value={observe.effectif === 0 ? null : direTaux(observe)}
              hint={`${observe.touches} lot${observe.touches > 1 ? "s" : ""} sur ${observe.effectif}`}
              tone={trouble === "contamination" ? "accent" : "neutral"}
            />
          );
        })}
      </section>

      {inspections.length === 0 && (
        <Card className="mb-8 p-5">
          <p className="text-[var(--text-body)]">
            Aucune inspection n&apos;a encore été enregistrée sur ces {formatNombre(lots.length)} lots.
          </p>
          <p className="mt-2 text-[var(--text-secondary)] text-ink-soft">
            Les chiffres ci-dessus valent donc « rien de constaté », pas « rien à signaler » : un lot jamais inspecté
            n&apos;est pas un lot sain. Les relevés se saisissent depuis l&apos;application mobile, devant le bocal.
          </p>
        </Card>
      )}

      <Panel
        title="Où on la voit"
        description={
          axe === "bioreacteur"
            ? "Les lots INSPECTÉS dans chaque cuve, et ceux dont l'inspection y a confirmé une contamination. C'est « où on l'a vue », pas « où elle est née » : le seul lien enregistré entre un lot et une cuve est l'inspection elle-même."
            : "La part des lots de chaque groupe dont au moins une inspection a confirmé une contamination."
        }
        className="mb-8"
      >
        <div className="px-5 pt-4">
          <FilterBar
            label="Ventiler par"
            current={`/biolab/contaminations?axe=${axe}`}
            filters={AXES.map((valeur) => ({
              label: LIBELLE_AXE[valeur],
              href: `/biolab/contaminations?axe=${valeur}`,
            }))}
          />
        </div>
        <TableauVentilation lignes={ventilation} axe={axe} />
        <div className="border-t border-line px-5 py-3">
          <p className="text-[var(--text-secondary)] text-ink-soft">
            Sous {SEUIL_TAUX} lots, la colonne rend les faits bruts (« 2 sur 3 ») au lieu d&apos;un pourcentage : sur un
            si petit nombre, un seul lot déplacerait le taux de plus de quinze points. L&apos;ordre du tableau, lui,
            reste celui des taux réels.
          </p>
        </div>
      </Panel>

      <Panel
        title="Les foyers"
        description="Un lot par ligne, du plus récemment confirmé au plus ancien."
        count={listeFoyers.length}
        className="mb-8"
      >
        <TableauFoyers foyers={listeFoyers} nommer={nommer} />
      </Panel>

      <Panel
        title="Les relevés"
        description="Chaque inspection enregistrée, la plus récente d'abord. Ouvrir un relevé montre les quatre observations et les photos prises devant le bocal."
        count={inspections.length}
        className="mb-8"
      >
        <TableauReleves
          inspections={[...inspections].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50)}
          lots={lots}
          nommerBioreacteur={nommer.bioreacteur}
        />
        {inspections.length > 50 && (
          <div className="border-t border-line px-5 py-3">
            <p className="text-[var(--text-secondary)] text-ink-soft">
              Les 50 relevés les plus récents sur {formatNombre(inspections.length)}.
            </p>
          </div>
        )}
      </Panel>

      {listeSuspicions.length > 0 && (
        <Panel
          title="Suspicions non confirmées"
          description="Relevées mais jamais confirmées par un humain. Elles ne sont comptées dans aucun taux de cette page — une inquiétude n'est pas un fait."
          count={listeSuspicions.length}
          className="mb-8"
        >
          <ul className="divide-y divide-line">
            {listeSuspicions.map(({ lot, suspecteeLe }) => (
              <li key={lot.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5">
                <span className="font-medium">{lot.batch_code}</span>
                <span className="text-ink-soft">{lot.species_name}</span>
                <StatusBadge tone="warning">Suspectée</StatusBadge>
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  {formaterDate(suspecteeLe)} · {formatAnciennete(suspecteeLe)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Card className="p-5">
        <p className="eyebrow mb-2">Ce que cet écran ne peut pas ventiler</p>
        <p className="text-[var(--text-secondary)] text-ink-soft">
          <strong>Par salle et par étagère</strong> : aucune donnée ne les enregistre.{" "}
          <strong>Par rack</strong> : une étiquette de rack porte son libellé seul et n&apos;est reliée à aucun lot, il
          n&apos;existe donc aucun chemin du lot vers le rack. <strong>Par opérateur</strong> : une inspection
          n&apos;enregistre pas qui l&apos;a faite ; seul le préparateur d&apos;un milieu est connu, et un lot pointe une
          version de recette, pas une préparation précise. Chacun de ces axes reviendrait à deviner — ou, pour le
          dernier, à accuser quelqu&apos;un sur une déduction.
        </p>
      </Card>
    </>
  );
}

function TableauVentilation({ lignes, axe }: { lignes: LigneVentilation[]; axe: string }) {
  const colonnes: Column<LigneVentilation>[] = [
    { key: "groupe", header: LIBELLE_AXE[axe as keyof typeof LIBELLE_AXE] ?? "Groupe", cell: (l) => l.libelle },
    {
      key: "effectif",
      header: axe === "bioreacteur" ? "Lots inspectés" : "Lots",
      numeric: true,
      cell: (l) => formatNombre(l.taux.effectif),
    },
    { key: "touches", header: "Touchés", numeric: true, cell: (l) => formatNombre(l.taux.touches) },
    {
      key: "taux",
      header: "Part touchée",
      numeric: true,
      cell: (l) => (
        <span className={l.taux.touches > 0 ? "font-medium text-critical" : "text-ink-soft"}>{direTaux(l.taux)}</span>
      ),
    },
    {
      key: "depuis",
      header: "Première confirmation",
      secondary: true,
      cell: (l) =>
        l.premiereConfirmation === null ? (
          <span className="text-ink-faint">—</span>
        ) : (
          `${formaterDate(l.premiereConfirmation)} · ${formatAnciennete(l.premiereConfirmation)}`
        ),
    },
    {
      key: "derniere",
      header: "Dernière",
      secondary: true,
      cell: (l) =>
        l.derniereConfirmation === null ? (
          <span className="text-ink-faint">—</span>
        ) : (
          formatAnciennete(l.derniereConfirmation)
        ),
    },
  ];

  return (
    <DataTable
      columns={colonnes}
      rows={lignes}
      rowKey={(l) => l.cle}
      empty={
        <div className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
          Aucun groupe à ventiler sur cet axe.
        </div>
      }
    />
  );
}

/**
 * La liste des relevés.
 *
 * Elle porte les quatre observations côte à côte plutôt qu'un seul
 * verdict : un lot « propre côté contamination » mais sévèrement
 * hyperhydrique est un lot en danger, et une colonne unique le
 * cacherait.
 */
function TableauReleves({
  inspections,
  lots,
  nommerBioreacteur,
}: {
  inspections: LigneInspection[];
  lots: LigneLot[];
  nommerBioreacteur: (id: string) => string;
}) {
  const codes = new Map(lots.map((l) => [l.id, l.batch_code]));

  const observation = (valeur: string, table: Record<string, string>, tons: Record<string, Ton>) => (
    <StatusBadge tone={tonDe(tons, valeur)}>{libelle(table, valeur)}</StatusBadge>
  );

  const colonnes: Column<LigneInspection>[] = [
    { key: "date", header: "Relevé le", cell: (i) => formaterDate(i.date) },
    {
      key: "lot",
      header: "Lot",
      cell: (i) =>
        i.culture_batch_id === null ? (
          <span className="text-ink-faint">Sans lot</span>
        ) : (
          codes.get(i.culture_batch_id) ?? "Lot inconnu"
        ),
    },
    {
      key: "contamination",
      header: "Contamination",
      cell: (i) => observation(i.contamination_status, CONTAMINATION_LABELS, CONTAMINATION_TON),
    },
    {
      key: "hyperhydricite",
      header: "Hyperhydricité",
      secondary: true,
      cell: (i) => observation(i.hyperhydricity_status, SEVERITE_LABELS, SEVERITE_TON),
    },
    {
      key: "necrose",
      header: "Nécrose",
      secondary: true,
      cell: (i) => observation(i.necrosis_status, SEVERITE_LABELS, SEVERITE_TON),
    },
    {
      key: "brunissement",
      header: "Brunissement",
      secondary: true,
      cell: (i) => observation(i.browning_status, SEVERITE_LABELS, SEVERITE_TON),
    },
    {
      key: "cuve",
      header: "Bioréacteur",
      secondary: true,
      cell: (i) =>
        i.bioreactor_id === null ? <span className="text-ink-faint">—</span> : nommerBioreacteur(i.bioreactor_id),
    },
  ];

  return (
    <DataTable
      columns={colonnes}
      rows={inspections}
      rowKey={(i) => i.id}
      rowHref={(i) => `/biolab/contaminations/${i.id}`}
      empty={
        <div className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
          Aucun relevé enregistré. Les inspections se saisissent depuis l&apos;application mobile.
        </div>
      }
    />
  );
}

function TableauFoyers({
  foyers: listeFoyers,
  nommer,
}: {
  foyers: Foyer[];
  nommer: { version: (id: string) => string; bioreacteur: (id: string) => string };
}) {
  const colonnes: Column<Foyer>[] = [
    { key: "lot", header: "Lot", cell: (f) => f.lot.batch_code },
    { key: "espece", header: "Espèce", cell: (f) => f.lot.species_name },
    {
      key: "depuis",
      header: "Confirmée depuis",
      cell: (f) => (
        <span>
          {formaterDate(f.confirmeeLe)}
          <span className="ml-2 text-ink-soft">{formatAnciennete(f.confirmeeLe)}</span>
        </span>
      ),
    },
    {
      key: "recidive",
      header: "Confirmations",
      numeric: true,
      // Une seconde confirmation n'est pas un doublon : c'est une
      // récidive, et elle change ce qu'on décide du lot.
      cell: (f) => formatNombre(f.confirmations),
    },
    {
      key: "milieu",
      header: "Milieu reçu",
      secondary: true,
      cell: (f) =>
        f.versionId === null ? <span className="text-ink-faint">Non renseigné</span> : nommer.version(f.versionId),
    },
    {
      key: "cuves",
      header: "Vue dans",
      secondary: true,
      cell: (f) =>
        f.bioreacteurIds.length === 0 ? (
          <span className="text-ink-faint">Hors bioréacteur</span>
        ) : (
          f.bioreacteurIds.map(nommer.bioreacteur).join(", ")
        ),
    },
  ];

  return (
    <DataTable
      columns={colonnes}
      rows={listeFoyers}
      rowKey={(f) => f.lot.id}
      empty={
        <div className="px-5 py-8 text-center">
          <p className="text-[length:var(--text-card)] font-medium">Aucune contamination confirmée</p>
          <p className="mx-auto mt-2 max-w-md text-[var(--text-body)] text-ink-soft">
            Aucun lot n&apos;a d&apos;inspection confirmant une contamination. Une suspicion seule n&apos;apparaît pas
            ici : elle est listée à part.
          </p>
        </div>
      }
    />
  );
}
