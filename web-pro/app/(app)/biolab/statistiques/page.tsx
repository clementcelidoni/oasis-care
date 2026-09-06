import { createClient } from "@/lib/supabase/server";
import { Card, DataTable, MetricCard, PageHeader, Panel, type Column } from "@/components/ui";
import {
  perimetreBioLab,
  lireTableauDeBord,
  formatDuree,
  formatFacteur,
  formatNombre,
  formatPourcentage,
  formatHeure,
} from "@/lib/biolab/cultures";
import { EspaceVide, LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  lireStatistiquesBioreacteurs,
  lireStatistiquesEspeces,
  type StatistiqueBioreacteur,
  type StatistiqueEspece,
} from "@/lib/biolab/statistiques";
import {
  SEUIL_TAUX,
  direEffectif,
  direTaux,
  direTauxEnCarte,
  observer,
  observerDepuisTaux,
} from "@/lib/biolab/referentiel";

/**
 * §7 « statistiques » — LES CHIFFRES, CALCULÉS EN BASE.
 *
 * ══════════════════════════════════════════════════════════════════
 * AUCUN TAUX N'EST CALCULÉ DANS CETTE PAGE
 * ══════════════════════════════════════════════════════════════════
 *
 * Les trois blocs viennent de trois fonctions SQL de 0087, qui
 * reprennent elles-mêmes `BioLabDashboardService` et
 * `BioLabAnalyticsService` du téléphone. La page LIT et METTE EN FORME,
 * rien de plus. Un taux recalculé ici finirait par différer de celui de
 * la base, et le jour où les deux divergent, personne ne sait lequel
 * croire.
 *
 * La seule arithmétique de ce fichier est le SEUIL — décider si un taux
 * rendu par la base repose sur assez de lots pour être montré comme un
 * pourcentage. C'est une règle d'affichage, pas un calcul : la valeur
 * ne change pas, seule sa présentation change.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CES CHIFFRES NE SONT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce sont des taux OBSERVÉS sur ce laboratoire, pas des probabilités.
 * Un lot jamais inspecté n'est pas compté comme contaminé, et le « taux
 * de réussite » d'un bioréacteur n'est pas une disponibilité
 * calendaire — le produit n'enregistre aucune durée d'immobilisation
 * dont on pourrait en déduire une. Les deux réserves sont écrites à
 * l'écran, pas seulement ici.
 */

export default async function StatistiquesPage() {
  const contexte = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(contexte, "Les statistiques du laboratoire");

  const entete = (
    <PageHeader
      eyebrow="BioLab"
      title="Statistiques"
      subtitle="Ce que le laboratoire a réellement produit, espèce par espèce et bioréacteur par bioréacteur."
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

  const maintenant = new Date();
  const supabase = await createClient();
  const [lectureResume, especes, bioreacteurs] = await Promise.all([
    // Le lecteur du SOCLE, pas un second : `biolab_tableau_de_bord` n'a
    // qu'un seul appelant dans le module, sinon deux écrans finiraient
    // par arrondir le même chiffre différemment.
    lireTableauDeBord(contexte.workspaceId),
    lireStatistiquesEspeces(supabase, contexte.workspaceId),
    lireStatistiquesBioreacteurs(supabase, contexte.workspaceId),
  ]);

  // Les trois lectures échouent ensemble quand la migration n'est pas
  // appliquée. Les trois portent désormais leur erreur — le lecteur du
  // socle l'avalait, et c'est ce qui faisait passer une panne pour un
  // laboratoire vide.
  const resume = lectureResume.donnees;
  const erreur = lectureResume.erreur ?? especes.erreur ?? bioreacteurs.erreur;
  if (erreur) {
    return (
      <>
        {entete}
        <LectureImpossible sujet="Les statistiques" erreur={erreur} />
      </>
    );
  }

  if (!resume || resume.lots_total === 0) {
    return (
      <>
        {entete}
        <EspaceVide
          quoi="Aucun lot de culture à mesurer"
          aQuoiCaSert="Les statistiques comparent les espèces sur le rendement de multiplication, la contamination, l'hyperhydricité, l'enracinement et la survie en acclimatation, et rendent compte de l'activité de chaque bioréacteur."
        />
      </>
    );
  }

  return (
    <>
      {entete}

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Lots actifs"
          value={formatNombre(resume.lots_actifs)}
          hint={`sur ${formatNombre(resume.lots_total)} au total`}
          tone="accent"
        />
        <MetricCard
          label="Explants en culture"
          value={formatNombre(resume.explants_total)}
          hint="dans les lots actifs"
        />
        <MetricCard
          label="Multiplication moyenne"
          // null quand aucun lot n'a de compte de départ. `MetricCard`
          // affiche alors un tiret : « je ne sais pas multiplier » et
          // « ça ne multiplie pas » sont deux affirmations différentes.
          value={
            resume.taux_multiplication_moyen === null
              ? null
              : formatFacteur(resume.taux_multiplication_moyen)
          }
          hint={direEffectif(resume.lots_mesures_multiplication, "lot", "lots")}
        />
        {/* LE DÉNOMINATEUR EST CELUI DU TAUX, PAS UN AUTRE. Ce libellé
            annonçait le nombre d'inspections DU JOUR sous un taux
            calculé sur SEPT JOURS : un laboratoire ayant fait une
            inspection aujourd'hui et quarante sur la semaine lisait
            « 5 % — 1 inspection(s) aujourd'hui ». */}
        <MetricCard
          label="Contamination (7 jours)"
          value={direTauxEnCarte(
            observerDepuisTaux(resume.taux_contamination_7j, resume.inspections_7j),
          )}
          hint={
            resume.inspections_7j === 0
              ? "aucune inspection cette semaine"
              : `sur ${formatNombre(resume.inspections_7j)} inspection${resume.inspections_7j > 1 ? "s" : ""} de la semaine`
          }
        />
        <MetricCard
          label="Taux de perte"
          value={direTauxEnCarte(observerDepuisTaux(resume.taux_perte, resume.lots_total))}
          hint={`lots écartés sur ${formatNombre(resume.lots_total)} au total`}
        />
        <MetricCard
          label="Survie en acclimatation"
          value={
            resume.taux_survie_acclimatation === null ? null : formatPourcentage(resume.taux_survie_acclimatation)
          }
          hint={`${formatNombre(resume.plantules_acclimatation)} plantules suivies — ${direEffectif(resume.acclimatations_mesurees, "passage", "passages")}`}
        />
        <MetricCard
          label="Durée moyenne d'un cycle"
          value={
            resume.duree_cycle_moyenne_secondes === null
              ? null
              : formatDuree(resume.duree_cycle_moyenne_secondes)
          }
          hint="sur les cycles terminés"
        />
        {/* C'EST UN ÉTAT, PAS UNE STATISTIQUE, et il hérite donc de la
            péremption des lignes qu'il compte. Le libellé le dit et le
            pied de page date la lecture — le reste de cette page porte
            sur l'historique, qui ne périme pas. */}
        <MetricCard
          label="Bioréacteurs en service"
          value={formatNombre(resume.bioreacteurs_actifs)}
          hint="hors maintenance, portant un lot — état à l'instant de la lecture"
          href="/biolab/equipements"
        />
      </section>

      <Card className="mb-8 p-5">
        <p className="eyebrow mb-2">Comment lire ces chiffres</p>
        <p className="text-[var(--text-secondary)] text-ink-soft">
          Ce sont des taux <strong>observés sur ce laboratoire</strong>, pas des probabilités. Une contamination
          n&apos;est comptée que lorsqu&apos;un humain l&apos;a <strong>confirmée</strong> — une suspicion n&apos;entre
          dans aucun de ces chiffres. Un lot <strong>jamais inspecté compte au dénominateur</strong> : il n&apos;est
          pas présumé sain, il est compté comme non contaminé faute de relevé — c&apos;est la seule définition
          possible, et c&apos;est pourquoi la colonne « Inspectés » du tableau ci-dessous existe. Un laboratoire qui
          n&apos;inspecte qu&apos;un lot sur dix verra donc ses taux divisés par dix. Sous {SEUIL_TAUX} observations,
          les faits bruts remplacent le pourcentage. Et un indicateur incalculable s&apos;affiche par un tiret,
          jamais par zéro.
        </p>
      </Card>

      <Panel
        title="Par espèce"
        description={`Le rendement, les accidents et la survie, espèce par espèce. Sous ${SEUIL_TAUX} lots, les faits bruts remplacent le pourcentage.`}
        count={especes.donnees.length}
        className="mb-8"
      >
        <TableauEspeces lignes={especes.donnees} />
      </Panel>

      <Panel
        title="Par bioréacteur"
        description="Cycles réalisés et lots menés à terme. Le taux de réussite compare les cycles terminés aux cycles tentés — ce n'est pas une disponibilité calendaire : le produit n'enregistre aucune durée d'immobilisation."
        count={bioreacteurs.donnees.length}
      >
        <TableauBioreacteurs lignes={bioreacteurs.donnees} />
      </Panel>

      {/* §9 — CE QUE CETTE PAGE NE PROMET PAS. Elle était la seule des
          six à ne dater ni son rendu ni son unique indicateur d'état
          (« Bioréacteurs en service »). Rien n'arrive ici en direct :
          la publication temps réel de la base ne contient aucune
          table. */}
      <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
        Relevé à {formatHeure(maintenant)} — les taux portent sur l&apos;historique, qui ne périme
        pas ; « Bioréacteurs en service » est un état, et il date de cette lecture. Rien n&apos;arrive
        ici en direct : ce que vous saisissez sur le téléphone apparaît au rechargement suivant.
      </p>
    </>
  );
}

function TableauEspeces({ lignes }: { lignes: StatistiqueEspece[] }) {
  /**
   * Le seuil s'applique à un taux VENU DE LA BASE.
   *
   * On ne recalcule rien : on reconstruit seulement le couple
   * (touchés, effectif) que la base a divisé, pour décider s'il faut
   * montrer un pourcentage ou les faits bruts. L'arrondi remet le
   * numérateur sur un entier — un taux exact divisé par un entier ne
   * peut valoir qu'un entier de retour.
   */
  const presenter = (taux: number | null, lots: number) =>
    taux === null ? "Non disponible" : direTaux(observer(Math.round(taux * lots), lots));

  const colonnes: Column<StatistiqueEspece>[] = [
    { key: "espece", header: "Espèce", cell: (l) => l.espece || <span className="text-ink-faint">Non renseignée</span> },
    { key: "lots", header: "Lots", numeric: true, cell: (l) => formatNombre(l.lots) },
    {
      // L'ÉCART ENTRE L'EFFECTIF ET L'EFFECTIF OBSERVÉ.
      // Le taux de contamination se calcule sur TOUS les lots de
      // l'espèce, inspectés ou non : un lot jamais regardé compte comme
      // non contaminé. C'est la seule définition possible — le produit
      // n'a rien d'autre — mais un laboratoire qui n'inspecte qu'un lot
      // sur dix voit alors son taux divisé par dix. Cette colonne rend
      // l'écart visible au lieu de le laisser deviner.
      key: "inspectes",
      header: "Inspectés",
      numeric: true,
      secondary: true,
      cell: (l) => (
        <span className={l.lots_inspectes < l.lots ? "text-warning" : undefined}>
          {formatNombre(l.lots_inspectes)}
        </span>
      ),
    },
    {
      key: "multiplication",
      header: "Multiplication",
      numeric: true,
      cell: (l) => formatFacteur(l.taux_multiplication_moyen),
    },
    {
      key: "contamination",
      header: "Contamination",
      numeric: true,
      cell: (l) => (
        <span className={(l.taux_contamination ?? 0) > 0 ? "font-medium text-critical" : undefined}>
          {presenter(l.taux_contamination, l.lots)}
        </span>
      ),
    },
    {
      key: "hyperhydricite",
      header: "Hyperhydricité",
      numeric: true,
      secondary: true,
      cell: (l) => presenter(l.taux_hyperhydricite, l.lots),
    },
    {
      key: "enracinement",
      header: "Enracinement",
      numeric: true,
      secondary: true,
      // Le stade ATTEINT, pas une réussite : le produit n'a aucun signal
      // « enracinement tenté et échoué ». Le libellé de l'en-tête le dit
      // court, la description du panneau le dit long.
      //
      // ET IL PASSE PAR LE SEUIL, comme les deux colonnes précédentes.
      // Il ne le faisait pas : sur l'unique lot de production, cette
      // cellule affichait « 0 % » ou « 100 % » — un pourcentage sur un
      // effectif de un, sous un panneau qui promettait justement le
      // contraire.
      cell: (l) => presenter(l.taux_enracinement, l.lots),
    },
    {
      key: "survie",
      header: "Survie acclimatation",
      numeric: true,
      // C'est une MOYENNE de taux de survie, pas une proportion de lots :
      // il n'y a pas de numérateur entier à reconstruire, donc pas de
      // « 2 sur 3 » possible. Le pourcentage reste, et c'est la colonne
      // « Lots » qui dit sur quoi il porte.
      cell: (l) => formatPourcentage(l.taux_survie_acclimatation),
    },
  ];

  return (
    <DataTable
      columns={colonnes}
      rows={lignes}
      rowKey={(l) => l.espece}
      empty={
        <div className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
          Aucune espèce à comparer : il faut au moins un lot de culture enregistré.
        </div>
      }
    />
  );
}

function TableauBioreacteurs({ lignes }: { lignes: StatistiqueBioreacteur[] }) {
  const colonnes: Column<StatistiqueBioreacteur>[] = [
    { key: "code", header: "Bioréacteur", cell: (l) => `${l.code} — ${l.nom}` },
    { key: "termines", header: "Cycles terminés", numeric: true, cell: (l) => formatNombre(l.cycles_termines) },
    { key: "echoues", header: "Cycles échoués", numeric: true, cell: (l) => formatNombre(l.cycles_echoues) },
    {
      key: "reussite",
      header: "Taux de réussite",
      numeric: true,
      // null quand aucun cycle n'a été tenté. Surtout pas « 0 % » :
      // cela accuserait un équipement neuf d'un échec qu'il n'a pas eu.
      cell: (l) => formatPourcentage(l.taux_reussite),
    },
    {
      key: "lots",
      header: "Lots menés à terme",
      numeric: true,
      secondary: true,
      cell: (l) => formatNombre(l.lots_termines),
    },
  ];

  return (
    <DataTable
      columns={colonnes}
      rows={lignes}
      rowKey={(l) => l.bioreacteur_id}
      empty={
        <div className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
          Aucun bioréacteur enregistré dans cet espace.
        </div>
      }
      footer={
        <span className="text-[var(--text-secondary)] text-ink-soft">
          « Lots menés à terme » compte les lots inspectés dans cette cuve qui ont atteint le stade terminé. C&apos;est
          un approchant : le seul lien lot↔bioréacteur que le produit enregistre est l&apos;inspection.
        </span>
      }
    />
  );
}
