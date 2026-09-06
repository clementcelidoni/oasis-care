import Link from "next/link";
import {
  PageHeader,
  Panel,
  EmptyState,
  MetricCard,
  ButtonLink,
  StatusBadge,
  ActivityTimeline,
  SubmitButton,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  perimetreBioLab,
  lireTableauDeBord,
  lireActiviteRecente,
  lireMatiereAttention,
  pointsDAttention,
  formatNombre,
  formatPourcentage,
  formatFacteur,
  formatJourCourt,
  formatHeure,
} from "@/lib/biolab/cultures";
import { LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import { direEffectif, direTauxEnCarte, observerDepuisTaux } from "@/lib/biolab/referentiel";
import { reprendreLaboratoire } from "@/lib/biolab/reprise";
import {
  lireLaboratoiresAilleurs,
  type LaboratoireAilleurs,
} from "@/lib/biolab/repriseLecture";

/**
 * §7 « dashboard BioLab » — LA PAGE QUI RÉPOND À « OÙ EN SONT MES
 * CULTURES ».
 *
 * Elle ne commence pas par des chiffres. Elle commence par ce qui
 * demande une décision aujourd'hui : ce qui a contaminé, ce qui a
 * dépassé son terme, ce qui n'a jamais été regardé, ce qui arrive cette
 * semaine. Les indicateurs viennent après, parce qu'on ne les consulte
 * pas le matin — on les consulte quand on se demande si le mois a été
 * bon.
 *
 * AUCUN CHIFFRE N'EST CALCULÉ ICI. Les dix-huit mesures viennent de
 * `biolab_tableau_de_bord`, la lecture posée par la migration 0087, qui
 * reprend `BioLabDashboardService.summary` du téléphone ligne à ligne.
 * Recompter côté web produirait, un jour, deux nombres différents pour
 * la même journée — et personne ne saurait lequel croire.
 *
 * UN TAUX INCONNU EST UN TIRET, JAMAIS UN ZÉRO. La base rend NULL quand
 * elle n'a rien pour calculer ; `MetricCard` affiche alors « — ». « 0 %
 * de contamination » et « aucune inspection pour en juger » sont deux
 * affirmations différentes, et l'une des deux serait fausse.
 */
export default async function BioLabPage() {
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "Le laboratoire");

  if (refus) {
    // La RLS refuserait de toute façon, mais elle refuse en rendant une
    // liste VIDE — et « aucune culture » est un mensonge quand la vérité
    // est « pas pour vous ».
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="BioLab" subtitle="Le laboratoire de culture in vitro." />
        <EmptyState
          icon={<Icon name="nursery" className="h-6 w-6" />}
          title="Accès non autorisé"
          description="Votre rôle ne donne pas accès au laboratoire de cette entreprise. Un responsable ou un administrateur peut vous l'ouvrir depuis Entreprise › Équipe."
          action={
            <ButtonLink href="/entreprise/equipe" variant="secondary">
              Voir l&apos;équipe
            </ButtonLink>
          }
        />
      </div>
    );
  }

  const maintenant = new Date();
  const [lectureBord, lectureMatiere, lectureActivite] = await Promise.all([
    lireTableauDeBord(perimetre.workspaceId),
    lireMatiereAttention(perimetre.workspaceId, maintenant),
    lireActiviteRecente(perimetre.workspaceId, 10),
  ]);

  const bord = lectureBord.donnees;
  const activite = lectureActivite.donnees;
  const points = pointsDAttention(lectureMatiere.donnees, maintenant);

  // ------------------------------------------------------------------
  // TROIS SITUATIONS, ET PAS DEUX.
  //
  // Le défaut corrigé ici est le plus grave de l'écran : la lecture du
  // tableau de bord rendait `null` aussi bien quand le laboratoire est
  // vide que quand la fonction de base n'existe pas — ce qui est
  // exactement le cas aujourd'hui, la migration 0087 n'étant pas
  // appliquée : l'appel répond HTTP 404. La page en déduisait « aucune
  // culture dans l'espace de cette entreprise », puis expliquait
  // doctement que les cultures étaient rangées ailleurs. Un diagnostic
  // présenté comme mesuré, sur une requête qui avait échoué.
  //
  // Pire : la branche « vide » masquait les points d'attention —
  // contaminations confirmées, alertes du téléphone, termes dépassés —
  // qui, eux, viennent de tables ordinaires et avaient été lus sans
  // encombre. Un laboratoire réellement contaminé se présentait comme
  // un laboratoire inexistant.
  // ------------------------------------------------------------------
  const enPanne = lectureBord.erreur !== null;
  // Écrit sous cette forme et pas autrement : TypeScript sait alors que
  // dans la branche « ni en panne ni vide », `bord` n'est pas nul.
  const vide = !bord || bord.lots_total === 0;

  // ------------------------------------------------------------------
  // L'ESPACE VIDE ALORS QUE LES CULTURES EXISTENT.
  //
  // Le téléphone estampille tout ce qu'il écrit du PREMIER ESPACE
  // PERSONNEL du compte. Le dirigeant saisit ses lots sur son
  // téléphone : ils partent dans son espace privé, pas dans celui de
  // son entreprise. Un écran qui se contenterait d'annoncer « aucune
  // culture » serait littéralement faux — les cultures existent, elles
  // ne sont pas ici.
  //
  // On le mesure plutôt que de le supposer : la RLS ne rend que les
  // espaces dont l'utilisateur est membre, donc ce comptage ne peut
  // révéler le laboratoire de personne d'autre.
  // ------------------------------------------------------------------
  // On ne compte plus « les lots visibles ailleurs » sans savoir où :
  // l'ancienne mesure prenait TOUT espace autre que celui de
  // l'entreprise active, si bien que pour un utilisateur membre de deux
  // sociétés, les lots de la seconde étaient annoncés comme « dans
  // votre espace personnel ». On liste maintenant les espaces
  // PERSONNELS QUE L'UTILISATEUR POSSÈDE — les seuls qu'il puisse
  // rapatrier — et le panneau propose le geste au lieu de s'arrêter au
  // constat.
  let laboratoiresAilleurs: LaboratoireAilleurs[] = [];
  if (vide && !enPanne) {
    laboratoiresAilleurs = (await lireLaboratoiresAilleurs(perimetre.workspaceId)).donnees;
  }
  const lotsAilleurs = laboratoiresAilleurs.reduce((somme, l) => somme + l.lots, 0);

  const rienAujourdHui =
    !bord ||
    bord.immersions_du_jour +
      bord.aerations_du_jour +
      bord.inspections_du_jour +
      bord.milieux_du_jour ===
      0;

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="BioLab"
        subtitle={
          bord && bord.lots_total > 0
            ? `${formatNombre(bord.lots_actifs)} lot${bord.lots_actifs > 1 ? "s" : ""} en culture, ${formatNombre(bord.explants_total)} explants en bocal.`
            : "Cultures in vitro, milieux, acclimatation et traçabilité."
        }
        action={
          <ButtonLink href="/biolab/lots" variant="secondary">
            Tous les lots
          </ButtonLink>
        }
      />

      {/* ---------------------------------------------------------
          1. CE QUI DEMANDE UNE DÉCISION. En premier, TOUJOURS — y
             compris quand le tableau de bord est en panne ou l'espace
             vide. Ces cinq signaux viennent de tables ordinaires
             (`bioreactor_inspections`, `biolab_alerts`,
             `culture_batches`), pas de la fonction de 0087 : les
             cacher parce qu'un agrégat a échoué reviendrait à taire
             une contamination confirmée pour une raison qui n'a rien à
             voir.
         --------------------------------------------------------- */}
      {lectureMatiere.erreur ? (
        <div className="mb-4">
          <LectureImpossible sujet="Les points d'attention" erreur={lectureMatiere.erreur} />
        </div>
      ) : points.length > 0 ? (
        <Panel
          title="À décider aujourd'hui"
          description="Ce qui est perdu, ce qui va l'être, ce qu'il faut aller regarder."
          className="mb-4"
        >
          <ul className="divide-y divide-line">
            {points.map((point) => (
              <li
                key={point.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="text-[var(--text-body)] font-medium">
                    <StatusBadge tone={point.ton} dot>
                      {point.titre}
                    </StatusBadge>
                  </p>
                  <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{point.detail}</p>
                </div>
                {point.lien && (
                  <Link
                    href={point.lien.href}
                    className="shrink-0 text-[var(--text-secondary)] font-medium text-accent hover:underline"
                  >
                    {point.lien.label} →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {enPanne ? (
        /* LA PANNE, DITE COMME UNE PANNE. Elle ne se confond plus avec
           un laboratoire vide : la migration 0087 n'est pas encore
           appliquée à la production, et sans cette branche l'écran
           affirmait « aucune culture dans cette entreprise » à qui en a
           quarante. */
        <LectureImpossible
          sujet="Les indicateurs du laboratoire"
          erreur={lectureBord.erreur ?? "Lecture impossible"}
        />
      ) : vide ? (
        <>
          {/* §32 — ce qu'il n'y a pas, à quoi ça sert, et par où
              commencer. Jamais dix-huit zéros : dix-huit zéros
              ressemblent à une panne de calcul. */}
          <EmptyState
            icon={<Icon name="nursery" className="h-6 w-6" />}
            title="Aucune culture dans l'espace de cette entreprise"
            description="Le laboratoire se saisit sur le téléphone : un lot de culture, son espèce, son stade et son nombre d'explants. Le web en est la vue de supervision — il montre, il ne remplace pas la paillasse."
            action={
              <ButtonLink href="/biolab/tracabilite" variant="secondary">
                Voir la traçabilité
              </ButtonLink>
            }
          />

          {lotsAilleurs > 0 && (
            <Panel
              title="Vos cultures existent, mais pas dans cet espace"
              description="Mesuré à l'instant, sur les espaces dont vous êtes membre."
              className="mt-4"
            >
              <div className="space-y-3 px-5 py-5 text-[var(--text-body)]">
                <p>
                  <strong className="tabular">{formatNombre(lotsAilleurs)}</strong> lot
                  {lotsAilleurs > 1 ? "s" : ""} de culture vous {lotsAilleurs > 1 ? "sont" : "est"}{" "}
                  accessible{lotsAilleurs > 1 ? "s" : ""}, mais {lotsAilleurs > 1 ? "ils vivent" : "il vit"}{" "}
                  dans un <strong>espace personnel</strong> et non dans celui de{" "}
                  {perimetre.organisation.name}.
                </p>
                <p className="text-ink-soft">
                  C&apos;est mécanique et ce n&apos;est pas une erreur de votre part :
                  l&apos;application iPhone range tout ce qu&apos;elle écrit dans le premier espace
                  personnel du compte. Cet écran, lui, ne lit que l&apos;espace de
                  l&apos;entreprise — et c&apos;est délibéré. Lire votre espace privé donnerait à
                  toute l&apos;entreprise, y compris à un salarié invité demain, le droit de
                  modifier et de supprimer votre laboratoire.
                </p>
                <p className="text-ink-soft">
                  Le déplacement est réversible : il déplace les lignes, il n&apos;en supprime
                  aucune, et il garde le détail de ce qui a bougé pour pouvoir le défaire. Vos
                  plantes mères, elles, restent dans votre jardin personnel — elles
                  n&apos;appartiennent pas au laboratoire.
                </p>

                {/* LA PORTE, ET PAS SEULEMENT LE CONSTAT.
                    L'écran savait dire pourquoi il était vide sans
                    savoir y remédier ; un diagnostic exact sans issue
                    est une impasse. Le geste appelle la fonction
                    `transferer_biolab_vers_entreprise` de la migration
                    0087 — deux contrôles en base, journal ligne à ligne,
                    retour arrière possible. Ce n'est PAS une commande
                    d'équipement : le §7 interdit d'allumer une pompe
                    depuis le web, pas de ranger ses propres données. */}
                {perimetre.peutGerer ? (
                  <div className="space-y-2 border-t border-line pt-3">
                    {laboratoiresAilleurs.map((labo) => (
                      <form
                        key={labo.workspaceId}
                        action={reprendreLaboratoire}
                        className="flex flex-wrap items-center justify-between gap-3"
                      >
                        <input type="hidden" name="espace_source" value={labo.workspaceId} />
                        <span>
                          <strong>{labo.nom}</strong> —{" "}
                          {formatNombre(labo.lots)} lot{labo.lots > 1 ? "s" : ""}
                        </span>
                        <SubmitButton variant="secondary">
                          Reprendre ce laboratoire dans {perimetre.organisation.name}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                ) : (
                  <p className="border-t border-line pt-3 text-ink-soft">
                    Le rapatriement demande le droit « gestion BioLab » et doit être lancé par le
                    propriétaire de l&apos;espace de départ. Votre rôle ne le porte pas.
                  </p>
                )}
              </div>
            </Panel>
          )}
        </>
      ) : (
        <>
          {/* Le mot rassurant, réservé au cas où l'on a vraiment
              regardé : il n'apparaît que si le laboratoire contient
              quelque chose ET que les cinq lectures ont abouti. Dire
              « rien à arbitrer » au-dessus d'un espace vide serait
              une garantie donnée sur rien. */}
          {points.length === 0 && !lectureMatiere.erreur && (
            <Panel title="À décider aujourd'hui" className="mb-4">
              <p className="flex items-center gap-2 px-5 py-5 text-[var(--text-body)] text-ink-soft">
                <Icon name="check" className="h-4 w-4 text-positive" />
                Rien à arbitrer : aucune contamination confirmée cette semaine, aucun lot au-delà
                de son terme, aucun lot actif sans inspection.
              </p>
            </Panel>
          )}

          {/* ---------------------------------------------------------
              2. L'ÉTAT DU LABORATOIRE.
             --------------------------------------------------------- */}
          <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Lots actifs"
              value={formatNombre(bord.lots_actifs)}
              hint={`sur ${formatNombre(bord.lots_total)} au total`}
              href="/biolab/lots?statut=active"
            />
            <MetricCard
              label="Explants en bocal"
              value={formatNombre(bord.explants_total)}
              hint="Dans les lots actifs"
              tone="accent"
            />
            <MetricCard
              label="En multiplication"
              value={formatNombre(bord.lots_multiplication)}
              hint={`${formatNombre(bord.lots_enracinement)} en enracinement`}
              href="/biolab/lots?stade=multiplication"
            />
            <MetricCard
              label="Plantules en acclimatation"
              value={formatNombre(bord.plantules_acclimatation)}
              hint="Survivantes des passages en cours"
              href="/biolab/acclimatation"
            />
          </section>

          {/* -----------------------------------------------------------
              LES QUATRE TAUX, AVEC LEUR DÉNOMINATEUR.
              Un pourcentage sans son effectif n'est pas vérifiable : la
              carte « Contamination (7 j) » affichait « 100 % » sur une
              seule inspection exactement comme sur quarante. Pire, son
              libellé annonçait le nombre d'inspections DU JOUR sous un
              taux calculé sur SEPT JOURS — le seul chiffre qui
              ressemblait à un dénominateur n'en était pas un.
              Les deux PROPORTIONS passent par la règle du module (sous
              cinq observations, les faits bruts remplacent le
              pourcentage) ; les deux MOYENNES, qui n'ont pas de
              numérateur entier, disent sur combien de mesures elles
              portent.
             ----------------------------------------------------------- */}
          <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="Rendement moyen"
              value={formatFacteur(bord.taux_multiplication_moyen)}
              hint={direEffectif(bord.lots_mesures_multiplication, "lot", "lots")}
            />
            <MetricCard
              label="Contamination (7 j)"
              value={direTauxEnCarte(
                observerDepuisTaux(bord.taux_contamination_7j, bord.inspections_7j),
              )}
              hint={
                bord.inspections_7j === 0
                  ? "Aucune inspection cette semaine"
                  : `sur ${formatNombre(bord.inspections_7j)} inspection${bord.inspections_7j > 1 ? "s" : ""} de la semaine — confirmées, pas suspectées`
              }
            />
            <MetricCard
              label="Survie en acclimatation"
              value={formatPourcentage(bord.taux_survie_acclimatation)}
              hint={direEffectif(bord.acclimatations_mesurees, "passage", "passages")}
            />
            <MetricCard
              label="Lots écartés"
              value={direTauxEnCarte(observerDepuisTaux(bord.taux_perte, bord.lots_total))}
              hint={`sur ${formatNombre(bord.lots_total)} lot${bord.lots_total > 1 ? "s" : ""} au total`}
            />
          </section>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            {/* -------------------------------------------------------
                3. AUJOURD'HUI.
               ------------------------------------------------------- */}
            <Panel
              title="Aujourd'hui au laboratoire"
              description="Les gestes enregistrés depuis minuit, heure de Paris."
            >
              {rienAujourdHui ? (
                /* Quatre zéros diraient « la machine n'a rien fait ». La
                   vérité est plus modeste : rien n'a été ENREGISTRÉ. Les
                   immersions et les aérations sont écrites par le
                   bioréacteur, pas par le web. */
                <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
                  Aucun geste enregistré aujourd&apos;hui. Les immersions et les aérations sont
                  écrites par le bioréacteur lui-même ; les inspections et les préparations de
                  milieu, depuis le téléphone.
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-4 px-5 py-5">
                  {[
                    { label: "Immersions", valeur: bord.immersions_du_jour },
                    { label: "Aérations", valeur: bord.aerations_du_jour },
                    { label: "Inspections", valeur: bord.inspections_du_jour },
                    { label: "Milieux préparés", valeur: bord.milieux_du_jour },
                  ].map((ligne) => (
                    <div key={ligne.label}>
                      <dt className="eyebrow">{ligne.label}</dt>
                      <dd className="tabular mt-1 text-[length:var(--text-card)] font-semibold">
                        {formatNombre(ligne.valeur)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </Panel>

            {/* -------------------------------------------------------
                4. L'ACTIVITÉ RÉCENTE.
               ------------------------------------------------------- */}
            <Panel
              title="Activité récente"
              description="Cycles, inspections et préparations de milieu, les plus récents d'abord."
            >
              {activite.length === 0 ? (
                <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
                  Rien d&apos;horodaté pour l&apos;instant. Cette frise se remplit à la première
                  inspection ou à la première préparation de milieu.
                </p>
              ) : (
                <div className="px-5 py-5">
                  <ActivityTimeline
                    items={activite.map((ligne) => ({
                      id: `${ligne.categorie}-${ligne.objet_id}`,
                      time: formatJourCourt(ligne.survenu_le),
                      title: ligne.libelle,
                      detail:
                        ligne.categorie === "cycle"
                          ? "Cycle de bioréacteur"
                          : ligne.categorie === "inspection"
                            ? "Relevé d'inspection"
                            : "Préparation de milieu",
                      tone: ligne.categorie === "inspection" ? "accent" : "neutral",
                    }))}
                  />
                </div>
              )}
            </Panel>
          </div>

          {bord.articles_stock_faible > 0 && (
            <Panel title="Consommables" className="mb-4">
              <p className="px-5 py-4 text-[var(--text-body)]">
                <strong className="tabular">{formatNombre(bord.articles_stock_faible)}</strong>{" "}
                article{bord.articles_stock_faible > 1 ? "s" : ""} de paillasse{" "}
                {bord.articles_stock_faible > 1 ? "sont" : "est"} sous le seuil que vous avez
                fixé.
              </p>
            </Panel>
          )}
        </>
      )}

      {/* §9 — LA FRAÎCHEUR, DITE PLUTÔT QUE PROMISE.
          La publication `supabase_realtime` ne contient aucune table :
          rien de ce que le téléphone écrit n'arrive ici sans que la page
          soit redemandée. Écrire « en direct » serait faux ; on date
          donc ce qu'on montre, et on le dit. */}
      <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
        Relevé à {formatHeure(maintenant)} — cette
        page est lue à chaque affichage. Elle ne reçoit rien en direct : ce que vous saisissez sur
        le téléphone apparaît ici au rechargement suivant.
      </p>
    </div>
  );
}
