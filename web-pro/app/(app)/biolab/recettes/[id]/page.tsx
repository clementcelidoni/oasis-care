import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ActivityTimeline,
  Badge,
  DataTable,
  EmptyState,
  InfoCard,
  PageHeader,
  Panel,
  type Column,
} from "@/components/ui";
import {
  perimetreBioLab,
  formatDateHeure,
  formatNombre,
  formatPourcentage,
  libelle,
} from "@/lib/biolab/cultures";
import { LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  ENTITE_VERSION,
  LIBELLE_ACTION_HISTORIQUE,
  direConcentration,
  direEcart,
  direQuantite,
  direTypeComposant,
  direVolume,
  ecartEntreVersions,
  ecartsDePreparation,
  genealogieDesVersions,
  lireComposants,
  lireHistorique,
  lirePreparations,
  lireRecette,
  lireVersions,
  trierComposants,
  type Composant,
  type LignePreparation,
  type LigneVersion,
} from "@/lib/biolab/recettes";
import { LIBELLE_CATEGORIE_PGR, formaterDate } from "@/lib/biolab/referentiel";

/**
 * §7 — LA FICHE D'UNE RECETTE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CETTE PAGE DOIT RENDRE POSSIBLE, ET QUI EST TOUT LE SUJET
 * ══════════════════════════════════════════════════════════════════
 *
 * « Quelle version a servi à ce lot, en mars ? » Il y a donc trois
 * choses à l'écran, et dans cet ordre :
 *
 *   1. LA FILIATION. Quelles versions existent, laquelle vient de
 *      laquelle, et POURQUOI chacune a été créée (`change_reason`).
 *      Une liste plate par numéro mentirait dès qu'une version a
 *      bifurqué.
 *   2. CE QUI A CHANGÉ. Entre une version et son parent, ligne à
 *      ligne. C'est la seule façon de relire une décision ancienne.
 *   3. LA COMPOSITION EXACTE de la version qu'on regarde, dans l'ordre
 *      où on la verse.
 *
 * La version affichée se choisit par l'URL (`?version=`), pas par un
 * état React : un lien vers « la V3 de MS Alocasia » doit pouvoir se
 * coller dans un message, et le bouton « précédent » doit y ramener.
 */

function lire(valeur: string | string[] | undefined): string {
  if (Array.isArray(valeur)) return valeur[0] ?? "";
  return valeur ?? "";
}

export default async function RecettePage({ params, searchParams }: PageProps<"/biolab/recettes/[id]">) {
  const { id } = await params;
  const contexte = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(contexte, "La fiche d'une recette");

  if (refus) {
    return (
      <>
        <PageHeader eyebrow="BioLab" title="Recette de milieu" breadcrumb={{ label: "Recettes", href: "/biolab/recettes" }} />
        {refus}
      </>
    );
  }

  const supabase = await createClient();
  const [recette, versions] = await Promise.all([
    lireRecette(supabase, contexte.workspaceId, id),
    lireVersions(supabase, contexte.workspaceId, id),
  ]);

  if (recette.erreur ?? versions.erreur) {
    return (
      <>
        <PageHeader eyebrow="BioLab" title="Recette de milieu" breadcrumb={{ label: "Recettes", href: "/biolab/recettes" }} />
        <LectureImpossible sujet="Cette recette" erreur={(recette.erreur ?? versions.erreur) as string} />
      </>
    );
  }

  // Ni la recette d'une autre entreprise, ni une recette effacée : la
  // RLS a déjà tranché, `maybeSingle` a rendu null, et 404 est la seule
  // réponse honnête.
  if (!recette.donnees) notFound();

  const arbre = genealogieDesVersions(versions.donnees);
  const identifiants = versions.donnees.map((v) => v.id);

  const [preparations, historique] = await Promise.all([
    lirePreparations(supabase, contexte.workspaceId, identifiants),
    lireHistorique(supabase, contexte.workspaceId, identifiants),
  ]);

  const demandee = lire((await searchParams).version);
  const parDefaut = [...versions.donnees].sort((a, b) => b.version_number - a.version_number)[0];
  const active = versions.donnees.find((v) => v.id === demandee) ?? parDefaut ?? null;
  const parent = active?.parent_version_id
    ? versions.donnees.find((v) => v.id === active.parent_version_id) ?? null
    : null;

  return (
    <>
      <PageHeader
        eyebrow="BioLab · recette de milieu"
        title={recette.donnees.name}
        subtitle={recette.donnees.species_name || "Toutes espèces"}
        breadcrumb={{ label: "Recettes", href: "/biolab/recettes" }}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <InfoCard label="Versions" value={formatNombre(versions.donnees.length) ?? "0"} />
        <InfoCard label="Préparations" value={formatNombre(preparations.donnees.length) ?? "0"} />
        <InfoCard label="Créée le" value={formaterDate(recette.donnees.created_at)} />
      </div>

      {recette.donnees.notes && (
        <Panel title="Notes" className="mb-6">
          <p className="whitespace-pre-wrap px-5 py-4 text-[var(--text-body)] text-ink-soft">{recette.donnees.notes}</p>
        </Panel>
      )}

      <Panel
        title="Filiation des versions"
        description="Une version ne se modifie jamais : on en crée une nouvelle. C'est ce qui permet à un lot ancien de dire encore exactement ce qu'il a reçu."
        count={versions.donnees.length}
        className="mb-6"
      >
        {arbre.length === 0 ? (
          <div className="px-5 py-6">
            <p className="text-[var(--text-body)] text-ink-soft">
              Cette recette n&apos;a encore aucune version : sa composition n&apos;est donc pas définie. Une première
              version se crée depuis l&apos;application mobile.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {arbre.map(({ version, profondeur }) => {
              const resume = lireComposants(version.components);
              const choisie = version.id === active?.id;
              return (
                <li key={version.id} className={choisie ? "bg-accent-wash/40" : ""}>
                  <Link
                    href={`/biolab/recettes/${id}?version=${version.id}`}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 hover:bg-canvas"
                    style={{ paddingLeft: `${1.25 + profondeur * 1.25}rem` }}
                  >
                    <span className="font-medium">V{version.version_number}</span>
                    {choisie && <Badge tone="accent">affichée</Badge>}
                    <span className="text-[var(--text-secondary)] text-ink-soft">
                      pH visé {formatNombre(version.target_ph)} · {resume.composants.length} composants
                    </span>
                    <span className="text-[var(--text-secondary)] text-ink-faint">
                      {formaterDate(version.created_at)}
                    </span>
                    {version.change_reason && (
                      <span className="w-full text-[var(--text-secondary)] text-ink-soft">
                        « {version.change_reason} »
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {active && (
        <>
          {parent && <PanneauEcart parent={parent} enfant={active} />}
          <PanneauComposition version={active} />
          <PanneauPreparations
            preparations={preparations.donnees.filter((p) => p.recipe_version_id === active.id)}
            composants={lireComposants(active.components).composants}
          />
        </>
      )}

      <PanneauHistorique entrees={historique.donnees} erreur={historique.erreur} versions={versions.donnees} />
    </>
  );
}

/** Ce qui distingue la version affichée de celle dont elle est née. */
function PanneauEcart({ parent, enfant }: { parent: LigneVersion; enfant: LigneVersion }) {
  const ecart = ecartEntreVersions(parent, enfant);
  const rien = ecart.phCible === null && ecart.composants.length === 0;

  return (
    <Panel
      title={`Ce qui a changé entre V${parent.version_number} et V${enfant.version_number}`}
      description="Une comparaison, pas une explication : rien ici ne dit qu'un changement est la cause d'un résultat."
      className="mb-6"
    >
      {rien ? (
        <p className="px-5 py-4 text-[var(--text-body)] text-ink-soft">
          Aucune différence de composition ni de pH visé. Les deux versions ne se distinguent que par leurs notes.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {ecart.phCible && (
            <li className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5">
              <span className="font-medium">pH visé</span>
              <span className="text-ink-soft">
                {formatNombre(ecart.phCible.avant)} → {formatNombre(ecart.phCible.apres)}
              </span>
            </li>
          )}
          {ecart.composants.map((ligne) => (
            <li key={`${ligne.type}-${ligne.nom}`} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5">
              <span className="font-medium">{ligne.nom}</span>
              <Badge tone={ligne.nature === "ajoute" ? "positive" : ligne.nature === "retire" ? "critical" : "warning"}>
                {ligne.nature === "ajoute" ? "ajouté" : ligne.nature === "retire" ? "retiré" : "modifié"}
              </Badge>
              <span className="text-ink-soft">{direEcart(ligne)}</span>
              <span className="text-[var(--text-secondary)] text-ink-faint">{direTypeComposant(ligne.type)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PanneauComposition({ version }: { version: LigneVersion }) {
  const { composants, illisibles } = lireComposants(version.components);
  const ordonnes = trierComposants(composants);

  const colonnes: Column<Composant>[] = [
    { key: "nom", header: "Composant", cell: (c) => c.name },
    { key: "type", header: "Type", cell: (c) => direTypeComposant(c.type) },
    {
      key: "categorie",
      header: "Famille",
      secondary: true,
      cell: (c) =>
        c.pgrCategory ? libelle(LIBELLE_CATEGORIE_PGR, c.pgrCategory) : <span className="text-ink-faint">—</span>,
    },
    { key: "dose", header: "Concentration", numeric: true, cell: (c) => direConcentration(c) },
  ];

  return (
    <Panel
      title={`Composition — V${version.version_number}`}
      description="Dans l'ordre où on les verse : milieu de base, sucre, vitamines, régulateurs, additifs, gélifiant."
      className="mb-6"
      action={
        <span className="text-[var(--text-secondary)] text-ink-soft">
          pH visé {formatNombre(version.target_ph)}
          {/* Le pH MESURÉ d'une version est une lecture de référence,
              distincte du pH mesuré d'une préparation. Ne pas les
              confondre : l'un juge la recette, l'autre le lot de milieu. */}
          {version.measured_ph !== null && ` · pH mesuré ${formatNombre(version.measured_ph)}`}
        </span>
      }
      footer={
        illisibles > 0 ? (
          <span className="text-[var(--text-secondary)] text-critical">
            {illisibles} composant{illisibles > 1 ? "s" : ""} de cette version n&apos;a pas pu être lu et n&apos;est pas
            affiché ci-dessus. Vérifiez la recette sur l&apos;application mobile avant de préparer ce milieu.
          </span>
        ) : version.notes ? (
          <span className="text-[var(--text-secondary)] text-ink-soft">{version.notes}</span>
        ) : undefined
      }
    >
      <DataTable
        columns={colonnes}
        rows={ordonnes}
        rowKey={(c) => c.id ?? `${c.type}-${c.name}`}
        empty={
          <div className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
            Cette version ne déclare aucun composant.
          </div>
        }
      />
    </Panel>
  );
}

function PanneauPreparations({
  preparations,
  composants,
}: {
  preparations: LignePreparation[];
  composants: Composant[];
}) {
  if (preparations.length === 0) {
    return (
      <Panel title="Préparations issues de cette version" className="mb-6">
        <p className="px-5 py-4 text-[var(--text-body)] text-ink-soft">
          Cette version n&apos;a encore servi à aucune préparation enregistrée.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Préparations issues de cette version" count={preparations.length} className="mb-6">
      <ul className="divide-y divide-line">
        {preparations.map((preparation) => {
          const ecarts = ecartsDePreparation(preparation, composants).filter((e) => e.ecartRelatif !== null);
          // On ne signale que les écarts qui comptent. 2 % sur une pesée
          // est le bruit d'une balance ; au-delà, c'est une décision de
          // l'opérateur, et elle doit se voir.
          const notables = ecarts.filter((e) => Math.abs(e.ecartRelatif as number) >= 0.02);
          return (
            <li key={preparation.id} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{preparation.code}</span>
                <span className="text-ink-soft">{direVolume(preparation)}</span>
                <span className="text-[var(--text-secondary)] text-ink-faint">
                  {formaterDate(preparation.prepared_at)}
                  {preparation.prepared_by ? ` · ${preparation.prepared_by}` : ""}
                </span>
                {preparation.measured_ph !== null && (
                  <span className="text-[var(--text-secondary)] text-ink-soft">
                    pH mesuré {formatNombre(preparation.measured_ph)}
                  </span>
                )}
              </div>
              {notables.length > 0 && (
                <p className="mt-1 text-[var(--text-secondary)] text-warning">
                  Écart à la cible :{" "}
                  {notables
                    .map(
                      (e) =>
                        `${e.composant?.name ?? "composant inconnu"} ${formatPourcentage(e.ecartRelatif) ?? "?"} (${direQuantite(e.pesee.actualAmount, e.pesee.amountUnit)} au lieu de ${direQuantite(
                          e.pesee.targetAmount,
                          e.pesee.amountUnit,
                        )})`,
                    )
                    .join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/**
 * L'historique du §7, avec sa limite écrite.
 *
 * `biolab_audit_entries` n'enregistre aujourd'hui que DEUX actions —
 * `versioned`, posée par `MediumRecipeService`, et `split`, posée par
 * `CultureBatchService`. Balayage fait sur les appels à
 * `BioLabAuditService.log` : il n'y en a pas d'autres. Ce n'est donc pas
 * un journal de toutes les modifications, et le présenter comme tel
 * donnerait une fausse assurance à quelqu'un qui viendrait y chercher
 * une trace absente.
 */
function PanneauHistorique({
  entrees,
  erreur,
  versions,
}: {
  entrees: { id: string; entity_type: string; entity_id: string; action: string; detail: string; performed_by: string | null; occurred_at: string }[];
  erreur: string | null;
  versions: LigneVersion[];
}) {
  if (erreur) return <LectureImpossible sujet="L'historique de cette recette" erreur={erreur} />;

  const numeros = new Map(versions.map((v) => [v.id, v.version_number]));

  return (
    <Panel
      title="Historique"
      description="Le journal enregistre les créations de version et les divisions de lot, et rien d'autre : ni les changements de stade, ni les corrections. Une absence ici ne veut pas dire qu'il ne s'est rien passé."
    >
      {entrees.length === 0 ? (
        <div className="px-5 py-6">
          <EmptyState
            title="Aucun événement enregistré"
            description="Les créations de version faites depuis l'application mobile apparaîtront ici, avec leur auteur et leur date."
          />
        </div>
      ) : (
        <div className="px-5 py-4">
          <ActivityTimeline
            items={entrees.map((entree) => ({
              id: entree.id,
              time: formatDateHeure(entree.occurred_at),
              title:
                (LIBELLE_ACTION_HISTORIQUE[entree.action] ?? entree.action) +
                (entree.entity_type === ENTITE_VERSION && numeros.has(entree.entity_id)
                  ? ` — V${numeros.get(entree.entity_id)}`
                  : ""),
              detail: [entree.detail, entree.performed_by].filter(Boolean).join(" · ") || undefined,
              tone: "neutral" as const,
            }))}
          />
        </div>
      )}
    </Panel>
  );
}
