import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PageHeader,
  Panel,
  Badge,
  StatusBadge,
  ButtonLink,
  MetricCard,
  DataTable,
  ActivityTimeline,
  type Column,
} from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  perimetreBioLab,
  STADE_LABELS,
  STADE_TON,
  STATUT_LOT_LABELS,
  STATUT_LOT_TON,
  CONTAMINATION_LABELS,
  CONTAMINATION_TON,
  SEVERITE_LABELS,
  SEVERITE_TON,
  STATUT_ACCLIMATATION_LABELS,
  STATUT_ACCLIMATATION_TON,
  SYSTEME_LABELS,
  HISTORIQUE_ACTION_LABELS,
  HISTORIQUE_OBJET_LABELS,
  libelle,
  tonDe,
  formatNombre,
  formatPourcentage,
  formatFacteur,
  formatJourCourt,
  formatDateHeure,
} from "@/lib/biolab/cultures";
import {
  lireFicheLot,
  lireGenealogie,
  lireInspections,
  lireAcclimatations,
  lireEtiquettes,
  lireHistorique,
  arbreDeLignee,
  tailleDeLignee,
  tauxDeSurvie,
  facteurDeMultiplication,
  nomDePlante,
  type Inspection,
  type NoeudLignee,
} from "@/lib/biolab/lots";

/**
 * §7 — LA FICHE D'UN LOT DE CULTURE.
 *
 * Elle porte, dans cet ordre : ce que le lot est, d'où il vient, ce
 * qu'il est devenu, et ce qu'on a observé dessus. La filiation est le
 * cœur du métier — une culture vient d'une plante mère, se multiplie en
 * sous-lots, s'acclimate et part en pépinière — donc elle vient avant
 * les inspections, qui sont le détail.
 *
 * LA LIGNÉE N'EST PAS RECALCULÉE ICI. Elle vient de
 * `biolab_genealogie_lot`, qui remonte à la racine puis redescend,
 * exactement comme `CultureLineageService.tree` sur le téléphone — et
 * pour la raison qu'il écrit lui-même : « l'arbre montré doit partir de
 * la vraie origine, pas de l'endroit où l'utilisateur a ouvert un
 * lot ». Deux parcours différents montreraient deux arbres différents
 * pour la même famille de lots.
 */
export default async function FicheLotBioLabPage({ params }: PageProps<"/biolab/lots/[id]">) {
  const { id } = await params;
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "Le laboratoire");
  if (refus) notFound();

  const fiche = await lireFicheLot(perimetre.workspaceId, id);
  // UNE PANNE N'EST PAS UN 404. Un lot introuvable mérite « cette page
  // n'existe pas » ; une lecture refusée mérite de dire pourquoi.
  if (fiche.erreur) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Lot de culture" subtitle="Fiche du lot." />
        <LectureImpossible sujet="Ce lot" erreur={fiche.erreur} />
      </div>
    );
  }
  const lot = fiche.donnees;
  if (!lot) notFound();

  const [lectureGenealogie, lectureInspections, lectureAcclimatations, lectureEtiquettes, lectureHistorique] =
    await Promise.all([
      lireGenealogie(lot.id),
      lireInspections(perimetre.workspaceId, lot.id),
      lireAcclimatations(perimetre.workspaceId, lot.id),
      lireEtiquettes(perimetre.workspaceId, lot.id),
      lireHistorique(perimetre.workspaceId, lot.id),
    ]);

  const genealogie = lectureGenealogie.donnees;
  const inspections = lectureInspections.donnees;
  const acclimatations = lectureAcclimatations.donnees;
  const etiquettes = lectureEtiquettes.donnees;
  const historique = lectureHistorique.donnees;

  const arbre = arbreDeLignee(genealogie);
  const tailleLignee = tailleDeLignee(arbre);
  const sousLotsDirects = genealogie.filter((l) => l.parent_id === lot.id);
  const maintenant = new Date();
  const enRetard =
    lot.status === "active" && lot.expected_end_at && new Date(lot.expected_end_at) < maintenant;

  // La plante mère est référencée mais absente de la réponse : ce n'est
  // pas une donnée manquante, c'est la RLS qui l'a écartée parce
  // qu'elle vit dans un autre espace de travail. Le dire est le seul
  // comportement honnête.
  const mereHorsPortee = Boolean(lot.mother_plant_id) && !lot.plants;

  const colonnesInspection: Column<Inspection>[] = [
    {
      key: "date",
      header: "Date",
      width: "9rem",
      cell: (i) => <span className="tabular">{formatDate(i.date)}</span>,
    },
    {
      key: "contamination",
      header: "Contamination",
      width: "10rem",
      cell: (i) => (
        <Badge tone={tonDe(CONTAMINATION_TON, i.contamination_status)}>
          {libelle(CONTAMINATION_LABELS, i.contamination_status)}
        </Badge>
      ),
    },
    {
      key: "hyperhydricite",
      header: "Hyperhydricité",
      secondary: true,
      cell: (i) => (
        <Badge tone={tonDe(SEVERITE_TON, i.hyperhydricity_status)}>
          {libelle(SEVERITE_LABELS, i.hyperhydricity_status)}
        </Badge>
      ),
    },
    {
      key: "necrose",
      header: "Nécrose",
      secondary: true,
      cell: (i) => (
        <Badge tone={tonDe(SEVERITE_TON, i.necrosis_status)}>
          {libelle(SEVERITE_LABELS, i.necrosis_status)}
        </Badge>
      ),
    },
    {
      key: "brunissement",
      header: "Brunissement",
      secondary: true,
      cell: (i) => (
        <Badge tone={tonDe(SEVERITE_TON, i.browning_status)}>
          {libelle(SEVERITE_LABELS, i.browning_status)}
        </Badge>
      ),
    },
    {
      key: "comptage",
      header: "Comptés",
      numeric: true,
      cell: (i) =>
        i.estimated_count === null ? (
          <span className="text-ink-faint">—</span>
        ) : (
          formatNombre(i.estimated_count)
        ),
    },
    {
      key: "aspect",
      header: "Aspect",
      cell: (i) => (
        <span className="text-ink-soft">
          {[i.culture_appearance, i.growth_status].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        breadcrumb={{ label: "Lots de culture", href: "/biolab/lots" }}
        eyebrow={lot.parent_batch_id ? "Sous-lot" : "Lot d'origine"}
        title={lot.batch_code}
        subtitle={`${lot.species_name}${lot.cultivar ? ` ‘${lot.cultivar}’` : ""}${
          lot.explant_type ? ` — explants : ${lot.explant_type}` : ""
        }`}
        action={
          <>
            <Badge tone={tonDe(STADE_TON, lot.culture_stage)}>
              {libelle(STADE_LABELS, lot.culture_stage)}
            </Badge>
            <Badge tone={tonDe(STATUT_LOT_TON, lot.status)}>
              {libelle(STATUT_LOT_LABELS, lot.status)}
            </Badge>
            <ButtonLink href={`/biolab/tracabilite/${lot.id}`} variant="secondary">
              Traçabilité
            </ButtonLink>
          </>
        }
      />

      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Explants"
          value={formatNombre(lot.current_count)}
          hint={`entrés à ${formatNombre(lot.initial_explant_count)}`}
          tone="accent"
        />
        <MetricCard
          label="Rendement"
          value={formatFacteur(facteurDeMultiplication(lot))}
          hint="Aujourd'hui rapporté au départ"
        />
        <MetricCard label="Démarré" value={formatDate(lot.started_at)} hint="Mise en culture" />
        <MetricCard
          label="Fin prévue"
          value={lot.expected_end_at ? formatDate(lot.expected_end_at) : null}
          hint={
            enRetard
              ? "Terme dépassé"
              : lot.expected_end_at
                ? "Terme que vous avez noté"
                : "Aucun terme noté"
          }
          tone={enRetard ? "critical" : "neutral"}
        />
      </section>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------------------
            L'ORIGINE. Plante mère, lot parent, milieu.
           --------------------------------------------------------- */}
        <Panel title="Origine" description="D'où vient ce lot, et sur quel milieu il pousse.">
          <dl className="divide-y divide-line">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
              <dt className="text-[var(--text-secondary)] text-ink-soft">Plante mère</dt>
              <dd className="text-right">
                {lot.plants ? (
                  <>
                    <span className="font-medium">{nomDePlante(lot.plants)}</span>
                    {lot.plants.scientific_name && (
                      <span className="ml-2 text-[var(--text-secondary)] italic text-ink-soft">
                        {lot.plants.scientific_name}
                      </span>
                    )}
                  </>
                ) : mereHorsPortee ? (
                  <span className="text-warning">
                    Référencée, mais hors de cet espace de travail
                  </span>
                ) : (
                  <span className="text-ink-faint">Aucune</span>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
              <dt className="text-[var(--text-secondary)] text-ink-soft">Lot parent</dt>
              <dd className="text-right">
                {lot.parent_batch_id ? (
                  <Link
                    href={`/biolab/lots/${lot.parent_batch_id}`}
                    className="tabular font-medium text-accent hover:underline"
                  >
                    {genealogie.find((l) => l.lot_id === lot.parent_batch_id)?.code ??
                      "Ouvrir le lot parent"}
                  </Link>
                ) : (
                  <span className="text-ink-faint">Aucun — ce lot ouvre sa lignée</span>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
              <dt className="text-[var(--text-secondary)] text-ink-soft">Milieu de culture</dt>
              <dd className="text-right">
                {lot.medium_recipe_versions ? (
                  <span className="font-medium">
                    {lot.medium_recipe_versions.medium_recipes?.name ?? "Recette"} — V
                    {lot.medium_recipe_versions.version_number}
                  </span>
                ) : (
                  <span className="text-ink-faint">Aucune version de recette rattachée</span>
                )}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
              <dt className="text-[var(--text-secondary)] text-ink-soft">Système de culture</dt>
              <dd className="text-right">
                {lot.culture_system ? (
                  libelle(SYSTEME_LABELS, lot.culture_system)
                ) : (
                  <span className="text-ink-faint">Non précisé</span>
                )}
              </dd>
            </div>
          </dl>
          {mereHorsPortee && (
            <p className="border-t border-line px-5 py-3 text-[var(--text-secondary)] text-ink-soft">
              La plante existe, mais elle appartient à un autre espace de travail — un jardin
              personnel, le plus souvent. La chaîne de traçabilité commence donc un cran trop tard,
              et ce n&apos;est pas une donnée manquante : c&apos;est une frontière de propriété.
            </p>
          )}
        </Panel>

        {/* ---------------------------------------------------------
            LA LIGNÉE.
           --------------------------------------------------------- */}
        <Panel
          title="Lignée"
          description="La famille entière, depuis le lot d'origine. Ce lot y est en gras."
          count={tailleLignee > 0 ? tailleLignee : undefined}
        >
          {lectureGenealogie.erreur ? (
            /* LA PAGE SE CONTREDISAIT. « Ce lot n'a ni parent ni
               sous-lot » s'affichait ici pendant que la ligne « Lot
               parent », quelques centimètres plus haut, montrait un
               lien — parce qu'elle lit une colonne locale, elle, et
               n'a pas besoin de la fonction de base. Une lecture qui
               échoue ne prouve rien sur la famille du lot. */
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              La lignée n&apos;a pas pu être lue, donc rien n&apos;est affirmé ici : ce lot a
              peut-être des sous-lots. La base a répondu :{" "}
              <span className="font-mono">{lectureGenealogie.erreur}</span>
            </p>
          ) : arbre.length === 0 ? (
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Ce lot n&apos;a ni parent ni sous-lot connu dans cet espace.
            </p>
          ) : (
            <div className="px-5 py-4">
              <ArbreLignee noeuds={arbre} courant={lot.id} />
              {sousLotsDirects.length === 0 && (
                <p className="mt-4 text-[var(--text-secondary)] text-ink-soft">
                  Ce lot n&apos;a pas encore été divisé. La division se fait sur le téléphone :
                  elle crée des sous-lots qui gardent celui-ci pour parent, et qui portent la
                  multiplication.
                </p>
              )}
            </div>
          )}
        </Panel>
      </div>

      {/* -----------------------------------------------------------
          L'ACCLIMATATION.
         ----------------------------------------------------------- */}
      <Panel
        title="Acclimatation"
        description="Le passage du bocal à la terre — l'étape qui décide combien de plantules survivent."
        count={acclimatations.length || undefined}
        className="mb-4"
      >
        {acclimatations.length === 0 ? (
          <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
            Aucun passage enregistré pour ce lot. Un même lot peut être acclimaté plusieurs fois —
            deux substrats, deux essais — et chaque passage garde son propre compte de survivantes.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {acclimatations.map((a) => {
              const survie = tauxDeSurvie(a);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span className="tabular">
                        {formatNombre(a.current_survivor_count)} survivantes
                      </span>{" "}
                      <span className="text-ink-soft">
                        sur {formatNombre(a.initial_plantlet_count)} entrées
                      </span>
                    </p>
                    <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
                      Démarrée le {formatDate(a.started_at)}
                      {a.substrate ? ` · ${a.substrate}` : ""}
                      {a.location ? ` · ${a.location}` : ""}
                      {a.humidity_program ? ` · ${a.humidity_program}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-[var(--text-secondary)] text-ink-soft">
                      {formatPourcentage(survie) ?? "—"}
                    </span>
                    <StatusBadge tone={tonDe(STATUT_ACCLIMATATION_TON, a.status)}>
                      {libelle(STATUT_ACCLIMATATION_LABELS, a.status)}
                    </StatusBadge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* -----------------------------------------------------------
          LES INSPECTIONS.
         ----------------------------------------------------------- */}
      <div className="mb-4">
        <Panel
          title="Inspections"
          description="Ce qu'on a vu dans le bocal, relevé après relevé. Une contamination « confirmée » est le jugement d'un opérateur, jamais une déduction."
          count={inspections.length || undefined}
        >
          {inspections.length === 0 ? (
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Aucune inspection enregistrée. C&apos;est là que se voit une contamination qui
              démarre : les relevés se saisissent sur le téléphone, devant le bocal.
            </p>
          ) : (
            <div className="px-5 py-4">
              <DataTable
                columns={colonnesInspection}
                rows={inspections}
                rowKey={(i) => i.id}
                empty={null}
              />
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* -------------------------------------------------------
            LES ÉTIQUETTES.
           ------------------------------------------------------- */}
        <Panel
          title="Étiquettes"
          description="QR et NFC portent la même identité logique : une seule table, une colonne de type."
          count={etiquettes.length || undefined}
        >
          {etiquettes.length === 0 ? (
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Aucune étiquette sur ce lot. Elles se posent depuis le téléphone, et servent à
              retrouver le lot devant l&apos;étagère sans chercher son code.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {etiquettes.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <span className="min-w-0">
                    <Badge tone={e.active ? "accent" : "neutral"}>{e.type.toUpperCase()}</Badge>
                    {e.rack_label && (
                      <span className="ml-2.5 text-[var(--text-body)]">{e.rack_label}</span>
                    )}
                    {!e.active && <span className="ml-2.5 text-ink-faint">désactivée</span>}
                  </span>
                  <span className="shrink-0 text-[var(--text-secondary)] text-ink-soft">
                    {e.last_scanned_at
                      ? `Scannée le ${formatDate(e.last_scanned_at)}`
                      : "Jamais scannée"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* -------------------------------------------------------
            L'HISTORIQUE.
           ------------------------------------------------------- */}
        <Panel
          title="Historique"
          description="Ce que le laboratoire journalise réellement sur un lot : sa division en sous-lots."
          count={historique.length || undefined}
        >
          {lectureHistorique.erreur ? (
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Le journal n&apos;a pas pu être lu. La base a répondu :{" "}
              <span className="font-mono">{lectureHistorique.erreur}</span>
            </p>
          ) : historique.length === 0 ? (
            /* CE QUE LE JOURNAL ENREGISTRE, MESURÉ PLUTÔT QUE SUPPOSÉ.
               Balayage de tous les appels au journal dans l'application
               iPhone : il y en a EXACTEMENT DEUX — la division d'un lot
               (CultureBatchService) et le versionnage d'une recette
               (MediumRecipeService). Le second est classé sur
               l'identifiant de la VERSION, pas sur celui du lot : il
               n'apparaît donc jamais ici. Et « changement de stade »
               est déclaré dans le modèle sans que personne ne l'écrive.
               Le promettre ferait conclure à un journal qui perd des
               gestes. */
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Rien de journalisé sur ce lot. Sur une fiche de lot, le journal n&apos;enregistre
              qu&apos;une seule chose : la division en sous-lots, faite depuis le téléphone. Ni
              les changements de stade, ni les corrections de comptage n&apos;y figurent — une
              absence ici ne veut donc pas dire qu&apos;il ne s&apos;est rien passé.
            </p>
          ) : (
            <div className="px-5 py-5">
              <ActivityTimeline
                items={historique.map((h) => ({
                  id: h.id,
                  time: formatJourCourt(h.occurred_at),
                  title: libelle(HISTORIQUE_ACTION_LABELS, h.action),
                  detail:
                    [h.detail, h.performed_by].filter(Boolean).join(" — ") ||
                    libelle(HISTORIQUE_OBJET_LABELS, h.entity_type),
                }))}
              />
            </div>
          )}
        </Panel>
      </div>

      {lot.notes && (
        <Panel title="Notes" className="mt-4">
          <p className="whitespace-pre-line px-5 py-4 text-[var(--text-body)]">{lot.notes}</p>
        </Panel>
      )}

      <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
        Fiche établie le {formatDateHeure(maintenant.toISOString())}. Le web supervise le
        laboratoire ; la saisie, la division d&apos;un lot et la commande des équipements restent
        sur le téléphone.
      </p>
    </div>
  );
}

/**
 * L'arbre de lignée, rendu en liste imbriquée.
 *
 * Une `<ul>` dans une `<ul>` plutôt que des marges calculées : un
 * lecteur d'écran annonce alors la profondeur toute seule, et
 * l'imbrication reste juste même si la lignée descend plus loin que
 * prévu.
 */
function ArbreLignee({ noeuds, courant }: { noeuds: NoeudLignee[]; courant: string }) {
  return (
    <ul className="space-y-1.5 border-l border-line pl-4">
      {noeuds.map((noeud) => (
        <li key={noeud.id}>
          <div className="flex flex-wrap items-baseline gap-2">
            {noeud.id === courant ? (
              <span className="tabular font-semibold">{noeud.code}</span>
            ) : (
              <Link
                href={`/biolab/lots/${noeud.id}`}
                className="tabular font-medium hover:text-accent"
              >
                {noeud.code}
              </Link>
            )}
            <span className="text-[var(--text-secondary)] text-ink-soft">
              {libelle(STADE_LABELS, noeud.stade)} · {formatNombre(noeud.explants)} explants
            </span>
            {noeud.statut !== "active" && (
              <Badge tone={tonDe(STATUT_LOT_TON, noeud.statut)}>
                {libelle(STATUT_LOT_LABELS, noeud.statut)}
              </Badge>
            )}
          </div>
          {noeud.enfants.length > 0 && (
            <div className="mt-1.5">
              <ArbreLignee noeuds={noeud.enfants} courant={courant} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
