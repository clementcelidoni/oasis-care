import Link from "next/link";
import { notFound } from "next/navigation";
import {
  PageHeader,
  Panel,
  Card,
  Badge,
  StatusBadge,
  ButtonLink,
  DataTable,
  type Column,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  perimetreBioLab,
  libelle,
  tonDe,
  formatDateHeure,
  formatDuree,
  formatPourcentage,
} from "@/lib/biolab/cultures";
import { refusBioLab } from "@/lib/biolab/etats";
import {
  lireEquipement,
  fraicheurEtat,
  composantsDe,
  resumerProgramme,
  depassement,
  STATUT_BIOREACTEUR_LABELS,
  STATUT_BIOREACTEUR_TON,
  TYPE_BIOREACTEUR_LABELS,
  COMPOSANT_LABELS,
  ROLE_OBJET_LABELS,
  ENTRETIEN_LABELS,
  CYCLE_LABELS,
  STATUT_CYCLE_LABELS,
  STATUT_CYCLE_TON,
  type Cycle,
  type Entretien,
} from "@/lib/biolab/equipements";

/**
 * §7 — LA FICHE D'UN BIORÉACTEUR, EN LECTURE SEULE.
 *
 * Elle répond, dans cet ordre, aux quatre questions que le §7 nomme :
 * quel est son état, quel programme tourne, quels objets connectés le
 * pilotent, et qu'a-t-il fait dernièrement. Puis son entretien, qui est
 * un journal et non une échéance — le produit n'enregistre aucune
 * périodicité, donc aucune maintenance ne peut être annoncée « due ».
 *
 * AUCUNE ÉCRITURE, NULLE PART. Les trois gestes de commande du module
 * mobile — le bascule « Automatisation active », le bouton « Tester »
 * d'un objet lié, l'activation d'une version de programme — n'ont pas
 * d'équivalent ici. Le programme actif est AFFICHÉ, jamais modifiable :
 * §7 le range explicitement parmi les choses à montrer.
 */
export default async function FicheEquipementPage({
  params,
}: PageProps<"/biolab/equipements/[id]">) {
  const { id } = await params;
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "La fiche d'un équipement");

  if (refus) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Équipement" breadcrumb={{ label: "Équipements", href: "/biolab/equipements" }} />
        {refus}
      </div>
    );
  }

  const detail = await lireEquipement(perimetre.workspaceId, id);
  if (!detail) notFound();

  const { fiche, programme, programme_nom, objets, cycles, entretiens } = detail;
  const maintenant = new Date();
  const fraicheur = fraicheurEtat(fiche.updated_at, maintenant);
  const composants = composantsDe(fiche.component_types);
  const reglages = resumerProgramme(programme);

  const colonnesCycles: Column<Cycle>[] = [
    {
      key: "type",
      header: "Cycle",
      cell: (cycle) => (
        <span className="font-medium">{libelle(CYCLE_LABELS, cycle.cycle_type)}</span>
      ),
    },
    {
      key: "statut",
      header: "Résultat",
      cell: (cycle) => (
        <Badge tone={tonDe(STATUT_CYCLE_TON, cycle.status)}>
          {libelle(STATUT_CYCLE_LABELS, cycle.status)}
        </Badge>
      ),
    },
    {
      key: "debut",
      header: "Démarré",
      cell: (cycle) => (
        <span className="text-ink-soft">
          {/* Le démarrage RÉEL prime sur le planifié : c'est lui qui
              s'est produit. On retombe sur le planifié quand le cycle
              n'a jamais démarré, ce qui est déjà une information. */}
          {formatDateHeure(cycle.actual_start ?? cycle.planned_start)}
          {!cycle.actual_start && cycle.planned_start && (
            <span className="ml-1 text-ink-faint">(planifié)</span>
          )}
        </span>
      ),
      secondary: true,
    },
    {
      key: "duree",
      header: "Durée",
      numeric: true,
      cell: (cycle) => {
        const reelle = formatDuree(cycle.actual_duration_seconds);
        const ecart = depassement(cycle);
        return (
          <span className="tabular">
            {reelle ?? <span className="text-ink-faint">—</span>}
            {/* Un dépassement n'est signalé que s'il est calculable ET
                significatif. Sans durée prévue il n'y a pas d'écart, et
                surtout pas « 0 % ». */}
            {ecart !== null && ecart > 0.1 && (
              <span className="ml-1.5 text-critical">+{formatPourcentage(ecart)}</span>
            )}
          </span>
        );
      },
    },
    {
      key: "raison",
      header: "Motif d'échec",
      cell: (cycle) =>
        cycle.failure_reason ? (
          <span className="text-critical">{cycle.failure_reason}</span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
      secondary: true,
    },
  ];

  const colonnesEntretien: Column<Entretien>[] = [
    {
      key: "date",
      header: "Date",
      cell: (event) => <span className="text-ink-soft">{formatDateHeure(event.date)}</span>,
    },
    {
      key: "type",
      header: "Intervention",
      cell: (event) => (
        <span className="font-medium">{libelle(ENTRETIEN_LABELS, event.event_type)}</span>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      cell: (event) => event.notes || <span className="text-ink-faint">—</span>,
      secondary: true,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow={fiche.code ?? undefined}
        title={fiche.name ?? fiche.code ?? "Bioréacteur"}
        subtitle={
          fiche.bioreactor_type
            ? libelle(TYPE_BIOREACTEUR_LABELS, fiche.bioreactor_type)
            : undefined
        }
        breadcrumb={{ label: "Équipements", href: "/biolab/equipements" }}
        action={
          fiche.current_batch_id ? (
            <ButtonLink href={`/biolab/lots/${fiche.current_batch_id}`} variant="secondary">
              Ouvrir le lot en cours
            </ButtonLink>
          ) : undefined
        }
      />

      {/* -----------------------------------------------------------
          1. L'ÉTAT, ET SA DATE — jamais l'un sans l'autre.
         ----------------------------------------------------------- */}
      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={tonDe(STATUT_BIOREACTEUR_TON, fiche.status)}>
            {libelle(STATUT_BIOREACTEUR_LABELS, fiche.status)}
          </StatusBadge>
          {fiche.automation_enabled === null ? (
            <Badge tone="neutral">Automatisation non renseignée</Badge>
          ) : fiche.automation_enabled ? (
            <Badge tone="positive">Automatisation active</Badge>
          ) : (
            <Badge tone="neutral">Automatisation désactivée</Badge>
          )}
          <span className="text-[var(--text-secondary)] text-ink-faint">{fraicheur.texte}</span>
        </div>

        {fraicheur.ancien && (
          /* LA MISE EN GARDE QUI ÉVITE LE MENSONGE. Un état non réécrit
             depuis plus d'une journée peut être exact — une machine à
             l'arrêt le reste — ou bien signifier que le téléphone ne
             synchronise plus. On ne tranche pas : on dit ce qu'on sait. */
          <p className="mt-3 rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2 text-[var(--text-secondary)] text-ink-soft">
            Cette ligne n&apos;a pas été réécrite depuis plus d&apos;une journée. L&apos;appareil
            est peut-être simplement à l&apos;arrêt, ou bien le téléphone ne synchronise plus —
            l&apos;écran ne peut pas les distinguer. À vérifier sur place si l&apos;état vous
            surprend.
          </p>
        )}

        <p className="mt-3 text-[var(--text-secondary)] text-ink-faint">
          La date affichée est celle de la dernière <strong>écriture</strong> de la fiche, pas
          celle d&apos;un relevé de capteur : ce produit n&apos;enregistre pas d&apos;horodatage
          de mesure pour l&apos;état d&apos;un bioréacteur.
        </p>
      </Card>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------------------
            2. LA MACHINE — ce qu'elle est, où elle est.
           --------------------------------------------------------- */}
        <Panel title="L'appareil">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-5">
            <div>
              <dt className="eyebrow">Emplacement</dt>
              <dd className="mt-1 text-[var(--text-body)]">
                {/* La chaîne vide est le cas réel en production : elle
                    n'est pas un lieu, et on ne la montre pas comme tel. */}
                {fiche.location && fiche.location.trim() ? (
                  <Link href="/biolab/lieux" className="text-accent hover:underline">
                    {fiche.location}
                  </Link>
                ) : (
                  <span className="text-ink-faint">Non renseigné</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Lot en cours</dt>
              <dd className="mt-1 text-[var(--text-body)]">
                {fiche.current_batch_id ? (
                  <Link
                    href={`/biolab/lots/${fiche.current_batch_id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {fiche.lot_code ?? "Voir le lot"}
                  </Link>
                ) : (
                  <span className="text-ink-faint">Aucun</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Volume total</dt>
              <dd className="tabular mt-1 text-[var(--text-body)]">
                {fiche.total_volume_liters !== null && fiche.total_volume_liters !== undefined ? (
                  `${fiche.total_volume_liters} L`
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Volume utile</dt>
              <dd className="tabular mt-1 text-[var(--text-body)]">
                {fiche.working_volume_liters !== null &&
                fiche.working_volume_liters !== undefined ? (
                  `${fiche.working_volume_liters} L`
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </dd>
            </div>
          </dl>

          {composants.length > 0 && (
            <div className="border-t border-line px-5 py-4">
              <p className="eyebrow mb-2">Composants montés</p>
              <div className="flex flex-wrap gap-1.5">
                {composants.map((composant) => (
                  <Badge key={composant} tone="neutral">
                    {libelle(COMPOSANT_LABELS, composant)}
                  </Badge>
                ))}
              </div>
              {/* Une pompe absente de cette liste n'est pas une pompe en
                  panne : c'est une pompe que l'appareil n'a pas. */}
              <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
                Ce que cet appareil possède physiquement. Un élément absent de cette liste
                n&apos;est pas en panne — il n&apos;est pas monté.
              </p>
            </div>
          )}
        </Panel>

        {/* ---------------------------------------------------------
            3. LE PROGRAMME ACTIF — affiché, jamais réglable ici.
           --------------------------------------------------------- */}
        <Panel
          title="Programme actif"
          description={
            programme
              ? `${programme_nom ?? "Programme"} — version ${programme.version_number ?? "?"}`
              : undefined
          }
        >
          {!programme ? (
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Aucun programme actif. L&apos;appareil ne suit aucun cycle automatique — il peut
              être conduit à la main sans que cela pose problème.
            </p>
          ) : (
            <>
              {reglages.length === 0 ? (
                <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
                  Cette version n&apos;active ni immersion, ni aération, ni photopériode.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {reglages.map((reglage) => (
                    <li key={reglage} className="px-5 py-3 text-[var(--text-body)]">
                      {reglage}
                    </li>
                  ))}
                </ul>
              )}
              {programme.notes && (
                <p className="border-t border-line px-5 py-3 text-[var(--text-secondary)] text-ink-soft">
                  {programme.notes}
                </p>
              )}
              <p className="border-t border-line px-5 py-3 text-[var(--text-secondary)] text-ink-faint">
                Changer de programme ou de version se fait depuis l&apos;application mobile.
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* -----------------------------------------------------------
          4. LES OBJETS CONNECTÉS — leur état de connexion, pas leur
             commande.
         ----------------------------------------------------------- */}
      <Panel
        title="Objets connectés liés"
        description="Le matériel qui exécute les cycles."
        count={objets.length}
        className="mb-5"
      >
        {objets.length === 0 ? (
          /* « Aucun objet lié » n'est pas une panne : beaucoup de
             bioréacteurs sont conduits à la main. */
          <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
            Aucun objet connecté n&apos;est lié à cet appareil. Il n&apos;est donc pas piloté
            automatiquement — ce qui n&apos;est pas un défaut : un bioréacteur peut très bien
            être conduit à la main.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {objets.map((objet) => (
              <li
                key={objet.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {libelle(ROLE_OBJET_LABELS, objet.role)}
                    {objet.nom && (
                      <span className="ml-2 font-normal text-ink-soft">{objet.nom}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[var(--text-secondary)] text-ink-faint">
                    {[objet.fabricant, objet.modele].filter(Boolean).join(" ") ||
                      "Fabricant non renseigné"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {objet.en_ligne === null ? (
                    <Badge tone="neutral">Connexion inconnue</Badge>
                  ) : objet.en_ligne ? (
                    <StatusBadge tone="positive">Joignable</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Injoignable</StatusBadge>
                  )}
                  {/* L'état de connexion PORTE SA DATE, comme tout le
                      reste : « en ligne » sans date ne veut rien dire. */}
                  <span className="text-[var(--text-secondary)] text-ink-faint">
                    {objet.vu_le ? `vu ${formatDateHeure(objet.vu_le)}` : "jamais vu"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-line px-5 py-3 text-[var(--text-secondary)] text-ink-faint">
          <Icon name="equipment" className="mr-1.5 inline h-3.5 w-3.5" />
          Tester une pompe ou une vanne se fait depuis l&apos;application mobile, en présence de
          l&apos;appareil.
        </p>
      </Panel>

      {/* -----------------------------------------------------------
          5. LES CYCLES — la dernière activation du §7.
         ----------------------------------------------------------- */}
      <Panel
        title="Derniers cycles"
        description="Les vingt-cinq dernières exécutions enregistrées, les plus récentes d'abord."
        className="mb-5"
      >
        <div className="p-5">
          <DataTable
            columns={colonnesCycles}
            rows={cycles}
            rowKey={(cycle) => cycle.id}
            empty={
              /* Zéro cycle enregistré ne veut pas dire zéro cycle
                 exécuté : les exécutions sont écrites par le
                 planificateur du téléphone, qui doit avoir tourné. */
              <p className="text-[var(--text-body)] text-ink-soft">
                Aucun cycle enregistré. Les exécutions sont écrites par le planificateur de
                l&apos;application mobile ; tant qu&apos;il n&apos;a pas tourné pour cet appareil,
                ce journal reste vide — cela ne veut pas dire que rien ne s&apos;est passé.
              </p>
            }
          />
        </div>
      </Panel>

      {/* -----------------------------------------------------------
          6. L'ENTRETIEN — un journal, pas un échéancier.
         ----------------------------------------------------------- */}
      <Panel
        title="Journal d'entretien"
        description="Ce qui a été fait sur cet appareil, en ajout seul."
        count={entretiens.length}
      >
        <div className="p-5">
          <DataTable
            columns={colonnesEntretien}
            rows={entretiens}
            rowKey={(event) => event.id}
            empty={
              <p className="text-[var(--text-body)] text-ink-soft">
                Aucune intervention enregistrée. Les entretiens se saisissent depuis
                l&apos;application mobile, au moment où ils sont faits.
              </p>
            }
          />
        </div>
        {/* LA LIMITE, DITE PLUTÔT QUE CONTOURNÉE. On pourrait afficher
            « dernier nettoyage il y a 40 jours, à refaire » — il
            faudrait pour cela une périodicité, et ce produit n'en
            enregistre aucune. L'inventer ici serait écrire une règle de
            métier sur un sujet où se tromper coûte une contamination. */}
        <p className="border-t border-line px-5 py-3 text-[var(--text-secondary)] text-ink-faint">
          Ce journal ne comporte pas d&apos;échéance : le produit n&apos;enregistre aucune
          périodicité d&apos;entretien, donc aucune intervention ne peut être annoncée comme due.
          Ces lignes disent ce qui a été fait, pas ce qui reste à faire.
        </p>
      </Panel>
    </div>
  );
}
