import type { Metadata } from "next";

import { ShareBar } from "@/components/dashboard/share-bar";
import { ReadError } from "@/components/dashboard/read-error";
import { UnknownsPanel } from "@/components/dashboard/unknowns";
import { ButtonLink, MetricCard, PageHeader, Panel, SectionHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { combineReasons, formatSignedCount, reasonFor, sumKnown } from "@/lib/dashboard/aggregate";
import { readPlatformKpis } from "@/lib/dashboard/source";
import type { PlatformKpisRow } from "@/lib/dashboard/types";
import { formatCents, formatCount, formatPercent, formatTime } from "@/lib/format";

/**
 * ==================================================================
 * LE TABLEAU DE BORD — spec p.3-4
 * ==================================================================
 *
 * « Le premier écran doit permettre en quelques secondes de savoir :
 * combien de personnes utilisent Oasis Care, combien paient, combien
 * d'entreprises utilisent Pro, combien rapporte Oasis Care, combien
 * coûte l'IA » (spec p.33).
 *
 * Cet écran répond à ce qu'il peut et refuse d'inventer le reste. Sept
 * des seize chiffres demandés n'existent pas dans cette base — pas par
 * oubli de requête, par absence de donnée : les quatre forfaits Pro
 * n'ont pas de prix, `organization_subscriptions` est vide et aucune
 * ligne de code du dépôt ne l'écrit, aucune table n'enregistre de
 * jetons ni de coût IA, et rien ne dit par quelle application un compte
 * est entré. Ceux-là s'affichent en INCONNU, avec leur motif.
 *
 * ------------------------------------------------------------------
 * AUCUN CALCUL ICI
 * ------------------------------------------------------------------
 * Les chiffres arrivent de `admin_platform_kpis()`, qui les a bornés
 * au fuseau de Paris et a décidé lui-même de ce qui est connu. Cette
 * page met en forme, groupe et explique — elle ne compte rien. Les
 * deux seules opérations qu'elle fait sur des nombres (l'addition des
 * essais, la part d'un tout) refusent de rendre un résultat dès qu'une
 * de leurs entrées manque : voir `lib/dashboard/aggregate.ts` et ses
 * tests.
 *
 * ------------------------------------------------------------------
 * DEUX BARRIÈRES, PAS UNE
 * ------------------------------------------------------------------
 * `requireAdmin("platform.dashboard.read")` en première instruction,
 * puis le `raise` de la fonction SQL elle-même. Aucune des deux ne
 * suppose que l'autre a fait son travail — c'est la règle R3 de la
 * migration 0075.
 */

export const metadata: Metadata = {
  title: "Tableau de bord — Oasis Care Control Center",
};

/**
 * Jamais de version en cache. Lire les cookies rend déjà la page
 * dynamique ; on l'écrit quand même, pour qu'ajouter un cache plus
 * tard soit un choix conscient et non un effet de bord. Un tableau de
 * bord servi depuis un cache montre l'état d'un autre moment sans le
 * dire.
 */
export const dynamic = "force-dynamic";

/** Les noms lisibles des colonnes que `admin_platform_kpis()` peut déclarer inconnues. */
const UNKNOWN_LABELS: Record<string, string> = {
  mobile_users: "Utilisateurs Oasis Care Mobile",
  mrr_cents: "MRR — revenu mensuel récurrent",
  arr_cents: "ARR — revenu annuel récurrent",
  pro_trials: "Essais en cours — entreprises Pro",
  mobile_trials: "Essais en cours — mobile",
  churn_30d_percent: "Churn sur 30 jours",
  ai_cost_cents: "Coût de l'IA",
};

export default async function TableauDeBordPage() {
  await requireAdmin("platform.dashboard.read");

  let kpis: PlatformKpisRow;
  try {
    kpis = await readPlatformKpis();
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Vue d'ensemble" title="Tableau de bord" />
        <ReadError error={error} />
      </>
    );
  }

  const reasons = kpis.unknown_reasons;

  // Les essais additionnent deux mondes. Si l'un des deux est muet, le
  // total l'est aussi : un total qui n'aurait retenu que la moitié
  // connue serait systématiquement trop bas, et un chiffre trop bas a
  // l'air d'un chiffre.
  const trials = sumKnown([kpis.pro_trials, kpis.mobile_trials]);
  const monthProgress = formatSignedCount(kpis.new_users_this_month);
  const computedAt = formatTime(kpis.computed_at);

  return (
    <>
      <PageHeader
        eyebrow="Vue d'ensemble"
        title="Tableau de bord"
        subtitle="L'état de la plateforme : qui l'utilise, qui paie, ce que consomme l'IA. Les chiffres viennent de la base ; ceux qu'elle ne sait pas produire s'affichent en inconnu et disent pourquoi."
        action={
          <div className="flex flex-wrap items-center gap-3">
            {computedAt && (
              <span className="tabular text-[var(--text-secondary)] text-ink-faint">
                Arrêté à {computedAt}
              </span>
            )}
            <ButtonLink href="/activite" variant="secondary">
              Activité en direct →
            </ButtonLink>
          </div>
        }
      />

      <section className="mb-8">
        <SectionHeader
          title="Les grands chiffres"
          description="Comptés à l'instant, à l'heure de Paris."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Utilisateurs total"
            tone="accent"
            value={formatCount(kpis.total_users)}
            hint={monthProgress ? `${monthProgress} ce mois` : undefined}
          />
          <MetricCard
            label="Oasis Care Mobile"
            value={formatCount(kpis.mobile_users)}
            unknownReason={reasonFor(reasons, "mobile_users")}
          />
          <MetricCard
            label="Oasis Care Pro"
            value={formatCount(kpis.pro_organizations)}
            hint="entreprises non archivées"
            href="/organisations"
          />
          <MetricCard
            label="Utilisateurs Pro"
            value={formatCount(kpis.pro_users)}
            hint="comptes vivants, membres d'une entreprise non archivée"
            href="/utilisateurs/pro"
          />
          <MetricCard
            label="MRR"
            value={formatCents(kpis.mrr_cents)}
            unknownReason={reasonFor(reasons, "mrr_cents")}
          />
          <MetricCard
            label="ARR"
            value={formatCents(kpis.arr_cents)}
            unknownReason={reasonFor(reasons, "arr_cents")}
          />
          <MetricCard
            label="Essais en cours"
            value={formatCount(trials)}
            unknownReason={combineReasons(reasons, ["pro_trials", "mobile_trials"])}
            hint="entreprises Pro et abonnés mobiles"
          />
          <MetricCard
            label="Churn (30 jours)"
            value={formatPercent(kpis.churn_30d_percent)}
            unknownReason={reasonFor(reasons, "churn_30d_percent")}
          />
        </div>
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Abonnements et IA, ce mois-ci"
          description="Les compteurs d'IA sont mensuels et comptent des REQUÊTES, pas des euros. Leur zéro est vrai : la ligne de période est créée au premier appel, donc l'absence de ligne est l'absence d'appel."
        />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            size="small"
            label="Abonnements suivis"
            value={formatCount(kpis.tracked_subscriptions)}
            hint="entreprises non archivées dont l'abonnement est enregistré"
          />
          {/*
            LES DEUX COMPTEURS D'IA NE COMPTENT PAS LA MÊME CHOSE, et
            la mise en page invite justement à les comparer. Côté Pro,
            `consume_pro_ai_quota` (0058) incrémente AVANT de rendre sa
            réponse, avec le commentaire assumé « on rend allowed =
            false APRÈS avoir incrémenté » : une requête refusée pour
            dépassement de quota est comptée. Côté mobile,
            `increment_usage_counter` (0041) rend la main sans
            incrémenter dès que la limite est atteinte. Les aligner
            demanderait de modifier l'une des deux fonctions — hors
            périmètre de ce jalon. On le dit donc là où on l'affiche.
          */}
          <MetricCard
            size="small"
            label="Requêtes IA — Pro"
            value={formatCount(kpis.pro_ai_requests_this_month)}
            hint="ce mois · refus de dépassement de quota compris"
          />
          <MetricCard
            size="small"
            label="Requêtes IA — Mobile"
            value={formatCount(kpis.mobile_ai_requests_this_month)}
            hint="ce mois · appels servis uniquement"
          />
          <MetricCard
            size="small"
            label="Coût de l'IA"
            value={formatCents(kpis.ai_cost_cents)}
            unknownReason={reasonFor(reasons, "ai_cost_cents")}
          />
        </div>
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Couverture"
          description="Deux rapports entre chiffres mesurés au même instant. Il n'existe aucune série temporelle dans cette base — ni instantané quotidien des compteurs, ni historique d'abonnements — donc aucune courbe n'est traçable sans inventer les points intermédiaires."
        />
        <Panel>
          <div className="flex flex-col gap-6 p-4">
            <ShareBar
              label="Comptes rattachés à une entreprise Pro"
              part={kpis.pro_users}
              whole={kpis.total_users}
              unit="comptes"
              note="Les deux chiffres portent sur la même population : des comptes vivants, les effacements doux exclus de part et d'autre, et une entreprise archivée ne rattache plus personne. Le reste utilise Oasis Care sans entreprise ; combien d'entre eux passent par l'iPhone reste inconnu, rien n'enregistre l'application d'origine d'un compte."
            />
            <ShareBar
              label="Entreprises dont l'abonnement est suivi"
              part={kpis.tracked_subscriptions}
              whole={kpis.pro_organizations}
              unit="entreprises"
              note="Un abonnement non suivi est un abonnement dont on ne connaît ni le forfait, ni le prix, ni la date : c'est la cause directe du MRR, de l'ARR et des essais inconnus ci-dessus. Ici aussi les deux chiffres portent sur la même population — les entreprises archivées sortent du numérateur comme du dénominateur."
            />
          </div>
        </Panel>
      </section>

      <section className="mb-8">
        <SectionHeader
          title="Ce que le tableau de bord ne sait pas encore calculer"
          description="Spec p.4 : « Les KPI doivent être calculés depuis les vraies données. Aucune valeur fictive en production. » Voici, chiffre par chiffre, ce qui manque pour tenir cette phrase."
        />
        <UnknownsPanel id="inconnus" reasons={reasons} labels={UNKNOWN_LABELS} />
      </section>
    </>
  );
}
