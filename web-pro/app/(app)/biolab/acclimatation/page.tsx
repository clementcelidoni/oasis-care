import Link from "next/link";
import {
  PageHeader,
  Panel,
  EmptyState,
  MetricCard,
  ButtonLink,
  StatusBadge,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/crm/types";
import {
  perimetreBioLab,
  lireTableauDeBord,
  STATUT_ACCLIMATATION_LABELS,
  STATUT_ACCLIMATATION_TON,
  libelle,
  tonDe,
  formatNombre,
  formatPourcentage,
} from "@/lib/biolab/cultures";
import { lireAcclimatations, tauxDeSurvie, type Acclimatation } from "@/lib/biolab/lots";
import { LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import { direEffectif } from "@/lib/biolab/referentiel";

/**
 * §7 « acclimatation » — LE PASSAGE DU BOCAL À LA TERRE.
 *
 * C'est l'étape la plus risquée du métier : une plantule sortie d'un
 * bocal à 100 % d'humidité meurt en quelques heures si l'ouverture est
 * trop rapide. La question de l'écran est donc toujours la même —
 * combien sont entrées, combien sont encore là — et c'est elle qui
 * ouvre chaque ligne.
 *
 * LE TAUX DE SURVIE MOYEN N'EST PAS CALCULÉ ICI. Il vient de
 * `biolab_tableau_de_bord`, avec sa précaution : NULL quand aucune
 * plantule n'est entrée, jamais zéro. Seuls les taux LIGNE À LIGNE sont
 * établis ici, et ce ne sont pas des agrégats — voir `tauxDeSurvie`.
 */
export default async function AcclimatationPage() {
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "Le laboratoire");

  if (refus) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Acclimatation" subtitle="Le passage du bocal à la terre." />
        {refus}
      </div>
    );
  }

  const lecturePassages = await lireAcclimatations(perimetre.workspaceId);
  if (lecturePassages.erreur) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Acclimatation" subtitle="Le passage du bocal à la terre." />
        <LectureImpossible sujet="Les passages en acclimatation" erreur={lecturePassages.erreur} />
      </div>
    );
  }
  const passages = lecturePassages.donnees;

  // Les codes des lots d'origine, en une requête. Une acclimatation qui
  // ne dit pas de quel lot elle sort n'est qu'un nombre de plantules.
  const lotsIds = [
    ...new Set(passages.map((p) => p.culture_batch_id).filter((v): v is string => v !== null)),
  ];
  let codes = new Map<string, { code: string; espece: string }>();
  if (lotsIds.length > 0) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("culture_batches")
      .select("id, batch_code, species_name")
      .in("id", lotsIds);
    codes = new Map(
      ((data ?? []) as { id: string; batch_code: string; species_name: string }[]).map((l) => [
        l.id,
        { code: l.batch_code, espece: l.species_name },
      ]),
    );
  }

  const enCours = passages.filter((p) => p.status === "active");

  /**
   * LES DEUX CHIFFRES D'ENSEMBLE VIENNENT DE LA BASE, PAS D'UNE SOMME
   * FAITE ICI.
   *
   * `biolab_tableau_de_bord` totalise déjà les plantules vivantes des
   * passages en cours et moyenne déjà les taux de survie. Les
   * réadditionner ici donnerait deux chiffres pour la même chose le
   * jour où l'une des deux définitions bougerait — et personne ne
   * saurait lequel croire. Le comptage des passages, lui, est la
   * longueur de la liste affichée juste en dessous : il ne peut pas la
   * contredire.
   */
  const lectureBord = await lireTableauDeBord(perimetre.workspaceId);
  const bord = lectureBord.donnees;

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        breadcrumb={{ label: "BioLab", href: "/biolab" }}
        title="Acclimatation"
        subtitle="La sortie du bocal, passage par passage. Un même lot peut être acclimaté plusieurs fois — deux substrats, deux essais — et chaque passage garde son propre compte."
        action={
          <ButtonLink href="/biolab/lots" variant="secondary">
            Lots de culture
          </ButtonLink>
        }
      />

      {passages.length === 0 ? (
        <EmptyState
          icon={<Icon name="nursery" className="h-6 w-6" />}
          title="Aucun passage en acclimatation"
          description="Un passage se crée depuis la fiche d'un lot enraciné, sur le téléphone : on note combien de plantules sortent, sur quel substrat, sous quel programme d'humidité. Le nombre de survivantes se met à jour au fil des jours, et c'est lui qui dit si le protocole tient."
          action={
            <ButtonLink href="/biolab/lots?stade=rooting" variant="secondary">
              Voir les lots enracinés
            </ButtonLink>
          }
        />
      ) : (
        <>
          <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <MetricCard
              label="Passages en cours"
              value={formatNombre(enCours.length)}
              hint={`sur ${formatNombre(passages.length)} enregistrés`}
            />
            <MetricCard
              label="Plantules vivantes"
              value={bord ? formatNombre(bord.plantules_acclimatation) : null}
              hint={
                lectureBord.erreur
                  ? "Chiffre indisponible : la base n'a pas répondu"
                  : "Dans les passages en cours"
              }
              tone="accent"
            />
            {/* LE DÉNOMINATEUR EST DIT. « 100 % de survie » sur un seul
                passage s'affichait comme « 100 % » sur quarante ; sous
                cinq mesures, le texte le signale au lieu de laisser
                lire une tendance. */}
            <MetricCard
              label="Survie moyenne"
              value={bord ? formatPourcentage(bord.taux_survie_acclimatation) : null}
              hint={
                lectureBord.erreur
                  ? "Chiffre indisponible : la base n'a pas répondu"
                  : direEffectif(bord?.acclimatations_mesurees ?? 0, "passage", "passages")
              }
            />
          </section>

          <Panel
            title="Passages"
            description="Les plus récents d'abord. Le pourcentage est celui de CE passage — la moyenne du laboratoire est sur le tableau de bord."
            count={passages.length}
          >
            <ul className="divide-y divide-line">
              {passages.map((p) => (
                <LignePassage key={p.id} passage={p} lot={p.culture_batch_id ? codes.get(p.culture_batch_id) : undefined} />
              ))}
            </ul>
          </Panel>

          <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
            Un passage <strong>terminé</strong> a produit des plantes ; un passage{" "}
            <strong>abandonné</strong> ne les a pas produites, et son compte de survivantes reste
            tel quel — c&apos;est un fait historique, pas un échec à effacer. Les étapes du
            protocole et la création des plantes se font sur le téléphone.
          </p>
        </>
      )}
    </div>
  );
}

function LignePassage({
  passage,
  lot,
}: {
  passage: Acclimatation;
  lot?: { code: string; espece: string };
}) {
  const survie = tauxDeSurvie(passage);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <p className="font-medium">
          {lot && passage.culture_batch_id ? (
            <Link
              href={`/biolab/lots/${passage.culture_batch_id}`}
              className="tabular hover:text-accent"
            >
              {lot.code}
            </Link>
          ) : (
            <span className="text-ink-faint">Lot d&apos;origine hors de cet espace</span>
          )}
          {lot && <span className="ml-2.5 text-ink-soft">{lot.espece}</span>}
        </p>
        <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
          <span className="tabular">
            {formatNombre(passage.current_survivor_count)} survivantes sur{" "}
            {formatNombre(passage.initial_plantlet_count)}
          </span>
          {" · "}
          démarré le {formatDate(passage.started_at)}
          {passage.substrate ? ` · ${passage.substrate}` : ""}
          {passage.location ? ` · ${passage.location}` : ""}
          {passage.humidity_program ? ` · ${passage.humidity_program}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {passage.plants_created && <span className="text-ink-faint">plantes créées</span>}
        <span className="tabular text-[var(--text-secondary)] text-ink-soft">
          {formatPourcentage(survie) ?? "—"}
        </span>
        <StatusBadge tone={tonDe(STATUT_ACCLIMATATION_TON, passage.status)}>
          {libelle(STATUT_ACCLIMATATION_LABELS, passage.status)}
        </StatusBadge>
      </div>
    </li>
  );
}
