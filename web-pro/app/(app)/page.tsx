import { requireOrganization } from "@/lib/auth/organization";
import {
  PageHeader, SectionHeader, Card, EmptyState, MetricCard, ActivityTimeline, ButtonLink,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { formatCents } from "@/lib/quotes/types";
import { formatCount } from "@/lib/analytics/types";
import { loadDashboard, DAY_FORMAT } from "./(dashboard)/queries";
import { Alerts } from "./(dashboard)/Alerts";
import { Welcome } from "./(dashboard)/Welcome";

/**
 * §10 DASHBOARD V2 — « Refaire complètement le dashboard. »
 *
 * L'ancienne version affichait le nom de l'organisation, le rôle du
 * compte et le NOMBRE DE PERMISSIONS. Trois choses qu'on ne vient
 * jamais chercher le matin. Celle-ci répond à la question qu'on se pose
 * vraiment en ouvrant l'application : où j'en suis, ce que je fais
 * aujourd'hui, ce qui va me tomber dessus.
 *
 * D'où l'ordre, qui est celui de §1 — « information importante ↓ action
 * principale ↓ détails si besoin » :
 *
 *   1. Bonjour, et ce qui se passe chez VOUS.
 *   2. Quatre grands chiffres, pas douze petits.
 *   3. La journée, heure par heure.
 *   4. Ce qui cloche, avec la porte pour aller le réparer.
 *
 * Tout le chargement vit dans `(dashboard)/queries.ts` ; ce fichier ne
 * fait que de la mise en page. Et aucun chiffre n'est inventé : un
 * indicateur qu'on ne sait pas calculer arrive à `null` et s'affiche en
 * tiret — « 0 € » et « je ne sais pas » sont deux affirmations
 * différentes, et l'une des deux serait fausse.
 */
export default async function DashboardPage() {
  const organization = await requireOrganization();
  const dashboard = await loadDashboard(organization);

  const today = DAY_FORMAT.format(new Date());
  const metrics = [
    dashboard.revenue,
    dashboard.quotesPending,
    dashboard.projects,
    dashboard.nursery,
  ].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        eyebrow={today}
        title="Bonjour"
        subtitle={`Voici ce qui se passe aujourd'hui chez ${organization.name}.`}
      />

      {dashboard.isBlank ? (
        <Welcome organization={organization} visible={dashboard.visible} />
      ) : (
        <>
          {/* §10 — « CA DU MOIS », « DEVIS EN ATTENTE », « CHANTIERS
              ACTIFS », « PÉPINIÈRE ». Une carte absente vaut mieux
              qu'une carte à zéro : §43 laisse éteindre un module, et un
              paysagiste sans pépinière n'a pas à voir la sienne vide. */}
          {metrics > 0 && (
            <section className="mb-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {dashboard.revenue && (
                <MetricCard
                  label="CA du mois"
                  value={formatCents(dashboard.revenue.cents)}
                  delta={dashboard.revenue.deltaPercent}
                  // Une hausse du chiffre d'affaires est une bonne
                  // nouvelle : le vert suit le sens métier, pas le signe.
                  deltaGood
                  // « vs même période » et non « vs mois précédent » :
                  // comparer le 3 du mois à un mois entier afficherait
                  // −90 % tous les débuts de mois.
                  hint={
                    dashboard.revenue.deltaPercent === null
                      ? "Pas de comparaison possible avec le mois dernier"
                      : "vs même période le mois dernier"
                  }
                  href="/analytics"
                />
              )}

              {dashboard.quotesPending && (
                <MetricCard
                  label="Devis en attente"
                  value={formatCents(dashboard.quotesPending.cents)}
                  hint={
                    dashboard.quotesPending.count === 0
                      ? "Aucun devis en attente"
                      : `${formatCount(dashboard.quotesPending.count)} devis envoyés, sans réponse`
                  }
                  href="/devis?statut=sent"
                />
              )}

              {dashboard.projects && (
                <MetricCard
                  label="Chantiers actifs"
                  value={formatCount(dashboard.projects.inProgress)}
                  hint={
                    dashboard.projects.planned > 0
                      ? `${formatCount(dashboard.projects.planned)} autres planifiés`
                      : "Aucun autre planifié"
                  }
                  href="/projets"
                />
              )}

              {dashboard.nursery && (
                <MetricCard
                  label="Pépinière"
                  value={formatCount(dashboard.nursery.plants)}
                  hint={`plantes en stock · ${formatCount(dashboard.nursery.species)} espèces`}
                  href="/pepiniere/stock"
                />
              )}
            </section>
          )}

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* §10 AUJOURD'HUI — la timeline de la journée. */}
            <section>
              <SectionHeader
                title="Aujourd'hui"
                description={today}
                count={dashboard.timeline.length > 0 ? dashboard.timeline.length : undefined}
                action={
                  dashboard.visible.projects ? (
                    <ButtonLink href="/planning" variant="secondary">
                      Voir le planning
                    </ButtonLink>
                  ) : undefined
                }
              />

              {dashboard.timeline.length === 0 ? (
                <EmptyState
                  icon={<Icon name="planning" className="h-5 w-5" />}
                  title={
                    dashboard.visible.projects
                      ? "Rien de prévu aujourd'hui"
                      : "Votre journée ne s'affiche pas ici"
                  }
                  description={
                    dashboard.visible.projects
                      ? "Les interventions planifiées pour la journée apparaîtront ici, à l'heure près."
                      : "Les interventions du terrain demandent l'accès aux chantiers, que votre rôle n'a pas."
                  }
                  action={
                    dashboard.visible.projects ? (
                      <ButtonLink href="/planning">Planifier une intervention</ButtonLink>
                    ) : undefined
                  }
                />
              ) : (
                <Card className="px-5 pt-5">
                  <ActivityTimeline items={dashboard.timeline} />
                </Card>
              )}
            </section>

            {/* §10 ALERTES — « À SURVEILLER ». */}
            <section>
              <SectionHeader
                title="À surveiller"
                count={dashboard.alerts.length > 0 ? dashboard.alerts.length : undefined}
              />
              <Alerts alerts={dashboard.alerts} checks={dashboard.alertChecks} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Aucun cache.
 *
 * Le tableau de bord affiche l'heure du jour et l'état du moment. Une
 * version servie depuis un cache montrerait la journée d'hier avec
 * l'assurance d'aujourd'hui, ce qui est pire que de la faire attendre.
 */
export const dynamic = "force-dynamic";
