import Link from "next/link";
import { PageHeader, Panel, Card, Badge, StatusBadge, ButtonLink, MetricCard } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  perimetreBioLab,
  lireMatiereAttention,
  formatNombre,
  formatHeure,
} from "@/lib/biolab/cultures";
import { LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  lireMatierePaillasse,
  echeances,
  grouperParUrgence,
  compterParUrgence,
  direEcheance,
  URGENCE_LABELS,
  URGENCE_TON,
  FAMILLE_LABELS,
  HORIZON_PEREMPTION_JOURS,
} from "@/lib/biolab/taches";

/**
 * §7 « tâches » — CE QUI EST DÛ AUJOURD'HUI, ET CE QUI EST EN RETARD.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL N'Y A PAS DE « À QUI », ET CETTE PAGE NE FAIT PAS SEMBLANT
 * ══════════════════════════════════════════════════════════════════
 *
 * Mesuré : aucune des vingt et une tables BioLab ne porte de tâche, et
 * aucune ne porte d'assigné. Une colonne « affecté à » serait donc soit
 * vide, soit remplie d'une invention — et une répartition du travail
 * inventée est pire qu'une absence de répartition : on croit que
 * quelqu'un s'en occupe.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE TÂCHE, ICI, EST UNE DATE RÉELLE — PAS UN OBJET QU'ON CRÉE
 * ══════════════════════════════════════════════════════════════════
 *
 * Chaque ligne s'adosse à une colonne qui existe : la fin de cycle
 * prévue d'un lot, sa date de démarrage confrontée au seuil
 * d'inspection du mobile, la date de péremption d'un consommable ou
 * d'une solution mère, le seuil de stock que l'utilisateur a lui-même
 * fixé, ou l'alerte que le téléphone a écrite.
 *
 * RIEN N'EST DÉDUIT D'UNE PÉRIODICITÉ, parce qu'il n'y en a aucune en
 * base. On n'écrit pas « nettoyage dû » à partir de « dernier nettoyage
 * il y a 40 jours » : il faudrait choisir l'intervalle, et le choisir
 * ici reviendrait à inventer une règle de métier sur un sujet où se
 * tromper coûte une contamination.
 *
 * LA DIFFÉRENCE AVEC LE TABLEAU DE BORD : `/biolab` répond à « qu'est-ce
 * que je décide ce matin » en cinq lignes ; cette page est la liste
 * complète, celle qu'on garde ouverte pendant qu'on travaille. Les deux
 * lisent les MÊMES définitions — celles de `cultures.ts` — pour ne
 * jamais afficher deux versions du même laboratoire.
 */
export default async function TachesBioLabPage() {
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "La liste des tâches");

  if (refus) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Tâches" subtitle="Ce qui est dû au laboratoire." />
        {refus}
      </div>
    );
  }

  const maintenant = new Date();
  const [attention, paillasse] = await Promise.all([
    lireMatiereAttention(perimetre.workspaceId, maintenant),
    lireMatierePaillasse(perimetre.workspaceId),
  ]);

  // Une liste de tâches amputée est plus dangereuse qu'une page en
  // erreur : on la croit complète et on conclut que rien n'est dû. La
  // règle vaut pour les DEUX moitiés — le côté culture (termes,
  // inspections, alertes) aussi bien que la paillasse.
  const erreurTaches = attention.erreur ?? paillasse.erreur;
  if (erreurTaches) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Tâches" subtitle="Ce qui est dû au laboratoire." />
        <LectureImpossible sujet="Les échéances du laboratoire" erreur={erreurTaches} />
      </div>
    );
  }

  const liste = echeances(attention.donnees, paillasse.matiere, maintenant);
  const compte = compterParUrgence(liste);
  const groupes = grouperParUrgence(liste);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Tâches"
        subtitle={
          liste.length > 0
            ? `${formatNombre(liste.length)} échéance${liste.length > 1 ? "s" : ""} relevée${liste.length > 1 ? "s" : ""} dans le laboratoire.`
            : "Ce qui arrive à échéance au laboratoire."
        }
        action={
          <ButtonLink href="/biolab" variant="secondary">
            Tableau de bord
          </ButtonLink>
        }
      />

      {liste.length === 0 ? (
        <>
          {/* « Rien à faire » est une affirmation forte : on ne la
              prononce qu'en disant CE QU'ON A REGARDÉ. Une liste vide
              parce que la base est vide et une liste vide parce que tout
              est à jour se ressemblent à l'écran, et n'ont rien à voir. */}
          <Card className="px-6 py-10 text-center">
            <Icon name="check" className="mx-auto mb-3 h-6 w-6 text-positive" />
            <p className="text-[length:var(--text-card)] font-medium">Aucune échéance en cours</p>
            <p className="mx-auto mt-2 max-w-lg text-[var(--text-body)] text-ink-soft">
              Aucun lot au-delà de son terme ou arrivant à échéance cette semaine, aucun lot actif
              sans inspection, aucune alerte non résolue, aucun consommable sous son seuil et
              aucune péremption dans les {HORIZON_PEREMPTION_JOURS} prochains jours.
            </p>
            <p className="mx-auto mt-3 max-w-lg text-[var(--text-secondary)] text-ink-faint">
              Si votre laboratoire est vide dans cet espace, cette page le restera aussi : elle ne
              lit que les échéances des données de l&apos;entreprise.
            </p>
          </Card>
        </>
      ) : (
        <>
          <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="En retard"
              value={formatNombre(compte.retard)}
              hint="C'était pour avant"
              tone={compte.retard > 0 ? "critical" : "neutral"}
            />
            <MetricCard
              label="Aujourd'hui"
              value={formatNombre(compte.aujourdhui)}
              hint="À caler dans la journée"
              tone={compte.aujourdhui > 0 ? "warning" : "neutral"}
            />
            <MetricCard
              label="Cette semaine"
              value={formatNombre(compte.semaine)}
              hint="À préparer"
            />
            <MetricCard
              label="À venir"
              value={formatNombre(compte["plus-tard"])}
              hint={`Péremptions à ${HORIZON_PEREMPTION_JOURS} jours`}
            />
          </section>

          {/* -----------------------------------------------------------
              L'AVEU, EN HAUT ET NON EN NOTE DE BAS DE PAGE.
              Quelqu'un qui cherche « qui s'en occupe » doit l'apprendre
              avant de parcourir la liste, pas après.
             ----------------------------------------------------------- */}
          <Card className="mb-5 flex items-start gap-3 px-5 py-4">
            <Icon name="planning" className="mt-0.5 h-5 w-5 shrink-0 text-ink-soft" />
            <p className="text-[var(--text-body)] text-ink-soft">
              <strong className="text-ink">Ces échéances ne sont affectées à personne.</strong>{" "}
              Le laboratoire n&apos;enregistre pas de répartition du travail : il n&apos;y a ni
              tâche à créer, ni responsable à désigner. Cette page relève les dates que vos
              données portent déjà — une fin de cycle, une péremption, un seuil de stock, une
              alerte — et vous dit lesquelles sont passées.
            </p>
          </Card>

          {groupes.map((groupe) => (
            <Panel
              key={groupe.urgence}
              title={URGENCE_LABELS[groupe.urgence]}
              count={groupe.lignes.length}
              className="mb-4"
            >
              <ul className="divide-y divide-line">
                {groupe.lignes.map((echeance) => (
                  <li key={echeance.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={URGENCE_TON[echeance.urgence]}>
                            {echeance.quoi}
                          </StatusBadge>
                          {echeance.objet && (
                            <span className="font-medium">{echeance.objet}</span>
                          )}
                          <Badge tone="neutral">{FAMILLE_LABELS[echeance.famille]}</Badge>
                        </p>
                        <p className="mt-1.5 text-[var(--text-secondary)] text-ink-soft">
                          {echeance.detail}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[var(--text-secondary)] text-ink-faint">
                          {direEcheance(echeance.jours)}
                        </span>
                        {echeance.lien && (
                          <Link
                            href={echeance.lien.href}
                            className="text-[var(--text-secondary)] font-medium text-accent hover:underline"
                          >
                            {echeance.lien.label} →
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </>
      )}

      {/* -----------------------------------------------------------
          CE QUI N'EST PAS DANS CETTE LISTE, ET POURQUOI.
          Une liste de tâches est jugée sur ce qu'elle oublie autant que
          sur ce qu'elle montre : autant énoncer ses angles morts.
         ----------------------------------------------------------- */}
      <Panel title="Ce que cette page ne peut pas savoir" className="mt-6">
        <ul className="space-y-2.5 px-5 py-5 text-[var(--text-body)] text-ink-soft">
          <li>
            <strong className="text-ink">Aucun entretien d&apos;équipement n&apos;y figure.</strong>{" "}
            Le journal d&apos;entretien enregistre ce qui a été fait, jamais à quelle fréquence le
            refaire — le web ne peut donc pas annoncer qu&apos;un filtre est à changer. Les
            interventions passées se consultent sur la fiche de chaque appareil.
          </li>
          <li>
            <strong className="text-ink">Aucune tâche ne peut être cochée ici.</strong> Ces lignes
            ne sont pas des tâches enregistrées : elles disparaîtront quand la donnée qui les
            porte changera — le lot clos, le flacon remplacé, l&apos;alerte résolue sur le
            téléphone.
          </li>
          <li>
            <strong className="text-ink">Les péremptions s&apos;arrêtent à{" "}
            {HORIZON_PEREMPTION_JOURS} jours.</strong> Au-delà, il n&apos;y a rien à faire
            aujourd&apos;hui, et une liste qu&apos;on ne peut pas vider cesse d&apos;être lue. Ce
            qui est déjà périmé reste affiché quelle que soit son ancienneté.
          </li>
        </ul>
      </Panel>

      <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
        Page lue à {formatHeure(maintenant)}. Les échéances sont recalculées à chaque affichage, à partir des données du téléphone.
      </p>
    </div>
  );
}
