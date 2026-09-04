import type { Metadata } from "next";
import Link from "next/link";

import { Auteur, Plafond } from "@/components/ia/affichage";
import { EcranIaFerme } from "@/components/ia/socle";
import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  ButtonLink,
  DataTable,
  MetricCard,
  Notice,
  PageHeader,
  Panel,
  UnknownValue,
  type Column,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { formatCount } from "@/lib/format";
import { sansAucunPlafond } from "@/lib/ia/montants";
import {
  diagnostiquerSocleIa,
  indexerEntreprises,
  listerEntreprises,
  lirePlafonds,
  resoudreAuteurs,
} from "@/lib/ia/source";
import type { LignePlafonds } from "@/lib/ia/types";

/**
 * ==================================================================
 * QUOTAS IA — spec p.17
 * ==================================================================
 *
 * « Pouvoir configurer : par plan, par organisation, par utilisateur,
 * par agent. Avec possibilité d'override administratif. »
 *
 * Deux des quatre existent en base, et cet écran les pilote. Les deux
 * autres n'existent pas, et il le dit plutôt que d'afficher un
 * formulaire qui n'écrirait nulle part.
 *
 * ------------------------------------------------------------------
 * CE QUE CET ÉCRAN CORRIGE, ET C'EST TOUT LE CHANTIER
 * ------------------------------------------------------------------
 * Jusqu'à la migration 0080, `ai_cost_limits` portait la politique
 * « Managers write » : le gestionnaire d'une entreprise CLIENTE pouvait
 * relever son propre plafond, le vider champ par champ, ou supprimer la
 * ligne entière. Un plafond que la partie plafonnée contrôle ne protège
 * de rien — et c'est l'éditeur qui reçoit la facture du fournisseur.
 *
 * 0080 a retiré cette politique sans la remplacer : il n'existe plus
 * AUCUNE politique d'écriture sur cette table, pour personne, et
 * `authenticated` a perdu ses droits DML. Le seul chemin est
 * `admin_set_ai_cost_limits` / `admin_clear_ai_cost_limits`, réservées à
 * `ai.costLimits.write`, motif obligatoire, journalisées.
 *
 * ------------------------------------------------------------------
 * LA LECTURE DU CLIENT, ELLE, EST RESTÉE — ET C'EST VITAL
 * ------------------------------------------------------------------
 * `ai_cost_budget_remaining()` est `security invoker` : elle lit cette
 * table avec les droits du moteur, donc à travers « Members read ». La
 * refermer aurait rendu le plafond IMPOSÉ PAR L'ÉDITEUR invisible au
 * moteur — c'est-à-dire inexistant — et sans la moindre erreur nulle
 * part. C'est le piège que 0080 a évité de justesse, et qu'il faut
 * connaître avant de « nettoyer » ces politiques un jour.
 */

export const metadata: Metadata = {
  title: "Plafonds IA — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function PlafondsPage() {
  const admin = await requireAdmin();
  const socle = await diagnostiquerSocleIa(admin.permissions);

  if (socle.etat !== "ok") {
    return (
      <EcranIaFerme
        etat={socle.etat}
        titre="Plafonds et quotas IA"
        sousTitre="Les bornes de dépense de l'éditeur, entreprise par entreprise."
      />
    );
  }

  let plafonds: LignePlafonds[];
  let entreprises: Awaited<ReturnType<typeof listerEntreprises>>;
  try {
    [plafonds, entreprises] = await Promise.all([lirePlafonds(), listerEntreprises()]);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="IA" title="Plafonds et quotas IA" />
        <ReadFailure error={error} />
      </>
    );
  }

  const index = indexerEntreprises(entreprises.entreprises);
  const noms = await resoudreAuteurs(plafonds.map((ligne) => ligne.updated_by));
  const parOrganisation = new Map(plafonds.map((ligne) => [ligne.organization_id, ligne]));

  // Les entreprises VIVANTES sans aucune borne. Les archivées sont
  // écartées de ce compte : elles ne travaillent plus, donc elles ne
  // dépensent plus, et les compter ici gonflerait une alerte qui doit
  // rester crédible pour être lue.
  const sansBorne = entreprises.entreprises.filter(
    (entreprise) =>
      entreprise.archiveeLe === null &&
      sansAucunPlafond(parOrganisation.get(entreprise.id) ?? null),
  );

  const peutEcrire = admin.permissions.includes("ai.costLimits.write");

  const colonnes: Column<LignePlafonds>[] = [
    {
      key: "entreprise",
      header: "Entreprise",
      cell: (ligne) => index.get(ligne.organization_id)?.nom ?? "Entreprise inconnue",
    },
    {
      key: "jour",
      header: "Par jour",
      numeric: true,
      cell: (ligne) => <Plafond cents={ligne.daily_organization_limit_cents} />,
    },
    {
      key: "mois",
      header: "Par mois",
      numeric: true,
      cell: (ligne) => <Plafond cents={ligne.monthly_organization_limit_cents} />,
    },
    {
      key: "agent",
      header: "Par agent et par mois",
      numeric: true,
      cell: (ligne) => <Plafond cents={ligne.per_agent_limit_cents} />,
    },
    {
      key: "auteur",
      header: "Posé par",
      cell: (ligne) => (
        <Auteur identifiant={ligne.updated_by} quand={ligne.updated_at} noms={noms} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="IA"
        title="Plafonds et quotas IA"
        subtitle="Les bornes de dépense de l'éditeur, entreprise par entreprise. Depuis la migration 0080, un client ne peut plus relever la sienne — et c'était tout le problème."
        action={
          <ButtonLink href="/ia/couts" variant="secondary">
            Coûts IA
          </ButtonLink>
        }
      />

      {sansBorne.length > 0 && (
        <Notice
          tone="warning"
          title={
            // UN MINORANT NE SE DIT PAS COMME UN FAIT. `sansBorne` est
            // compté sur la liste RENDUE, qui s'arrête à 1 000
            // entreprises. Au-delà, le nombre affiché serait un
            // plancher présenté comme un total — sur le seul chiffre de
            // cet écran dont le rôle est d'alarmer. On écrit « au
            // moins », et on dit sur quoi le compte a porté.
            entreprises.tronquee
              ? `Au moins ${sansBorne.length} entreprise${sansBorne.length > 1 ? "s" : ""} vivante${sansBorne.length > 1 ? "s ne sont" : " n'est"} bornée${sansBorne.length > 1 ? "s" : ""} par aucun plafond`
              : sansBorne.length > 1
                ? `${sansBorne.length} entreprises vivantes ne sont bornées par aucun plafond`
                : "Une entreprise vivante n'est bornée par aucun plafond"
          }
        >
          Aucune ligne dans <code className="font-mono text-[11px]">ai_cost_limits</code>, ou trois
          colonnes nulles : dans les deux cas, la dépense IA n&apos;est arrêtée par rien. Ce
          n&apos;est pas « pas encore configuré » — c&apos;est un état de fonctionnement, et il
          n&apos;est pas neutre.
          {entreprises.tronquee && (
            <>
              {" "}
              Le compte porte sur les 1 000 premières entreprises : la liste est tronquée, et
              celles qui suivent n&apos;ont pas été examinées. Le vrai nombre est donc plus grand,
              jamais plus petit.
            </>
          )}
        </Notice>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Entreprises avec un plafond"
          value={formatCount(plafonds.length)}
          hint="Une ligne dans ai_cost_limits, quelles que soient ses valeurs."
        />
        <MetricCard
          label="Entreprises vivantes sans aucune borne"
          value={formatCount(sansBorne.length)}
          tone={sansBorne.length > 0 ? "accent" : "neutral"}
          hint="Ligne absente, ou trois colonnes nulles."
        />
        <MetricCard
          label="Quota par plan"
          value={null}
          unknownReason="La spec p.17 le demande, et rien ne le porte : aucune table n'associe un plafond IA à un forfait. organization_plans existe, mais ne contient ni plafond de dépense ni quota de requêtes — et son monthly_price_cents est nul. Ce serait une migration à écrire."
        />
        <MetricCard
          label="Quota par utilisateur"
          value={null}
          unknownReason="La spec p.17 le demande. ai_cost_limits ne connaît que l'organisation et l'agent ; ai_usage_events porte bien un user_id, mais aucune table ne borne un utilisateur. Ce serait une migration à écrire."
        />
      </div>

      <div className="mt-5">
        <Panel
          title="Plafonds posés"
          description="Trois montants par entreprise, en euros. Le vide et le zéro ne veulent PAS dire la même chose : le vide ne borne rien, le zéro éteint l'IA."
          count={plafonds.length}
        >
          <DataTable
            columns={colonnes}
            rows={plafonds}
            rowKey={(ligne) => ligne.organization_id}
            rowHref={(ligne) => `/ia/organisations/${ligne.organization_id}`}
            empty={
              <div className="px-4 py-8 text-center">
                <p className="text-[length:var(--text-card)] font-medium text-ink">
                  Aucun plafond posé
                </p>
                <p className="mx-auto mt-2 max-w-2xl text-[var(--text-body)] leading-relaxed text-ink-soft">
                  <code className="font-mono text-[11px]">ai_cost_limits</code> est vide : aucune
                  entreprise n&apos;est bornée. Le contrôle de coût lira « aucune limite » pour
                  chacune d&apos;elles.
                </p>
              </div>
            }
          />
        </Panel>
      </div>

      <div className="mt-5">
        <Panel
          title="Entreprises sans aucune borne"
          description={
            peutEcrire
              ? "Ouvrez une entreprise pour lui poser ses trois plafonds. Le motif est obligatoire, et la trace part avec l'écriture."
              : "Votre rôle ne porte pas ai.costLimits.write : vous voyez les bornes, vous ne les posez pas. C'est la séparation des pouvoirs de 0080 — le produit choisit le modèle, la facturation fixe le plafond."
          }
          count={sansBorne.length}
        >
          {sansBorne.length === 0 ? (
            <div className="px-4 py-6 text-center text-[var(--text-body)] text-ink-soft">
              Toutes les entreprises vivantes portent au moins une borne.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {sansBorne.map((entreprise) => (
                <li key={entreprise.id}>
                  <Link
                    href={`/ia/organisations/${entreprise.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-raised"
                  >
                    <span className="flex min-w-0 items-center gap-2 font-medium">
                      {entreprise.nom}
                      {parOrganisation.has(entreprise.id) && (
                        <Badge tone="neutral">Ligne présente, trois colonnes nulles</Badge>
                      )}
                    </span>
                    <span className="shrink-0">
                      <UnknownValue
                        label="Dépense non bornée"
                        inline
                        reason="Le contrôle de coût laissera passer tous les appels de cette entreprise."
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel
          title="Ce que « par agent » veut dire ici, exactement"
          description="La colonne s'appelle per_agent_limit_cents, et le pluriel est trompeur."
        >
          <div className="px-4 py-3 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            <p>
              Ce n&apos;est pas un plafond par agent : c&apos;est UN SEUL montant, appliqué
              séparément à chacun des agents. « 20 € par agent et par mois » borne le finance à
              20 €, le facturation à 20 €, et ainsi de suite — pas les quatre ensemble. La spec
              p.17 demande un réglage « par agent » au sens de « un montant par agent » ; la base
              n&apos;en porte qu&apos;un, commun. La distinction change ce qu&apos;on peut
              promettre, donc elle est écrite ici plutôt que découverte sur une facture.
            </p>
            <p className="mt-2">
              Rappel de la migration 0076, que l&apos;écran respecte partout : une colonne NULLE
              veut dire « aucune limite », jamais « limite à zéro ». Zéro est un plafond à zéro,
              c&apos;est-à-dire l&apos;IA coupée pour cette entreprise — un réglage légitime,
              écrit à la main par quelqu&apos;un.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
